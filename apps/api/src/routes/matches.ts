import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma, type MatchStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/guards.js';
import { einstellungenPruefen, spielart } from '../lib/spiele.js';
import { liveZustandSenden, liveZustandVerwerfen } from '../lib/realtime.js';

/**
 * Zeichensatz des Beitrittscodes. 0/O/1/I sind bewusst nicht dabei: der Code
 * wird vorgelesen und abgetippt, und genau die verwechselt man dabei.
 */
const CODE_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LAENGE = 6;

function codeErzeugen(): string {
  let code = '';
  for (let i = 0; i < CODE_LAENGE; i++) {
    code += CODE_ZEICHEN[randomInt(CODE_ZEICHEN.length)];
  }
  return code;
}

const anlegenSchema = z.object({
  gameSlug: z.string().min(1),
  name: z.string().trim().min(1, 'Bitte einen Namen vergeben').max(60),
  // Wird gegen die Spielart geprueft, sobald die feststeht.
  settings: z.record(z.string(), z.unknown()).optional(),
});

const codeParamSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(new RegExp(`^[${CODE_ZEICHEN}]{${CODE_LAENGE}}$`), 'Ungültiger Beitrittscode'),
});

/** Fehler mit HTTP-Status, damit Regelverstoesse keine 500er werden. */
class PartieFehler extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Alles, was die Oberflaeche ueber eine Partie wissen muss. Der Live-Teil
 * (getippter Text, Buzzer-Reihenfolge) kommt ueber die Socket-Verbindung --
 * hier steht nur, was die Datenbank haelt.
 */
const PARTIE_AUSWAHL = {
  id: true,
  code: true,
  name: true,
  status: true,
  settings: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  game: { select: { slug: true, name: true, minPlayers: true, maxPlayers: true } },
  players: {
    select: {
      userId: true,
      isGamemaster: true,
      score: true,
      result: true,
      placement: true,
      joinedAt: true,
      user: { select: { displayName: true, username: true } },
    },
    orderBy: { joinedAt: 'asc' },
  },
} satisfies Prisma.MatchSelect;

type PartieRoh = Prisma.MatchGetPayload<{ select: typeof PARTIE_AUSWAHL }>;

export function partieNachAussen(partie: PartieRoh) {
  return {
    id: partie.id,
    code: partie.code,
    name: partie.name,
    status: partie.status,
    settings: (partie.settings ?? {}) as Record<string, unknown>,
    spiel: partie.game,
    createdAt: partie.createdAt,
    startedAt: partie.startedAt,
    finishedAt: partie.finishedAt,
    teilnehmer: partie.players.map((p) => ({
      userId: p.userId,
      displayName: p.user.displayName,
      username: p.user.username,
      istLeitung: p.isGamemaster,
      punkte: p.score ?? 0,
      ergebnis: p.result,
      platz: p.placement,
    })),
  };
}

async function partieLaden(where: Prisma.MatchWhereUniqueInput): Promise<PartieRoh> {
  const partie = await prisma.match.findUnique({ where, select: PARTIE_AUSWAHL });
  if (!partie) throw new PartieFehler(404, 'Partie nicht gefunden');
  return partie;
}

function leitungPruefen(partie: PartieRoh, userId: string): void {
  const eintrag = partie.players.find((p) => p.userId === userId);
  if (!eintrag?.isGamemaster) {
    throw new PartieFehler(403, 'Das darf nur die Spielleitung');
  }
}

function statusPruefen(partie: PartieRoh, erwartet: MatchStatus, meldung: string): void {
  if (partie.status !== erwartet) throw new PartieFehler(409, meldung);
}

/**
 * Schreibt die Ergebnisse fest und zaehlt die Bilanzen hoch.
 *
 * Die Spielleitung spielt nicht mit und bleibt deshalb ohne Ergebnis. Gewertet
 * wird erst ab zwei Mitspielenden -- sonst gewaenne ein einzelner Spieler jede
 * Partie gegen sich selbst und die Rangliste waere nichts mehr wert.
 */
