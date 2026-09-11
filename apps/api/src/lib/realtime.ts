import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { prisma } from './prisma.js';
import { env } from './env.js';
import { SESSION_COOKIE, resolveSession, type SessionUser } from './session.js';

/**
 * Der Live-Teil einer Partie: was gerade getippt wurde, wer gebuzzert hat und
 * welche Runde laeuft.
 *
 * Bewusst nur im Arbeitsspeicher. Diese Werte gelten je Frage fuer ein paar
 * Sekunden -- sie in die Datenbank zu schreiben hiesse, bei jedem Tastendruck
 * zu schreiben. Was bleiben muss, steht dort: Punkte, Teilnehmer, Status.
 * Ein Neustart der API kostet also die laufende Runde, nicht den Spielstand.
 */
interface LiveSpieler {
  text: string;
  /** Millisekunden seit Rundenstart, null solange nicht gebuzzert. */
  gebuzzertUm: number | null;
  /** Mehrere offene Tabs zaehlen mit, sonst wirkt der Spieler beim Schliessen eines Tabs offline. */
  verbindungen: number;
}

interface LivePartie {
  runde: number;
  rundeLaeuft: boolean;
  rundeGestartetUm: number | null;
  spieler: Map<string, LiveSpieler>;
}

const partien = new Map<string, LivePartie>();

let io: Server | null = null;

const TEXT_MAX = 200;

function livePartie(code: string): LivePartie {
  let partie = partien.get(code);
  if (!partie) {
    partie = { runde: 0, rundeLaeuft: false, rundeGestartetUm: null, spieler: new Map() };
    partien.set(code, partie);
  }
  return partie;
}

function liveSpieler(partie: LivePartie, userId: string): LiveSpieler {
  let spieler = partie.spieler.get(userId);
  if (!spieler) {
    spieler = { text: '', gebuzzertUm: null, verbindungen: 0 };
    partie.spieler.set(userId, spieler);
  }
  return spieler;
}

const raum = (code: string) => `partie:${code}`;
const raumLeitung = (code: string) => `partie:${code}:leitung`;

/**
 * Liest einen Cookie-Wert aus dem Handshake.
 *
 * Der Socket geht nicht durch Fastify, also steht hier kein geparster Cookie
 * bereit. Der Session-Token ist base64url -- fuer diesen einen Wert reicht
 * das Aufteilen, ohne eine Bibliothek dafuer hereinzuholen.
 */
function cookieLesen(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const teil of header.split(';')) {
    const trenner = teil.indexOf('=');
    if (trenner === -1) continue;
    if (teil.slice(0, trenner).trim() !== name) continue;
    return decodeURIComponent(teil.slice(trenner + 1).trim());
  }

  return undefined;
}

interface SocketDaten {
  user: SessionUser;
  code?: string;
  istLeitung?: boolean;
}

type PartieSocket = Socket & { data: SocketDaten };

/** Der Zustand, wie ihn die Oberflaeche bekommt. */
interface Zustand {
  code: string;
  name: string;
  status: string;
  spiel: { slug: string; name: string };
  einstellungen: Record<string, unknown>;
  runde: { nummer: number; laeuft: boolean; gestartetUm: number | null };
  teilnehmer: Array<{
    userId: string;
    displayName: string;
    istLeitung: boolean;
    punkte: number;
    verbunden: boolean;
    gebuzzertUm: number | null;
    /** Rang am Buzzer: 1 fuer den Ersten. Null, wer nicht gebuzzert hat. */
    buzzerPlatz: number | null;
    /** Nur fuer die Spielleitung -- oder fuer alle, wenn so eingestellt. */
    text?: string;
  }>;
}

/**
 * Baut den Zustand aus Datenbank und Live-Teil zusammen.
 *
 * `mitTexten` entscheidet, ob die getippten Antworten mitgehen: die Leitung
 * sieht sie immer, die Mitspieler nur, wenn die Partie darauf eingestellt ist.
 */
