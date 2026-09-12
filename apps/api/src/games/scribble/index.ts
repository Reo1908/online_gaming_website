import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PartieInfo, SpielKontext, SpielModul, Zuschauer } from '../typen.js';
import { kontextFuer } from '../bruecke.js';
import { ratePunkte, zeichnerPunkte } from './punkte.js';
import { hinweisStellen, istRichtig, maske } from './wort.js';
import { NOTVORRAT } from './notvorrat.js';

/**
 * Einstellungen von Scribble.
 *
 * Wie beim Buzzer hat jedes Feld einen Standardwert -- das Formular im
 * Browser liest seine Vorgaben aus genau diesem Schema.
 */
const einstellungen = z.object({
  /// Eine Runde ist durch, wenn jeder einmal gezeichnet hat.
  runden: z.coerce.number().int().min(1).max(6).default(2),
  /// Sekunden je Zeichenzug.
  zeitProZug: z.coerce.number().int().min(30).max(180).default(80),
  /// Was der Erste bekommt, der das Wort erraet. Alle weiteren gestaffelt
  /// darunter, der Zeichner anteilig je Treffer -- siehe punkte.ts.
  punkteBasis: z.coerce.number().int().min(10).max(200).default(100),
  /// Deckt mit der Zeit einzelne Buchstaben auf. Ohne diese Hilfe laeuft die
  /// zweite Haelfte eines Zuges oft ins Leere.
  hinweise: z.boolean().default(true),
});

export type ScribbleEinstellungen = z.infer<typeof einstellungen>;

// ---------- Zustand ---------------------------------------------------------

export type Phase = 'WORTWAHL' | 'ZEICHNEN' | 'ZUGENDE' | 'ENDE';

/**
 * Ein Malzug in normierten Koordinaten (0..1), abwechselnd x und y.
 *
 * Zwei Arten teilen sich die Form: Ein `strich` sammelt seine Punkte ueber die
 * Zeit, eine `fuellung` hat genau einen -- die Stelle, an der der Farbeimer
 * ausgekippt wurde. Beide stehen in derselben Liste, weil ihre Reihenfolge
 * zaehlt: Wer zuerst fuellt und dann zeichnet, bekommt ein anderes Bild als
 * umgekehrt.
 */
type Malart = 'strich' | 'fuellung';

interface Malzug {
  id: string;
  art: Malart;
  farbe: string;
  breite: number;
  punkte: number[];
}

interface Nachricht {
  id: string;
  userId: string | null;
  name: string;
  text: string;
  /** Systemmeldungen stehen anders da als Rateversuche. */
  art: 'rateversuch' | 'treffer' | 'system';
  /**
   * Nur fuer die, die das Wort schon kennen. Wer richtig geraten hat, darf
   * weiterreden, ohne den anderen die Loesung zu verraten.
   */
  nurWissende: boolean;
}

interface Zug {
  zeichnerId: string;
  /** Die drei zur Wahl gestellten Woerter. */
  wahl: string[];
  wort: string | null;
  /** Zeitpunkt, an dem die laufende Phase endet. */
  endetUm: number;
  /** Wie lange die laufende Phase insgesamt dauert -- fuer den Balken. */
  dauerMs: number;
  striche: Malzug[];
  /** Wie viele ueberhaupt raten koennen -- der Zeichner zaehlt nicht mit. */
  ratende: number;
  /** userId -> Platz beim Raten, nullbasiert. */
  richtig: Map<string, number>;
  /** Aufgedeckte Buchstabenstellen. */
  aufgedeckt: number[];
  /** Was es am Zugende gab; steht erst dann. */
  ergebnis: Record<string, number> | null;
}

interface LivePartie {
  phase: Phase;
  runde: number;
  runden: number;
  /** Wer in welcher Reihenfolge zeichnet. Steht beim Start fest. */
  reihenfolge: string[];
  amZug: number;
  zug: Zug | null;
  chat: Nachricht[];
  vorrat: string[];
  /** Was schon dran war -- damit ein Wort nicht zweimal kommt. */
  benutzt: Set<string>;
  uhr: NodeJS.Timeout | null;
}