async function ergebnisseFestschreiben(
  tx: Prisma.TransactionClient,
  partieId: string,
): Promise<{ gewertet: boolean }> {
  const spieler = await tx.matchPlayer.findMany({
    where: { matchId: partieId, isGamemaster: false },
    select: { id: true, userId: true, score: true },
  });

  if (spieler.length < 2) return { gewertet: false };

  const sortiert = [...spieler].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const hoechste = sortiert[0].score ?? 0;
  // Gleichstand an der Spitze ist ein Unentschieden fuer alle Beteiligten.
  const anDerSpitze = sortiert.filter((s) => (s.score ?? 0) === hoechste).length;

  for (const eintrag of sortiert) {
    const punkte = eintrag.score ?? 0;
    const ergebnis = punkte === hoechste ? (anDerSpitze > 1 ? 'DRAW' : 'WIN') : 'LOSS';

    // Gleiche Punktzahl, gleicher Platz -- sonst entscheidet die Sortierung
    // willkuerlich, wer von zwei Gleichstehenden vorn liegt.
    const platz = sortiert.findIndex((s) => (s.score ?? 0) === punkte) + 1;

    await tx.matchPlayer.update({
      where: { id: eintrag.id },
      data: { result: ergebnis, placement: platz },
    });

    const zaehler = {
      wins: ergebnis === 'WIN' ? 1 : 0,
      losses: ergebnis === 'LOSS' ? 1 : 0,
      draws: ergebnis === 'DRAW' ? 1 : 0,
    };

    await tx.overallStat.upsert({
      where: { userId: eintrag.userId },
      update: {
        matchesPlayed: { increment: 1 },
        wins: { increment: zaehler.wins },
        losses: { increment: zaehler.losses },
        draws: { increment: zaehler.draws },
      },
      create: { userId: eintrag.userId, matchesPlayed: 1, ...zaehler },
    });
  }

  return { gewertet: true };
}