async function zustandBauen(code: string, mitTexten: boolean): Promise<Zustand | null> {
  const partie = await prisma.match.findUnique({
    where: { code },
    select: {
      code: true,
      name: true,
      status: true,
      settings: true,
      game: { select: { slug: true, name: true } },
      players: {
        select: {
          userId: true,
          isGamemaster: true,
          score: true,
          user: { select: { displayName: true } },
        },
        orderBy: { joinedAt: 'asc' },
      },
    },
  });

  if (!partie) return null;

  const live = livePartie(code);

  // Reihenfolge am Buzzer: wer zuerst gedrueckt hat, steht auf 1.
  const reihenfolge = [...live.spieler.entries()]
    .filter(([, s]) => s.gebuzzertUm !== null)
    .sort((a, b) => (a[1].gebuzzertUm ?? 0) - (b[1].gebuzzertUm ?? 0))
    .map(([userId]) => userId);

  return {
    code: partie.code,
    name: partie.name,
    status: partie.status,
    spiel: partie.game,
    einstellungen: (partie.settings ?? {}) as Record<string, unknown>,
    runde: {
      nummer: live.runde,
      laeuft: live.rundeLaeuft,
      gestartetUm: live.rundeGestartetUm,
    },
    teilnehmer: partie.players.map((p) => {
      const s = live.spieler.get(p.userId);
      const platz = reihenfolge.indexOf(p.userId);

      return {
        userId: p.userId,
        displayName: p.user.displayName,
        istLeitung: p.isGamemaster,
        punkte: p.score ?? 0,
        verbunden: (s?.verbindungen ?? 0) > 0,
        gebuzzertUm: s?.gebuzzertUm ?? null,
        buzzerPlatz: platz === -1 ? null : platz + 1,
        ...(mitTexten ? { text: s?.text ?? '' } : {}),
      };
    }),
  };
}

function antwortenOeffentlich(zustand: Zustand): boolean {
  return zustand.einstellungen['antwortenOeffentlich'] === true;
}

/**
 * Schickt den aktuellen Zustand an alle im Raum.
 *
 * Wird auch von den REST-Routen aufgerufen: wer beitritt oder die Partie
 * startet, tut das ueber HTTP -- die anderen im Raum sollen es trotzdem
 * sofort sehen, ohne die Seite neu zu laden.
 */
export async function liveZustandSenden(code: string): Promise<void> {
  if (!io) return;

  const fuerLeitung = await zustandBauen(code, true);
  if (!fuerLeitung) return;

  io.to(raumLeitung(code)).emit('zustand', fuerLeitung);

  // Die Leitung ist nur im Leitungsraum, bekommt diesen Aufruf also nicht
  // doppelt -- und die Mitspieler sehen die Texte nur, wenn es erlaubt ist.
  const fuerSpieler = antwortenOeffentlich(fuerLeitung)
    ? fuerLeitung
    : await zustandBauen(code, false);

  if (fuerSpieler) io.to(raum(code)).emit('zustand', fuerSpieler);
}

/** Raeumt den Live-Teil weg, sobald eine Partie vorbei ist. */
export function liveZustandVerwerfen(code: string): void {
  partien.delete(code);
}

const textSchema = z.object({ text: z.string().max(TEXT_MAX) });
const punkteSchema = z.object({
  userId: z.string().uuid(),
  punkte: z.number().int().min(-1000).max(1000),
});

/**
 * Haengt die Socket-Verbindung an den laufenden HTTP-Server.
 *
 * Der Pfad liegt bewusst unter /api: so reicht der bestehende nginx-Block im
 * Betrieb und der Angular-Proxy in der Entwicklung -- ohne eine zweite Stelle,
 * an der ein Pfad weitergereicht werden muss.
 */