const partien = new Map<string, LivePartie>();

/** Wie lange der Zeichner zum Aussuchen hat. */
const WAHLZEIT_MS = 15_000;
/** Wie lange das aufgeloeste Wort samt Punkten stehen bleibt. */
const ZUGENDE_MS = 6_000;
/** Takt der Uhr. Grob genug, um billig zu sein, fein genug fuer die Hinweise. */
const TAKT_MS = 1_000;

/** Obergrenzen, damit eine lange Partie den Arbeitsspeicher nicht auffrisst. */
const MAX_STRICHE = 800;
const MAX_PUNKTE = 60_000;
const MAX_CHAT = 60;
const WORTWAHL_ANZAHL = 3;

function live(code: string): LivePartie | undefined {
  return partien.get(code);
}

function mischen<T>(liste: T[]): T[] {
  const kopie = [...liste];
  for (let i = kopie.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [kopie[i], kopie[j]] = [kopie[j], kopie[i]];
  }
  return kopie;
}

function zahl(partie: PartieInfo, feld: keyof ScribbleEinstellungen, ersatz: number): number {
  const wert = Number(partie.einstellungen[feld]);
  return Number.isFinite(wert) ? wert : ersatz;
}

function punkteAnzahl(striche: Malzug[]): number {
  return striche.reduce((summe, s) => summe + s.punkte.length, 0);
}

/** Wer das gesuchte Wort kennen darf: der Zeichner, wer es hat, und am Zugende alle. */
function kenntWort(l: LivePartie, userId: string): boolean {
  if (!l.zug) return false;
  if (l.phase === 'ZUGENDE' || l.phase === 'ENDE') return true;
  return l.zug.zeichnerId === userId || l.zug.richtig.has(userId);
}

function melden(l: LivePartie, nachricht: Omit<Nachricht, 'id'>): Nachricht {
  const voll: Nachricht = { id: randomUUID(), ...nachricht };
  l.chat.push(voll);
  if (l.chat.length > MAX_CHAT) l.chat.splice(0, l.chat.length - MAX_CHAT);
  return voll;
}

// ---------- Ablauf ----------------------------------------------------------

/**
 * Die Uhr der Partie.
 *
 * Ein Zeitgeber statt mehrerer: Er treibt den Wechsel der Phasen und deckt
 * nebenbei die Hinweisbuchstaben auf. Zwei getrennte Zeitgeber muessten beim
 * Abbruch beide gefunden werden -- einer kann nicht vergessen werden.
 */
function uhrStarten(code: string): void {
  const l = live(code);
  if (!l || l.uhr) return;

  l.uhr = setInterval(() => void takt(code), TAKT_MS);
  // Eine laufende Partie darf das Herunterfahren nicht aufhalten.
  l.uhr.unref?.();
}

function uhrStoppen(l: LivePartie): void {
  if (l.uhr) clearInterval(l.uhr);
  l.uhr = null;
}

