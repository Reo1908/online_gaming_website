import { z } from 'zod';
import type { PartieInfo, SpielKontext, SpielModul } from '../typen.js';

/**
 * Einstellungen des Buzzer-Spiels.
 *
 * Jedes Feld hat einen Standardwert: aus dem Schema kommen zugleich die
 * Vorgaben des Formulars, damit sie nicht an zwei Stellen stehen.
 */
const einstellungen = z.object({
  /// Was die Spielleitung mit einem Klick vergibt.
  punkteProTreffer: z.coerce.number().int().min(1).max(100).default(10),
  /// Wer einmal gebuzzert hat, ist in dieser Runde raus. Ohne Sperre
  /// koennen mehrere nacheinander drankommen.
  nurEinmalBuzzern: z.boolean().default(true),
  /// Sonst sieht nur die Spielleitung, was getippt wird. Oeffentlich ist es
  /// fuer gemeinsames Raten gedacht, nicht fuer ein Quiz.
  antwortenOeffentlich: z.boolean().default(false),
});

export type BuzzerEinstellungen = z.infer<typeof einstellungen>;

const TEXT_MAX = 200;

/**
 * Der Live-Teil einer Buzzer-Partie: was gerade getippt wurde, wer gebuzzert
 * hat und welche Runde laeuft.
 *
 * Bewusst nur im Arbeitsspeicher. Diese Werte gelten je Frage fuer ein paar
 * Sekunden -- sie in die Datenbank zu schreiben hiesse, bei jedem Tastendruck
 * zu schreiben. Was bleiben muss, steht dort: Punkte, Teilnehmer, Status.
 */
interface LiveSpieler {
  text: string;
  /** Millisekunden seit Rundenstart, null solange nicht gebuzzert. */
  gebuzzertUm: number | null;
}

interface LivePartie {
  runde: number;
  rundeLaeuft: boolean;
  rundeGestartetUm: number | null;
  spieler: Map<string, LiveSpieler>;
}

const partien = new Map<string, LivePartie>();

function live(code: string): LivePartie {
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
    spieler = { text: '', gebuzzertUm: null };
    partie.spieler.set(userId, spieler);
  }
  return spieler;
}

/** Reihenfolge am Buzzer: wer zuerst gedrueckt hat, steht auf 1. */
function reihenfolge(partie: LivePartie): string[] {
  return [...partie.spieler.entries()]
    .filter(([, s]) => s.gebuzzertUm !== null)
    .sort((a, b) => (a[1].gebuzzertUm ?? 0) - (b[1].gebuzzertUm ?? 0))
    .map(([userId]) => userId);
}

function oeffentlich(partie: PartieInfo): boolean {
  return partie.einstellungen['antwortenOeffentlich'] === true;
}

const textSchema = z.object({ text: z.string().max(TEXT_MAX) });
const punkteSchema = z.object({
  userId: z.string().uuid(),
  punkte: z.number().int().min(-1000).max(1000),
});

export const buzzer: SpielModul = {
  slug: 'buzzer',
  name: 'Buzzer',
  description:
    'Die Spielleitung stellt Fragen, alle anderen tippen ihre Antwort und buzzern. ' +
    'Punkte vergibt die Spielleitung.',
  minPlayers: 2,
  maxPlayers: 12,
  // Zum Ausprobieren reicht eine Person; gewertet wird trotzdem erst ab zwei.
  minZumStart: 1,
  leitungSpieltMit: false,
  brauchtWoerter: false,
  einstellungen,

  sicht(partie) {
    const l = live(partie.code);
    return {
      runde: { nummer: l.runde, laeuft: l.rundeLaeuft, gestartetUm: l.rundeGestartetUm },
    };
  },

  spielerSicht(partie, teilnehmerId, fuer) {
    const l = live(partie.code);
    const s = l.spieler.get(teilnehmerId);
    const platz = reihenfolge(l).indexOf(teilnehmerId);

    // Die Antworten sieht standardmaessig nur die Spielleitung. Sie werden
    // gar nicht erst geschickt statt nur ausgeblendet -- was nicht auf dem
    // Draht liegt, kann auch die Konsole des Browsers nicht verraten.
    const darfTexteSehen = fuer.istLeitung || oeffentlich(partie);

    return {
      gebuzzertUm: s?.gebuzzertUm ?? null,
      buzzerPlatz: platz === -1 ? null : platz + 1,
      ...(darfTexteSehen ? { text: s?.text ?? '' } : {}),
    };
  },

  ereignisse: {
    async 'text:setzen'(ctx: SpielKontext, nutzlast: unknown) {
      if (ctx.istLeitung) return;

      const geprueft = textSchema.safeParse(nutzlast);
      if (!geprueft.success) return;

      liveSpieler(live(ctx.code), ctx.userId).text = geprueft.data.text;

      const meldung = { userId: ctx.userId, text: geprueft.data.text };

      // Der Text geht einzeln raus statt als ganzer Zustand: er aendert sich
      // bei jedem Tastendruck, alles andere nicht.
      const partie = await ctx.partie();
      if (partie && oeffentlich(partie)) ctx.anAndere('spieler:text', meldung);
      else ctx.anLeitung('spieler:text', meldung);
    },

    async buzzern(ctx: SpielKontext) {
      if (ctx.istLeitung) return;

      const l = live(ctx.code);
      if (!l.rundeLaeuft || l.rundeGestartetUm === null) return;

      const partie = await ctx.partie();
      if (!partie || partie.status !== 'RUNNING') return;

      const spieler = liveSpieler(l, ctx.userId);
      const nurEinmal = partie.einstellungen['nurEinmalBuzzern'] !== false;
      if (spieler.gebuzzertUm !== null && nurEinmal) return;

      spieler.gebuzzertUm = Date.now() - l.rundeGestartetUm;
      await ctx.senden();
    },

    async 'runde:starten'(ctx: SpielKontext) {
      if (!ctx.istLeitung) return;

      const l = live(ctx.code);
      l.runde += 1;
      l.rundeLaeuft = true;
      l.rundeGestartetUm = Date.now();

      // Neue Frage, leeres Blatt: alte Antworten und Buzzer wegraeumen.
      for (const spieler of l.spieler.values()) {
        spieler.text = '';
        spieler.gebuzzertUm = null;
      }

      await ctx.senden();
    },

    async 'runde:stoppen'(ctx: SpielKontext) {
      if (!ctx.istLeitung) return;

      live(ctx.code).rundeLaeuft = false;
      await ctx.senden();
    },

    async 'punkte:geben'(ctx: SpielKontext, nutzlast: unknown) {
      if (!ctx.istLeitung) return;

      const geprueft = punkteSchema.safeParse(nutzlast);
      if (!geprueft.success) return;

      const partie = await ctx.partie();
      if (!partie || partie.status !== 'RUNNING') return;

      if (await ctx.punkteGeben(geprueft.data.userId, geprueft.data.punkte)) {
        await ctx.senden();
      }
    },
  },

  verwerfen(code) {
    partien.delete(code);
  },
};
