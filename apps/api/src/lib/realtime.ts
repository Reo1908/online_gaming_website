import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { prisma } from './prisma.js';
import { env } from './env.js';
import { SESSION_COOKIE, resolveSession, type SessionUser } from './session.js';
import { partieInfoLaden, partieAbschliessen, woerterZurPartie } from './partie.js';
import { brueckeSetzen } from '../games/bruecke.js';
import { liveVerwerfen, spielart } from '../games/index.js';
import type { PartieInfo, SpielKontext, SpielModul, Zuschauer } from '../games/typen.js';

/**
 * Der Draht zwischen Browser und Spiel.
 *
 * Diese Datei kennt kein einziges Spiel. Sie meldet Sockets an, haelt sie je
 * Partie zusammen, baut den gemeinsamen Teil des Zustands (wer ist da, wer
 * ist online, wie stehen die Punkte) und reicht alles Uebrige an das Modul
 * der Spielart weiter. Was ein Buzzer oder ein Pinselstrich ist, steht in
 * `src/games/` -- hier nicht.
 */

interface SocketDaten {
  user: SessionUser;
  code?: string;
  istLeitung?: boolean;
}

type PartieSocket = Socket & { data: SocketDaten };

let io: Server | null = null;

/**
 * Die offenen Verbindungen je Partie.
 *
 * Bewusst eine eigene Liste statt der Socket.IO-Raeume: Der Zustand faellt
 * fuer jeden anders aus -- beim Scribble sieht der Zeichner das Wort, die
 * anderen nur die Luecken. Dafuer muss jeder Socket einzeln erreichbar sein,
 * und ein Raum gibt genau das nicht her.
 */
const verbindungen = new Map<string, Set<PartieSocket>>();

function sockets(code: string): Set<PartieSocket> {
  let menge = verbindungen.get(code);
  if (!menge) {
    menge = new Set();
    verbindungen.set(code, menge);
  }
  return menge;
}

function istVerbunden(code: string, userId: string): boolean {
  for (const socket of verbindungen.get(code) ?? []) {
    if (socket.data.user.id === userId) return true;
  }
  return false;
}

// ---------- Zustand senden --------------------------------------------------

/**
 * Schickt den aktuellen Zustand an alle in der Partie -- jedem seine Sicht.
 *
 * Wird auch von den REST-Routen aufgerufen: Wer beitritt oder die Partie
 * startet, tut das ueber HTTP. Die anderen sollen es trotzdem sofort sehen,
 * ohne die Seite neu zu laden.
 */
export async function liveZustandSenden(code: string): Promise<void> {
  const offen = verbindungen.get(code);
  if (!io || !offen || offen.size === 0) return;

  const partie = await partieInfoLaden(code, (userId) => istVerbunden(code, userId));
  if (!partie) return;

  const spiel = spielart(partie.spiel.slug);

  // Einmal aus der Datenbank lesen, dann je Zuschauer nur noch formen: Der
  // teure Teil ist die Abfrage, nicht das Zusammensetzen.
  for (const socket of offen) {
    const fuer: Zuschauer = {
      userId: socket.data.user.id,
      istLeitung: socket.data.istLeitung === true,
    };
    socket.emit('zustand', zustandFuer(partie, spiel, fuer));
  }
}

function zustandFuer(partie: PartieInfo, spiel: SpielModul | undefined, fuer: Zuschauer) {
  return {
    code: partie.code,
    name: partie.name,
    status: partie.status,
    oeffentlich: partie.oeffentlich,
    spiel: partie.spiel,
    einstellungen: partie.einstellungen,
    etiketten: partie.etiketten,
    teilnehmer: partie.teilnehmer.map((t) => ({
      ...t,
      ...(spiel?.spielerSicht?.(partie, t.userId, fuer) ?? {}),
    })),
    // Alles Spielabhaengige liegt unter einem Schluessel statt verstreut im
    // Zustand: So kann eine neue Spielart ihn fuellen, ohne dass jemand hier
    // etwas dazuschreibt.
    spielZustand: spiel?.sicht(partie, fuer) ?? null,
  };
}

// ---------- Kontext fuer die Spielmodule ------------------------------------

/**
 * Baut den Kontext, mit dem ein Spielmodul nach aussen spricht.
 *
 * `ausloeser` fehlt, wenn das Spiel selbst etwas anstoesst -- etwa wenn beim
 * Scribble die Zeit ablaeuft und gerade niemand etwas gedrueckt hat.
 */