async function takt(code: string): Promise<void> {
  const l = live(code);
  const ctx = kontextFuer(code);
  if (!l || !ctx) return;

  const partie = await ctx.partie();
  // Die Partie ist weg oder wurde von Hand abgebrochen -- dann schweigt die Uhr.
  if (!partie || partie.status !== 'RUNNING') {
    uhrStoppen(l);
    return;
  }

  const zug = l.zug;
  if (!zug) return;

  if (Date.now() >= zug.endetUm) {
    if (l.phase === 'WORTWAHL') {
      // Niemand hat gewaehlt: das erste Wort gilt. Besser als ein Zug, der
      // nie beginnt, weil der Zeichner gerade nicht am Platz ist.
      await wortFestlegen(code, partie, zug.wahl[0]);
    } else if (l.phase === 'ZEICHNEN') {
      await zugBeenden(code, partie);
    } else if (l.phase === 'ZUGENDE') {
      await naechsterZug(code, partie);
    }
    return;
  }

  if (l.phase === 'ZEICHNEN' && partie.einstellungen['hinweise'] !== false && zug.wort) {
    const verstrichen = 1 - (zug.endetUm - Date.now()) / zug.dauerMs;
    // Erst nach der Haelfte faellt der erste Buchstabe -- vorher ist es Raten,
    // und genau das ist das Spiel.
    const anteil = Math.max(0, (verstrichen - 0.5) * 2) * 0.5;
    const neu = hinweisStellen(zug.wort, anteil);

    if (neu.length !== zug.aufgedeckt.length) {
      zug.aufgedeckt = neu;
      const offen = maske(zug.wort, neu);

      // Nur die kleine Maske geht raus, nicht der ganze Zustand: in ihm
      // haengen die Striche, und die koennen ein paar hundert Kilobyte sein.
      for (const t of partie.teilnehmer) {
        if (!kenntWort(l, t.userId)) ctx.an(t.userId, 'scribble:maske', { maske: offen });
      }
    }
  }
}

async function zugStarten(code: string, partie: PartieInfo): Promise<void> {
  const l = live(code);
  const ctx = kontextFuer(code);
  if (!l || !ctx) return;

  const zeichnerId = l.reihenfolge[l.amZug];

  // Ist der Vorrat aufgebraucht, faengt er von vorn an. Die Alternative waere,
  // die Partie mitten im Lauf abzubrechen -- das waere schlechter.
  if (l.vorrat.every((w) => l.benutzt.has(w))) l.benutzt.clear();

  const offen = mischen(l.vorrat.filter((w) => !l.benutzt.has(w)));

  l.phase = 'WORTWAHL';
  l.zug = {
    zeichnerId,
    wahl: offen.slice(0, WORTWAHL_ANZAHL),
    wort: null,
    endetUm: Date.now() + WAHLZEIT_MS,
    dauerMs: WAHLZEIT_MS,
    striche: [],
    // Steht fuer den ganzen Zug fest: Waehrend eine Partie laeuft, kommt
    // niemand dazu und niemand geht -- die Staffelung bleibt damit stabil.
    ratende: partie.spieler.filter((s) => s.userId !== zeichnerId).length,
    richtig: new Map(),
    aufgedeckt: [],
    ergebnis: null,
  };

  const zeichner = partie.teilnehmer.find((t) => t.userId === zeichnerId);
  melden(l, {
    userId: null,
    name: '',
    text: `${zeichner?.displayName ?? 'Jemand'} sucht sich ein Wort aus.`,
    art: 'system',
    nurWissende: false,
  });

  ctx.anAlle('scribble:striche', { striche: [] });
  await ctx.senden();
  uhrStarten(code);
}

async function wortFestlegen(code: string, partie: PartieInfo, wort: string): Promise<void> {
  const l = live(code);
  const ctx = kontextFuer(code);
  if (!l?.zug || !ctx || !wort) return;

  l.zug.wort = wort;
  l.benutzt.add(wort);
  l.phase = 'ZEICHNEN';
  l.zug.dauerMs = zahl(partie, 'zeitProZug', 80) * 1000;
  l.zug.endetUm = Date.now() + l.zug.dauerMs;
  l.zug.aufgedeckt = [];

  await ctx.senden();
}

