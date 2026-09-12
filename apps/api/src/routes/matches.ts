import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { Prisma, type MatchStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/guards.js';
import { einstellungenPruefen, spielart, standardEinstellungen } from '../games/index.js';
import {
  PARTIE_AUSWAHL,
  partieAbschliessen,
  partieNachAussen,
  type PartieRoh,
} from '../lib/partie.js';
import {
  liveZustandSenden,
  liveZustandVerwerfen,
  livePartieGestartet,
} from '../lib/realtime.js';

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

/** Hoechstens so viele Etiketten je Lobby -- darunter sagt eine Liste nichts mehr. */
const MAX_ETIKETTEN = 6;

const etikettenFeld = z.array(z.string().min(1).max(64)).max(MAX_ETIKETTEN);

const anlegenSchema = z.object({
  gameSlug: z.string().min(1),
  name: z.string().trim().min(1, 'Bitte einen Namen vergeben').max(60),
  // Privat ist die vorsichtigere Vorgabe: Wer eine Runde nur mit Freunden
  // spielen will, soll das nicht erst einstellen muessen.
  oeffentlich: z.boolean().default(false),
  etiketten: etikettenFeld.optional(),
  // Wird gegen die Spielart geprueft, sobald die feststeht.
  settings: z.record(z.string(), z.unknown()).optional(),
});

/** Alles optional: Die Lobby schickt nur, was sich geaendert hat. */
const aendernSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    oeffentlich: z.boolean().optional(),
    etiketten: etikettenFeld.optional(),
  })
  .refine((daten) => Object.keys(daten).length > 0, {
    message: 'Es wurde keine Änderung übermittelt',
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

/** Wie viele Plaetze belegt sind. Die Buzzer-Leitung zaehlt nicht mit. */
function belegt(partie: PartieRoh): number {
  return partie.players.filter((p) => p.isPlaying).length;
}

/**
 * Loest die gewaehlten Etiketten auf.
 *
 * Ein unbekanntes oder abgeschaltetes Etikett ist ein Fehler und wird nicht
 * still verschluckt: Sonst spielte jemand mit einem Wortvorrat, den er so
 * nicht ausgewaehlt hat.
 *
 * `slug` ist die Spielart: Themen gehoeren nur zu Spielen, die Woerter daraus
 * ziehen. Am Buzzer waeren sie ein Etikett ohne Wirkung -- und ein Schalter,
 * der nichts tut, ist schlimmer als keiner.
 */
async function etikettenAufloesen(slugs: string[], spielSlug: string): Promise<string[]> {
  if (slugs.length > 0 && !spielart(spielSlug)?.brauchtWoerter) {
    throw new PartieFehler(400, 'Diese Spielart arbeitet nicht mit Themen');
  }

  if (slugs.length === 0) return [];

  const eindeutig = [...new Set(slugs)];
  const gefunden = await prisma.tag.findMany({
    where: { slug: { in: eindeutig }, isActive: true },
    select: { id: true, slug: true },
  });

  if (gefunden.length !== eindeutig.length) {
    const fehlend = eindeutig.filter((s) => !gefunden.some((g) => g.slug === s));
    throw new PartieFehler(400, `Unbekanntes Thema: ${fehlend.join(', ')}`);
  }

  return gefunden.map((g) => g.id);
}

/**
 * Fasst die immer gleiche Fehlerbehandlung der Routen zusammen: Ein
 * Regelverstoss wird zu seinem Status, alles andere faellt durch zum
 * Fehlerbehandler und damit ins Log.
 */
function alsAntwort(error: unknown, reply: FastifyReply) {
  if (error instanceof PartieFehler) {
    return reply.code(error.status).send({ error: error.message });
  }
  throw error;
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

    return aktive.map((spiel) => ({
      ...spiel,
      // Ohne diese Vorgaben muesste das Formular die Standardwerte selbst
      // kennen -- dann staenden sie an zwei Stellen und liefen auseinander.
      standardEinstellungen: standardEinstellungen(spiel.slug),
    }));
  });

  /** Die Themengebiete, aus denen eine Lobby waehlen kann. */
  app.get('/api/tags', async () => {
    const etiketten = await prisma.tag.findMany({
      where: { isActive: true },
      select: {
        slug: true,
        name: true,
        color: true,
        _count: { select: { words: true } },
      },
      orderBy: { name: 'asc' },
    });

    return etiketten.map((e) => ({
      slug: e.slug,
      name: e.name,
      farbe: e.color,
      woerter: e._count.words,
    }));
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

  /**
   * Die offenen Lobbys fuer die Startseite.
   *
   * Nur wartende und nur oeffentliche: Eine private Lobby soll ohne ihren
   * Code nicht auffindbar sein -- das ist der ganze Unterschied zwischen den
   * beiden Einstellungen.
   */
  app.get('/api/matches/oeffentlich', async (request) => {
    const partien = await prisma.match.findMany({
      where: {
        status: 'LOBBY',
        visibility: 'PUBLIC',
        // Wo man schon drinsitzt, steht weiter oben unter "Du bist dabei".
        players: { none: { userId: request.user!.id } },
      },
      select: PARTIE_AUSWAHL,
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    return partien.map(partieNachAussen);
  });

  app.post('/api/matches', async (request, reply) => {
    const parsed = anlegenSchema.safeParse(request.body);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      return reply.code(400).send({
        error:
          flat.formErrors[0] ?? Object.values(flat.fieldErrors).flat()[0] ?? 'Ungültige Eingabe',
        details: flat.fieldErrors,
      });
    }

    const { gameSlug, name, settings, oeffentlich, etiketten } = parsed.data;

    const spiel = await prisma.game.findUnique({ where: { slug: gameSlug } });
    const modul = spielart(gameSlug);
    if (!spiel || !spiel.isActive || !modul) {
      return reply.code(400).send({ error: 'Diese Spielart gibt es nicht' });
    }

    const geprueft = einstellungenPruefen(gameSlug, settings);
    if (!geprueft.ok) {
      return reply.code(400).send({ error: geprueft.fehler });
    }

    try {
      const tagIds = await etikettenAufloesen(etiketten ?? [], gameSlug);

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
              visibility: oeffentlich ? 'PUBLIC' : 'PRIVATE',
              settings: geprueft.werte as Prisma.InputJsonValue,
              tags: { create: tagIds.map((tagId) => ({ tagId })) },
              // Wer die Lobby oeffnet, leitet sie auch. Ob sie dabei mitspielt,
              // sagt die Spielart: Beim Buzzer stellt sie nur Fragen.
              players: {
                create: {
                  userId: request.user!.id,
                  isGamemaster: true,
                  isPlaying: modul.leitungSpieltMit,
                },
              },
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
    } catch (error) {
      return alsAntwort(error, reply);
    }
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
      return alsAntwort(error, reply);
    }
  });

  /**
   * Lobby einstellen: Name, Sichtbarkeit und Themen.
   *
   * Nur solange sie wartet. Waehrend der Partie waere eine Aenderung am
   * Wortvorrat mitten im Zug schwer zu erklaeren, und die Sichtbarkeit hat
   * dann ohnehin keine Wirkung mehr.
   */
  app.patch('/api/matches/:code', async (request, reply) => {
    const params = codeParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Ungültiger Beitrittscode' });

    const parsed = aendernSchema.safeParse(request.body);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      return reply.code(400).send({
        error:
          flat.formErrors[0] ?? Object.values(flat.fieldErrors).flat()[0] ?? 'Ungültige Eingabe',
      });
    }

    try {
      const partie = await partieLaden({ code: params.data.code });
      leitungPruefen(partie, request.user!.id);
      statusPruefen(partie, 'LOBBY', 'Die Lobby lässt sich nur vor dem Start einstellen');

      const { name, oeffentlich, etiketten } = parsed.data;
      const tagIds = etiketten ? await etikettenAufloesen(etiketten, partie.game.slug) : null;

      const geaendert = await prisma.$transaction(async (tx) => {
        if (tagIds) {
          // Ersetzen statt abgleichen: Die Liste ist kurz, und so kann kein
          // Etikett stehen bleiben, das gerade abgewaehlt wurde.
          await tx.matchTag.deleteMany({ where: { matchId: partie.id } });
          await tx.matchTag.createMany({
            data: tagIds.map((tagId) => ({ matchId: partie.id, tagId })),
          });
        }

        return tx.match.update({
          where: { id: partie.id },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(oeffentlich !== undefined
              ? { visibility: oeffentlich ? ('PUBLIC' as const) : ('PRIVATE' as const) }
              : {}),
          },
          select: PARTIE_AUSWAHL,
        });
      });

      await liveZustandSenden(geaendert.code);
      return partieNachAussen(geaendert);
    } catch (error) {
      return alsAntwort(error, reply);
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

        if (belegt(gefunden) >= gefunden.game.maxPlayers) {
          throw new PartieFehler(409, 'Die Lobby ist voll');
        }

        await tx.matchPlayer.create({ data: { matchId: gefunden.id, userId: request.user!.id } });

        return tx.match.findUniqueOrThrow({ where: { id: gefunden.id }, select: PARTIE_AUSWAHL });
      });

      await liveZustandSenden(partie.code);
      return partieNachAussen(partie);
    } catch (error) {
      return alsAntwort(error, reply);
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
      return alsAntwort(error, reply);
    }
  });

  app.post('/api/matches/:code/start', async (request, reply) => {
    const params = codeParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Ungültiger Beitrittscode' });

    try {
      const partie = await partieLaden({ code: params.data.code });
      leitungPruefen(partie, request.user!.id);
      statusPruefen(partie, 'LOBBY', 'Die Partie wurde bereits gestartet');

      const modul = spielart(partie.game.slug);
      const noetig = modul?.minZumStart ?? 1;

      if (belegt(partie) < noetig) {
        throw new PartieFehler(
          409,
          noetig === 1
            ? 'Es ist noch niemand beigetreten'
            : `Dafür braucht es mindestens ${noetig} Mitspielende`,
        );
      }

      const gestartet = await prisma.match.update({
        where: { id: partie.id },
        data: { status: 'RUNNING', startedAt: new Date() },
        select: PARTIE_AUSWAHL,
      });

      // Erst der Status, dann das Spiel: Scribble legt hier seinen ersten Zug
      // an und schickt ihn selbst raus.
      await liveZustandSenden(gestartet.code);
      await livePartieGestartet(gestartet.code, gestartet.game.slug);

      return partieNachAussen(gestartet);
    } catch (error) {
      return alsAntwort(error, reply);
    }
  });

  app.post('/api/matches/:code/finish', async (request, reply) => {
    const params = codeParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Ungültiger Beitrittscode' });

    try {
      const partie = await partieLaden({ code: params.data.code });
      leitungPruefen(partie, request.user!.id);
      statusPruefen(partie, 'RUNNING', 'Die Partie läuft nicht');

      const ergebnis = await partieAbschliessen(partie.code);
      if (!ergebnis) throw new PartieFehler(409, 'Die Partie läuft nicht');

      await liveZustandSenden(ergebnis.partie.code);
      liveZustandVerwerfen(ergebnis.partie.code);

      return { ...partieNachAussen(ergebnis.partie), gewertet: ergebnis.gewertet };
    } catch (error) {
      return alsAntwort(error, reply);
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
      return alsAntwort(error, reply);
    }
  });
}