export function realtimeStarten(app: FastifyInstance): Server {
  io = new Server(app.server, {
    path: '/api/socket.io',
    // Gleiche Origin wie die Anwendung; das Session-Cookie muss mit.
    cors: { origin: env.APP_ORIGIN, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = cookieLesen(socket.handshake.headers.cookie, SESSION_COOKIE);
      const user = token ? await resolveSession(token) : null;

      if (!user) return next(new Error('Nicht angemeldet'));

      (socket as PartieSocket).data.user = user;
      next();
    } catch (error) {
      app.log.error({ err: error }, 'Socket-Anmeldung fehlgeschlagen');
      next(new Error('Anmeldung fehlgeschlagen'));
    }
  });

  io.on('connection', (verbindung) => {
    const socket = verbindung as PartieSocket;

    socket.on('partie:betreten', async (nutzlast: unknown) => {
      const code = typeof nutzlast === 'string' ? nutzlast.toUpperCase() : '';

      const partie = await prisma.match.findUnique({
        where: { code },
        select: { code: true, players: { select: { userId: true, isGamemaster: true } } },
      });

      const eintrag = partie?.players.find((p) => p.userId === socket.data.user.id);
      if (!partie || !eintrag) {
        socket.emit('fehler', { nachricht: 'Diese Partie gibt es nicht oder du bist nicht dabei' });
        return;
      }

      socket.data.code = partie.code;
      socket.data.istLeitung = eintrag.isGamemaster;

      // Leitung und Mitspieler sitzen in getrennten Raeumen: nur so lassen
      // sich die getippten Antworten gezielt zurueckhalten.
      await socket.join(eintrag.isGamemaster ? raumLeitung(partie.code) : raum(partie.code));

      const live = livePartie(partie.code);
      liveSpieler(live, socket.data.user.id).verbindungen += 1;

      await liveZustandSenden(partie.code);
    });

    socket.on('text:setzen', async (nutzlast: unknown) => {
      const code = socket.data.code;
      if (!code || socket.data.istLeitung) return;

      const geprueft = textSchema.safeParse(nutzlast);
      if (!geprueft.success) return;

      const live = livePartie(code);
      liveSpieler(live, socket.data.user.id).text = geprueft.data.text;

      const meldung = { userId: socket.data.user.id, text: geprueft.data.text };

      // Der Text geht einzeln raus statt als ganzer Zustand: er aendert sich
      // bei jedem Tastendruck, alles andere nicht.
      io?.to(raumLeitung(code)).emit('spieler:text', meldung);

      const zustand = await zustandBauen(code, false);
      if (zustand && antwortenOeffentlich(zustand)) {
        socket.to(raum(code)).emit('spieler:text', meldung);
      }
    });

    socket.on('buzzern', async () => {
      const code = socket.data.code;
      if (!code || socket.data.istLeitung) return;

      const live = livePartie(code);
      if (!live.rundeLaeuft || live.rundeGestartetUm === null) return;

      const spieler = liveSpieler(live, socket.data.user.id);

      const zustand = await zustandBauen(code, false);
      const nurEinmal = zustand?.einstellungen['nurEinmalBuzzern'] !== false;
      if (spieler.gebuzzertUm !== null && nurEinmal) return;

      spieler.gebuzzertUm = Date.now() - live.rundeGestartetUm;
      await liveZustandSenden(code);
    });

    socket.on('runde:starten', async () => {
      const code = socket.data.code;
      if (!code || !socket.data.istLeitung) return;

      const live = livePartie(code);
      live.runde += 1;
      live.rundeLaeuft = true;
      live.rundeGestartetUm = Date.now();

      // Neue Frage, leeres Blatt: alte Antworten und Buzzer wegraeumen.
      for (const spieler of live.spieler.values()) {
        spieler.text = '';
        spieler.gebuzzertUm = null;
      }

      await liveZustandSenden(code);
    });

    socket.on('runde:stoppen', async () => {
      const code = socket.data.code;
      if (!code || !socket.data.istLeitung) return;

      const live = livePartie(code);
      live.rundeLaeuft = false;

      await liveZustandSenden(code);
    });

    socket.on('punkte:geben', async (nutzlast: unknown) => {
      const code = socket.data.code;
      if (!code || !socket.data.istLeitung) return;

      const geprueft = punkteSchema.safeParse(nutzlast);
      if (!geprueft.success) return;

      const partie = await prisma.match.findUnique({
        where: { code },
        select: { id: true, status: true },
      });
      if (!partie || partie.status !== 'RUNNING') return;

      // Punkte gehen sofort in die Datenbank: sie sind das Einzige aus der
      // laufenden Partie, das einen Neustart der API ueberleben muss.
      //
      // Lesen und Schreiben statt `increment`: `score` darf leer sein, und in
      // SQL bleibt NULL + 20 wieder NULL -- die ersten Punkte einer Partie
      // waeren sonst spurlos verschwunden.
      const geaendert = await prisma.$transaction(async (tx) => {
        const eintrag = await tx.matchPlayer.findFirst({
          where: { matchId: partie.id, userId: geprueft.data.userId, isGamemaster: false },
          select: { id: true, score: true },
        });
        if (!eintrag) return false;

        await tx.matchPlayer.update({
          where: { id: eintrag.id },
          data: { score: (eintrag.score ?? 0) + geprueft.data.punkte },
        });

        return true;
      });

      if (geaendert) await liveZustandSenden(code);
    });

    socket.on('disconnect', async () => {
      const code = socket.data.code;
      if (!code) return;

      const live = partien.get(code);
      const spieler = live?.spieler.get(socket.data.user.id);
      if (!live || !spieler) return;

      spieler.verbindungen = Math.max(0, spieler.verbindungen - 1);
      await liveZustandSenden(code);
    });
  });

  return io;
}