export async function matchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /** Die waehlbaren Spielarten samt Standardeinstellungen fuer das Formular. */
  app.get('/api/games', async () => {
    const aktive = await prisma.game.findMany({
      where: { isActive: true },
      select: { slug: true, name: true, description: true, minPlayers: true, maxPlayers: true },
      orderBy: { name: 'asc' },
    });

    return aktive.map((spiel) => {
      const art = spielart(spiel.slug);
      return {
        ...spiel,
        // Ohne diese Vorgaben muesste das Formular die Standardwerte selbst
        // kennen -- dann staenden sie an zwei Stellen und liefen auseinander.
        standardEinstellungen: art ? art.einstellungen.parse({}) : {},
      };
    });
  });

  /** Partien, in denen der Benutzer gerade steckt -- fuer den Wiedereinstieg. */
  app.get('/api/matches', async (request) => {
    const partien = await prisma.match.findMany({
      where: {
        status: { in: ['LOBBY', 'RUNNING'] },
        players: { some: { userId: request.user!.id } },
      },
      select: PARTIE_AUSWAHL,
      orderBy: { createdAt: 'desc' },
    });

    return partien.map(partieNachAussen);
  });

  app.post('/api/matches', async (request, reply) => {
    const parsed = anlegenSchema.safeParse(request.body);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      return reply.code(400).send({
        error: flat.formErrors[0] ?? Object.values(flat.fieldErrors).flat()[0] ?? 'Ungültige Eingabe',
        details: flat.fieldErrors,
      });
    }

    const { gameSlug, name, settings } = parsed.data;

    const spiel = await prisma.game.findUnique({ where: { slug: gameSlug } });
    if (!spiel || !spiel.isActive) {
      return reply.code(400).send({ error: 'Diese Spielart gibt es nicht' });
    }

    const geprueft = einstellungenPruefen(gameSlug, settings);
    if (!geprueft.ok) {
      return reply.code(400).send({ error: geprueft.fehler });
    }

    // Bei einer Kollision einfach neu wuerfeln. Bei 32^6 Moeglichkeiten und
    // einer Handvoll offener Lobbys passiert das praktisch nie.
    for (let versuch = 0; versuch < 5; versuch++) {
      try {
        const angelegt = await prisma.match.create({
          data: {
            code: codeErzeugen(),
            name,
            gameId: spiel.id,
            createdById: request.user!.id,
            settings: geprueft.werte as Prisma.InputJsonValue,
            // Wer die Lobby oeffnet, leitet sie auch.
            players: { create: { userId: request.user!.id, isGamemaster: true } },
          },
          select: PARTIE_AUSWAHL,
        });

        return reply.code(201).send(partieNachAussen(angelegt));
      } catch (error) {
        const kollision =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!kollision) throw error;
      }
    }

    return reply.code(503).send({ error: 'Es konnte kein freier Code gefunden werden' });
  });

  app.get('/api/matches/:code', async (request, reply) => {
    const params = codeParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Ungültiger Beitrittscode' });

    try {
      const partie = await partieLaden({ code: params.data.code });

      // Wer nicht mitspielt, darf eine wartende Lobby sehen -- sonst wuesste
      // er vor dem Beitreten nicht, worauf er sich einlaesst. In eine laufende
      // oder beendete Partie schaut er nicht hinein.
      const dabei = partie.players.some((p) => p.userId === request.user!.id);
      if (!dabei && partie.status !== 'LOBBY') {
        throw new PartieFehler(403, 'Diese Partie läuft bereits');
      }

      return partieNachAussen(partie);
    } catch (error) {
      if (error instanceof PartieFehler) {
        return reply.code(error.status).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post('/api/matches/:code/join', async (request, reply) => {
    const params = codeParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Ungültiger Beitrittscode' });

    try {
      const partie = await prisma.$transaction(async (tx) => {
        const gefunden = await tx.match.findUnique({
          where: { code: params.data.code },
          select: PARTIE_AUSWAHL,
        });
        if (!gefunden) throw new PartieFehler(404, 'Diesen Code gibt es nicht');

        // Wer schon drin ist, kommt einfach wieder rein -- etwa nach einem
        // Neuladen der Seite.
        if (gefunden.players.some((p) => p.userId === request.user!.id)) return gefunden;

        statusPruefen(gefunden, 'LOBBY', 'Die Partie läuft bereits');

        // Die Spielleitung zaehlt nicht als Mitspieler, deshalb ein Platz mehr.
        if (gefunden.players.length >= gefunden.game.maxPlayers + 1) {
          throw new PartieFehler(409, 'Die Lobby ist voll');
        }

        await tx.matchPlayer.create({ data: { matchId: gefunden.id, userId: request.user!.id } });

        return tx.match.findUniqueOrThrow({ where: { id: gefunden.id }, select: PARTIE_AUSWAHL });
      });

      await liveZustandSenden(partie.code);
      return partieNachAussen(partie);
    } catch (error) {
      if (error instanceof PartieFehler) {
        return reply.code(error.status).send({ error: error.message });
      }
      throw error;
    }
  });

  /** Verlassen geht nur, solange die Partie wartet -- danach fehlte sonst ein Gegner. */
  app.post('/api/matches/:code/leave', async (request, reply) => {
    const params = codeParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Ungültiger Beitrittscode' });

    try {
      const partie = await partieLaden({ code: params.data.code });
      statusPruefen(partie, 'LOBBY', 'Eine laufende Partie kann nicht verlassen werden');

      const eintrag = partie.players.find((p) => p.userId === request.user!.id);
      if (!eintrag) throw new PartieFehler(404, 'Du bist in dieser Partie nicht dabei');

      if (eintrag.isGamemaster) {
        // Ohne Leitung ist die Lobby wertlos -- dann lieber ganz abbrechen.
        await prisma.match.update({
          where: { id: partie.id },
          data: { status: 'ABORTED', finishedAt: new Date() },
        });
      } else {
        await prisma.matchPlayer.deleteMany({
          where: { matchId: partie.id, userId: request.user!.id },
        });
      }

      await liveZustandSenden(partie.code);
      if (eintrag.isGamemaster) liveZustandVerwerfen(partie.code);

      return reply.code(204).send();
    } catch (error) {
      if (error instanceof PartieFehler) {
        return reply.code(error.status).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post('/api/matches/:code/start', async (request, reply) => {
    const params = codeParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Ungültiger Beitrittscode' });

    try {
      const partie = await partieLaden({ code: params.data.code });
      leitungPruefen(partie, request.user!.id);
      statusPruefen(partie, 'LOBBY', 'Die Partie wurde bereits gestartet');

      if (partie.players.filter((p) => !p.isGamemaster).length < 1) {
        throw new PartieFehler(409, 'Es ist noch niemand beigetreten');
      }

      const gestartet = await prisma.match.update({
        where: { id: partie.id },
        data: { status: 'RUNNING', startedAt: new Date() },
        select: PARTIE_AUSWAHL,
      });

      await liveZustandSenden(gestartet.code);
      return partieNachAussen(gestartet);
    } catch (error) {
      if (error instanceof PartieFehler) {
        return reply.code(error.status).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post('/api/matches/:code/finish', async (request, reply) => {
    const params = codeParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Ungültiger Beitrittscode' });

    try {
      const ergebnis = await prisma.$transaction(async (tx) => {
        const aktuell = await tx.match.findUnique({
          where: { code: params.data.code },
          select: PARTIE_AUSWAHL,
        });
        if (!aktuell) throw new PartieFehler(404, 'Partie nicht gefunden');

        leitungPruefen(aktuell, request.user!.id);
        statusPruefen(aktuell, 'RUNNING', 'Die Partie läuft nicht');

        const { gewertet } = await ergebnisseFestschreiben(tx, aktuell.id);

        await tx.match.update({
          where: { id: aktuell.id },
          data: { status: 'FINISHED', finishedAt: new Date() },
        });

        const fertig = await tx.match.findUniqueOrThrow({
          where: { id: aktuell.id },
          select: PARTIE_AUSWAHL,
        });

        return { partie: fertig, gewertet };
      });

      await liveZustandSenden(ergebnis.partie.code);
      liveZustandVerwerfen(ergebnis.partie.code);

      return { ...partieNachAussen(ergebnis.partie), gewertet: ergebnis.gewertet };
    } catch (error) {
      if (error instanceof PartieFehler) {
        return reply.code(error.status).send({ error: error.message });
      }
      throw error;
    }
  });

  /** Abbruch zaehlt fuer keine Statistik -- genau dafuer ist er da. */
  app.post('/api/matches/:code/abort', async (request, reply) => {
    const params = codeParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Ungültiger Beitrittscode' });

    try {
      const partie = await partieLaden({ code: params.data.code });
      leitungPruefen(partie, request.user!.id);

      if (partie.status === 'FINISHED' || partie.status === 'ABORTED') {
        throw new PartieFehler(409, 'Die Partie ist bereits vorbei');
      }

      const abgebrochen = await prisma.match.update({
        where: { id: partie.id },
        data: { status: 'ABORTED', finishedAt: new Date() },
        select: PARTIE_AUSWAHL,
      });

      await liveZustandSenden(abgebrochen.code);
      liveZustandVerwerfen(abgebrochen.code);

      return partieNachAussen(abgebrochen);
    } catch (error) {
      if (error instanceof PartieFehler) {
        return reply.code(error.status).send({ error: error.message });
      }
      throw error;
    }
  });
}