function kontext(code: string, ausloeser?: PartieSocket): SpielKontext {
  const an = (userId: string, ereignis: string, daten: unknown) => {
    for (const socket of verbindungen.get(code) ?? []) {
      // Ueber alle offenen Tabs derselben Person, nicht nur den einen Socket.
      if (socket.data.user.id === userId) socket.emit(ereignis, daten);
    }
  };

  return {
    code,
    userId: ausloeser?.data.user.id ?? '',
    istLeitung: ausloeser?.data.istLeitung === true,

    anAlle(ereignis, daten) {
      for (const socket of verbindungen.get(code) ?? []) socket.emit(ereignis, daten);
    },

    anAndere(ereignis, daten) {
      for (const socket of verbindungen.get(code) ?? []) {
        if (socket !== ausloeser) socket.emit(ereignis, daten);
      }
    },

    an,

    anLeitung(ereignis, daten) {
      for (const socket of verbindungen.get(code) ?? []) {
        if (socket.data.istLeitung) socket.emit(ereignis, daten);
      }
    },

    senden: () => liveZustandSenden(code),

    partie: () => partieInfoLaden(code, (userId) => istVerbunden(code, userId)),

    woerter: () => woerterZurPartie(code),

    async punkteGeben(userId, punkte) {
      // Lesen und Schreiben statt `increment`: `score` darf leer sein, und in
      // SQL bleibt NULL + 20 wieder NULL -- die ersten Punkte einer Partie
      // waeren sonst spurlos verschwunden.
      return prisma.$transaction(async (tx) => {
        const partie = await tx.match.findUnique({ where: { code }, select: { id: true } });
        if (!partie) return false;

        const eintrag = await tx.matchPlayer.findFirst({
          where: { matchId: partie.id, userId, isPlaying: true },
          select: { id: true, score: true },
        });
        if (!eintrag) return false;

        await tx.matchPlayer.update({
          where: { id: eintrag.id },
          data: { score: (eintrag.score ?? 0) + punkte },
        });

        return true;
      });
    },

    async beenden() {
      const ergebnis = await partieAbschliessen(code);
      if (!ergebnis) return;

      // Erst senden, dann wegraeumen: Sonst steht der Endstand niemandem mehr
      // zur Verfuegung, der ihn gerade sehen sollte.
      await liveZustandSenden(code);
      liveVerwerfen(code);
    },
  };
}

/** Raeumt den Live-Teil weg, sobald eine Partie vorbei ist. */
export function liveZustandVerwerfen(code: string): void {
  liveVerwerfen(code);
}

/**
 * Sagt dem Spielmodul, dass die Partie losgeht.
 *
 * Wird von der Start-Route gerufen: Scribble legt hier seinen Zug an, der
 * Buzzer braucht nichts davon.
 */
export async function livePartieGestartet(code: string, slug: string): Promise<void> {
  const spiel = spielart(slug);
  if (!spiel?.gestartet) return;

  await spiel.gestartet(kontext(code));
}

// ---------- Anmeldung -------------------------------------------------------

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

/**
 * Haengt die Socket-Verbindung an den laufenden HTTP-Server.
 *
 * Der Pfad liegt bewusst unter /api: So reicht der bestehende nginx-Block im
 * Betrieb und der Angular-Proxy in der Entwicklung -- ohne eine zweite Stelle,
 * an der ein Pfad weitergereicht werden muss.
 */
export function realtimeStarten(app: FastifyInstance): Server {
  io = new Server(app.server, {
    path: '/api/socket.io',
    // Gleiche Origin wie die Anwendung; das Session-Cookie muss mit.
    cors: { origin: env.APP_ORIGIN, credentials: true },
    // Eine Zeichnung als Ganzes ist groesser als die Vorgabe von 1 MB.
    maxHttpBufferSize: 4e6,
  });

  // Ab hier koennen die Spielmodule von sich aus senden -- siehe bruecke.ts.
  brueckeSetzen((code) => kontext(code));

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
        select: {
          code: true,
          game: { select: { slug: true } },
          players: { select: { userId: true, isGamemaster: true } },
        },
      });

      const eintrag = partie?.players.find((p) => p.userId === socket.data.user.id);
      if (!partie || !eintrag) {
        socket.emit('fehler', { nachricht: 'Diese Partie gibt es nicht oder du bist nicht dabei' });
        return;
      }

      socket.data.code = partie.code;
      socket.data.istLeitung = eintrag.isGamemaster;
      sockets(partie.code).add(socket);

      await liveZustandSenden(partie.code);

      // Danach darf das Spiel noch nachlegen, was zu gross fuer den Zustand
      // ist -- beim Scribble die bisherige Zeichnung.
      await spielart(partie.game.slug)?.betreten?.(kontext(partie.code, socket));
    });

    /**
     * Alles Weitere gehoert dem Spiel.
     *
     * Statt jedes Ereignis hier aufzuzaehlen, faengt ein Auffangnetz sie ein
     * und reicht sie an das Modul der Spielart durch. Eine neue Spielart
     * braucht dadurch an dieser Datei keine Zeile.
     */
    socket.onAny(async (ereignis: string, nutzlast: unknown) => {
      if (ereignis === 'partie:betreten') return;

      const code = socket.data.code;
      if (!code) return;

      const partie = await prisma.match.findUnique({
        where: { code },
        select: { game: { select: { slug: true } } },
      });

      const behandeln = partie && spielart(partie.game.slug)?.ereignisse[ereignis];
      if (!behandeln) return;

      try {
        await behandeln(kontext(code, socket), nutzlast);
      } catch (error) {
        app.log.error({ err: error, ereignis, code }, 'Spielereignis fehlgeschlagen');
      }
    });

    socket.on('disconnect', async () => {
      const code = socket.data.code;
      if (!code) return;

      const offen = verbindungen.get(code);
      offen?.delete(socket);
      if (offen && offen.size === 0) verbindungen.delete(code);

      // Mehrere offene Tabs zaehlen mit: Wer einen schliesst, ist nicht weg.
      await liveZustandSenden(code);
    });
  });

  return io;
}