async function zugBeenden(code: string, partie: PartieInfo): Promise<void> {
  const l = live(code);
  const ctx = kontextFuer(code);
  if (!l?.zug || !ctx) return;

  const zug = l.zug;
  const basis = zahl(partie, 'punkteBasis', 100);
  const fuerZeichner = zeichnerPunkte(basis, zug.richtig.size);

  const ergebnis: Record<string, number> = {};
  for (const [userId, platz] of zug.richtig) {
    ergebnis[userId] = ratePunkte(basis, platz, zug.ratende);
  }

  if (fuerZeichner > 0) {
    ergebnis[zug.zeichnerId] = fuerZeichner;
    await ctx.punkteGeben(zug.zeichnerId, fuerZeichner);
  }

  zug.ergebnis = ergebnis;
  l.phase = 'ZUGENDE';
  zug.dauerMs = ZUGENDE_MS;
  zug.endetUm = Date.now() + ZUGENDE_MS;

  melden(l, {
    userId: null,
    name: '',
    text: `Das Wort war: ${zug.wort}`,
    art: 'system',
    nurWissende: false,
  });

  await ctx.senden();
}

async function naechsterZug(code: string, partie: PartieInfo): Promise<void> {
  const l = live(code);
  const ctx = kontextFuer(code);
  if (!l || !ctx) return;

  l.amZug += 1;

  if (l.amZug >= l.reihenfolge.length) {
    l.amZug = 0;
    l.runde += 1;
  }

  if (l.runde > l.runden) {
    l.phase = 'ENDE';
    l.zug = null;
    uhrStoppen(l);

    // Scribble kommt von selbst ans Ende -- anders als der Buzzer, den die
    // Leitung von Hand abpfeift. Die Wertung schreibt dieselbe Stelle fest.
    await ctx.beenden();
    return;
  }

  await zugStarten(code, partie);
}

// ---------- Ereignisse ------------------------------------------------------

const malzugSchema = z
  .object({
    id: z.string().min(1).max(64),
    // Aeltere Fassungen der Oberflaeche schicken keine Art mit; die meinten
    // immer einen Strich.
    art: z.enum(['strich', 'fuellung']).default('strich'),
    farbe: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Farbe muss ein Hex-Wert sein'),
    breite: z.coerce.number().min(1).max(64),
    punkte: z.array(z.number().min(-0.1).max(1.1)).min(2).max(512),
  })
  // Eine Fuellung hat genau eine Stelle -- die, auf die geklickt wurde.
  .refine((z) => z.art !== 'fuellung' || z.punkte.length === 2, {
    message: 'Eine Füllung braucht genau einen Punkt',
  });

const wortWahlSchema = z.object({ wort: z.string().min(1).max(64) });
const rateSchema = z.object({ text: z.string().trim().min(1).max(80) });

export const scribble: SpielModul = {
  slug: 'scribble',
  name: 'Scribble',
  description:
    'Einer zeichnet ein Wort, alle anderen raten mit. Wer schneller erkennt, bekommt mehr ' +
    'Punkte — und der Zeichner bekommt etwas für jeden, der es sieht.',
  minPlayers: 2,
  maxPlayers: 12,
  // Zu zweit geht es gerade eben: einer zeichnet, einer raet. Allein nicht.
  minZumStart: 2,
  leitungSpieltMit: true,
  brauchtWoerter: true,
  einstellungen,

  sicht(partie: PartieInfo, fuer: Zuschauer) {
    const l = live(partie.code);

    // Vor dem Start und nach einem Neustart der API gibt es keinen Live-Teil.
    // Ein leeres Bild ist dann richtiger als gar keins: die Lobby zeigt sonst
    // eine halb gefuellte Karte.
    if (!l) {
      return {
        phase: 'WORTWAHL' as Phase,
        serverZeit: Date.now(),
        runde: 0,
        runden: zahl(partie, 'runden', 2),
        zeichnerId: null,
        endetUm: null,
        dauerMs: 0,
        wort: null,
        maske: '',
        wahl: null,
        richtig: [] as string[],
        chat: [],
        ergebnis: null,
      };
    }

    const zug = l.zug;
    const weiss = zug ? kenntWort(l, fuer.userId) : false;
    const istZeichner = zug?.zeichnerId === fuer.userId;

    return {
      phase: l.phase,
      // Die Uhr des Browsers kann Minuten danebenliegen. Mit der Serverzeit
      // im selben Paket rechnet die Oberflaeche den Versatz heraus -- sonst
      // laeuft der Balken bei manchen sofort ab und bei anderen nie.
      serverZeit: Date.now(),
      runde: l.runde,
      runden: l.runden,
      zeichnerId: zug?.zeichnerId ?? null,
      endetUm: zug?.endetUm ?? null,
      dauerMs: zug?.dauerMs ?? 0,
      // Das Wort steht nur bei dem auf dem Draht, der es kennen darf.
      wort: weiss ? (zug?.wort ?? null) : null,
      maske: zug?.wort ? maske(zug.wort, weiss ? undefined : zug.aufgedeckt) : '',
      // Die Auswahl sieht nur der Zeichner -- sonst waere das Raten vorbei,
      // bevor der erste Strich steht.
      wahl: istZeichner && l.phase === 'WORTWAHL' ? (zug?.wahl ?? null) : null,
      richtig: zug ? [...zug.richtig.keys()] : [],
      chat: l.chat.filter((n) => !n.nurWissende || weiss),
      ergebnis: zug?.ergebnis ?? null,
    };
  },

  spielerSicht(partie, teilnehmerId) {
    const zug = live(partie.code)?.zug;

    return {
      zeichnet: zug?.zeichnerId === teilnehmerId,
      hatGeraten: zug?.richtig.has(teilnehmerId) ?? false,
      zugPunkte: zug?.ergebnis?.[teilnehmerId] ?? null,
    };
  },

  async gestartet(ctx: SpielKontext) {
    const partie = await ctx.partie();
    if (!partie) return;

    const vorrat = await ctx.woerter();

    partien.set(ctx.code, {
      phase: 'WORTWAHL',
      runde: 1,
      runden: zahl(partie, 'runden', 2),
      // Gemischt statt in Beitrittsreihenfolge: sonst zeichnete immer dieselbe
      // Person zuerst, und die hat den unaufgewaermten Raum vor sich.
      reihenfolge: mischen(partie.spieler.map((s) => s.userId)),
      amZug: 0,
      zug: null,
      chat: [],
      // Der Notvorrat greift nur, wenn kein einziges Themengebiet Woerter
      // hergibt -- sonst stuende die Partie beim ersten Zug still.
      vorrat: vorrat.length > 0 ? vorrat : [...NOTVORRAT],
      benutzt: new Set(),
      uhr: null,
    });

    await zugStarten(ctx.code, partie);
  },

  /** Wer dazukommt oder neu laedt, bekommt die Zeichnung als Ganzes. */
  betreten(ctx: SpielKontext) {
    const l = live(ctx.code);
    if (!l?.zug) return;
    ctx.an(ctx.userId, 'scribble:striche', { striche: l.zug.striche });
  },

  ereignisse: {
    async 'wort:waehlen'(ctx: SpielKontext, nutzlast: unknown) {
      const l = live(ctx.code);
      if (!l?.zug || l.phase !== 'WORTWAHL') return;
      if (l.zug.zeichnerId !== ctx.userId) return;

      const geprueft = wortWahlSchema.safeParse(nutzlast);
      if (!geprueft.success) return;
      // Nur aus der angebotenen Auswahl: sonst koennte sich der Zeichner ein
      // eigenes Wort ausdenken, das niemand erraten kann.
      if (!l.zug.wahl.includes(geprueft.data.wort)) return;

      const partie = await ctx.partie();
      if (!partie) return;

      await wortFestlegen(ctx.code, partie, geprueft.data.wort);
    },

    'zeichnen:strich'(ctx: SpielKontext, nutzlast: unknown) {
      const l = live(ctx.code);
      if (!l?.zug || l.phase !== 'ZEICHNEN' || l.zug.zeichnerId !== ctx.userId) return;

      const geprueft = malzugSchema.safeParse(nutzlast);
      if (!geprueft.success) return;

      const { id, art, farbe, breite, punkte } = geprueft.data;
      // Eine Fuellung wird nie ergaenzt; nur ein Strich waechst ueber die Zeit.
      const vorhanden = art === 'strich' ? l.zug.striche.find((s) => s.id === id) : undefined;

      if (vorhanden) {
        if (punkteAnzahl(l.zug.striche) > MAX_PUNKTE) return;
        vorhanden.punkte.push(...punkte);
      } else {
        if (l.zug.striche.length >= MAX_STRICHE) return;
        l.zug.striche.push({ id, art, farbe, breite, punkte: [...punkte] });
      }

      // Geht als kleines Stueck weiter statt als ganzer Zustand: waehrend des
      // Zeichnens laeuft das dutzendfach je Sekunde.
      ctx.anAndere('scribble:strich', geprueft.data);
    },

    'zeichnen:zurueck'(ctx: SpielKontext) {
      const l = live(ctx.code);
      if (!l?.zug || l.phase !== 'ZEICHNEN' || l.zug.zeichnerId !== ctx.userId) return;

      l.zug.striche.pop();
      ctx.anAlle('scribble:striche', { striche: l.zug.striche });
    },

    'zeichnen:leeren'(ctx: SpielKontext) {
      const l = live(ctx.code);
      if (!l?.zug || l.phase !== 'ZEICHNEN' || l.zug.zeichnerId !== ctx.userId) return;

      l.zug.striche = [];
      ctx.anAlle('scribble:striche', { striche: [] });
    },

    async raten(ctx: SpielKontext, nutzlast: unknown) {
      const l = live(ctx.code);
      if (!l?.zug) return;

      const geprueft = rateSchema.safeParse(nutzlast);
      if (!geprueft.success) return;

      const partie = await ctx.partie();
      if (!partie || partie.status !== 'RUNNING') return;

      const ich = partie.teilnehmer.find((t) => t.userId === ctx.userId);
      if (!ich) return;

      const zug = l.zug;
      const schonRichtig = zug.richtig.has(ctx.userId);
      const istZeichner = zug.zeichnerId === ctx.userId;

      // Wer das Wort kennt, redet nur noch mit denen, die es auch kennen --
      // sonst tippt der Zeichner aus Versehen die Loesung in den Raum.
      if (istZeichner || schonRichtig || l.phase !== 'ZEICHNEN') {
        const nachricht = melden(l, {
          userId: ctx.userId,
          name: ich.displayName,
          text: geprueft.data.text,
          art: 'rateversuch',
          nurWissende: istZeichner || schonRichtig,
        });

        for (const t of partie.teilnehmer) {
          if (!nachricht.nurWissende || kenntWort(l, t.userId)) {
            ctx.an(t.userId, 'scribble:chat', nachricht);
          }
        }
        return;
      }

      if (zug.wort && istRichtig(geprueft.data.text, zug.wort)) {
        const platz = zug.richtig.size;
        zug.richtig.set(ctx.userId, platz);

        // Punkte sofort in die Datenbank: sie sind das Einzige aus der
        // laufenden Partie, das einen Neustart der API ueberleben muss.
        await ctx.punkteGeben(
          ctx.userId,
          ratePunkte(zahl(partie, 'punkteBasis', 100), platz, zug.ratende),
        );

        melden(l, {
          userId: ctx.userId,
          name: ich.displayName,
          text: `${ich.displayName} hat das Wort!`,
          art: 'treffer',
          nurWissende: false,
        });

        // Haben es alle ausser dem Zeichner, braucht niemand mehr zu zeichnen.
        if (zug.richtig.size >= zug.ratende) {
          await zugBeenden(ctx.code, partie);
          return;
        }

        await ctx.senden();
        return;
      }

      const nachricht = melden(l, {
        userId: ctx.userId,
        name: ich.displayName,
        text: geprueft.data.text,
        art: 'rateversuch',
        nurWissende: false,
      });
      ctx.anAlle('scribble:chat', nachricht);
    },
  },

  verwerfen(code) {
    const l = live(code);
    if (l) uhrStoppen(l);
    partien.delete(code);
  },
};
