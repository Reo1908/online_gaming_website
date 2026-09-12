import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PartieInfo, SpielKontext, SpielModul, Zuschauer } from '../typen.js';
import { kontextFuer } from '../bruecke.js';
import { mischen } from './zufall.js';
import {
  erzeugen as raetselErzeugen,
  eingabe as raetselEingabe,
  folge as raetselFolge,
  kopf as raetselKopf,
  pult as raetselPult,
  unterlagen as raetselUnterlagen,
  type Raetsel,
  type RaetselArt,
} from './raetsel.js';

/**
 * Ausbruch -- ein Fluchtspiel, das nur zusammen ausgeht.
 *
 * Der Sektor ist verriegelt, davor liegt eine Reihe von Schleusen. An jeder
 * steht **einer** am Pult und sieht die Anlage; alle anderen haben die
 * Unterlagen dazu und sehen das Pult nicht. Keine der beiden Haelften reicht
 * allein -- geredet werden muss so oder so.
 *
 * Drei Entscheidungen, die das Spiel ausmachen:
 *
 * - **Ein Zeitkonto statt einer Uhr je Schleuse.** Wer schnell ist, spart die
 *   Zeit fuer die naechste. Damit ist auch ein Fehlalarm nicht das Ende,
 *   sondern eine Hypothek -- und die Runde bleibt bis zuletzt spannend.
 * - **Die Bedienung wandert.** Jeder ist einmal der, der beschreiben muss, und
 *   mehrfach der, der vorliest. Bliebe einer dauerhaft am Pult, waere er der
 *   Spieler und der Rest sein Handbuch.
 * - **Gewonnen wird gemeinsam.** Es gibt keine Einzelwertung: Entweder sind
 *   alle draussen oder keiner. Deshalb bekommt jeder dieselben Punkte, und
 *   die Partie wird ueber `ctx.beenden({ erfolg })` abgeschlossen.
 */

const einstellungen = z.object({
  /**
   * Normal oder schwer.
   *
   * Kein Regler an denselben Raetseln, sondern andere: Im schweren Modus
   * kommt eine Modulnummer an den Sicherungskasten, das Symbolschloss zieht
   * alle Zeichen aus einer Familie, im Schacht liegen Sensoren und die Luke
   * fehlt am Pult, und im Zahlenschloss verweisen Stellen aufeinander.
   */
  schwierigkeit: z.enum(['normal', 'schwer']).default('normal'),
  /// Wie viele Schleusen zwischen dem Sektor und der Freiheit liegen.
  schleusen: z.coerce.number().int().min(3).max(8).default(5),
  /// Zeit je Schleuse -- alle zusammen ergeben **ein** Konto, aus dem der
  /// ganze Ausbruch bezahlt wird.
  zeitJeSchleuse: z.coerce.number().int().min(45).max(240).default(90),
  /// Was ein Fehlalarm vom Konto abzieht.
  strafe: z.coerce.number().int().min(0).max(60).default(20),
  /// Ob die Bedienung nach jeder Schleuse weitergereicht wird.
  rollentausch: z.boolean().default(true),
  /// Pause zwischen zwei Funkspruechen, in Sekunden. Der Funk ist absichtlich
  /// schmalbandig: Ohne Sperre tippt jemand einfach seine Unterlagen ab, und
  /// aus dem gemeinsamen Raetsel wird eine Einzelarbeit mit Publikum.
  funkSperre: z.coerce.number().int().min(0).max(10).default(3),
});

export type AusbruchEinstellungen = z.infer<typeof einstellungen>;

// ---------- Zustand ---------------------------------------------------------

type Phase = 'EINWEISUNG' | 'SCHLEUSE' | 'GESCHAFFT' | 'ENDE';

interface Funkspruch {
  id: string;
  userId: string | null;
  name: string;
  text: string;
  art: 'funk' | 'system' | 'alarm';
}

interface Schleuse {
  /** Einsbasiert. */
  nr: number;
  art: RaetselArt;
  titel: string;
  auftrag: string;
  raetsel: Raetsel;
  bedienerId: string;
  /** Die Leser in fester Reihenfolge -- daran haengt, wer welches Paket hat. */
  leser: string[];
  fehlalarme: number;
}

interface LivePartie {
  phase: Phase;
  schleusen: number;
  geloest: number;
  /** Steht erst am Ende: ob sie draussen sind. */
  erfolg: boolean | null;

  /** Wer in welcher Reihenfolge ans Pult kommt. Steht beim Start fest. */
  reihenfolge: string[];
  folge: RaetselArt[];
  schwer: boolean;
  rollentausch: boolean;
  strafeMs: number;
  funkSperreMs: number;

  /** Das Zeitkonto. Es laeuft nur, solange eine Schleuse offen ist. */
  ablaufUm: number;
  restMs: number;
  uhrLaeuft: boolean;
  /** Was zu Beginn auf dem Konto lag -- der Massstab fuer den Balken. */
  kontoMs: number;

  /** Wann die laufende Zwischenphase endet -- Einweisung, Pause, Abspann. */
  phaseEndetUm: number;
  phaseDauerMs: number;

  aktuell: Schleuse | null;
  fehlalarmeGesamt: number;

  funk: Funkspruch[];
  letzterFunk: Map<string, number>;
  letzteEingabe: Map<string, number>;

  uhr: NodeJS.Timeout | null;
}

const partien = new Map<string, LivePartie>();

/** Zeit zum Ankommen, bevor die Uhr zu laufen beginnt. */
const EINWEISUNG_MS = 12_000;
/** Wie lange „Schleuse offen" stehen bleibt. Die Uhr steht dabei still. */
const GESCHAFFT_MS = 6_000;
/** Der Abspann, bevor die Partie in den Endstand wechselt. */
const ENDE_MS = 9_000;
const TAKT_MS = 1_000;

/** Was eine gemeisterte Schleuse jedem einbringt. */
const PUNKTE_JE_SCHLEUSE = 100;

const MAX_FUNK = 60;
/**
 * Kleinster Abstand zwischen zwei Eingaben am Pult.
 *
 * Im Schacht ist jeder Schritt eine Eingabe, und eine gehaltene Pfeiltaste
 * schickt dutzende je Sekunde. Nicht gegen Betrug -- gegen die Last. Deshalb
 * so kurz, dass kein geklickter Schritt darunter faellt: Eine Wiederholrate
 * wird halbiert, zwei schnelle Klicks kommen beide an.
 */
const EINGABE_SPERRE_MS = 60;

function live(code: string): LivePartie | undefined {
  return partien.get(code);
}

function zahl(partie: PartieInfo, feld: keyof AusbruchEinstellungen, ersatz: number): number {
  const wert = Number(partie.einstellungen[feld]);
  return Number.isFinite(wert) ? wert : ersatz;
}

function melden(l: LivePartie, spruch: Omit<Funkspruch, 'id'>): Funkspruch {
  const voll: Funkspruch = { id: randomUUID(), ...spruch };
  l.funk.push(voll);
  if (l.funk.length > MAX_FUNK) l.funk.splice(0, l.funk.length - MAX_FUNK);
  return voll;
}

function system(l: LivePartie, text: string, art: 'system' | 'alarm' = 'system'): Funkspruch {
  return melden(l, { userId: null, name: '', text, art });
}

function name(partie: PartieInfo, userId: string): string {
  return partie.teilnehmer.find((t) => t.userId === userId)?.displayName ?? 'Jemand';
}

/** Punkte gibt es nur fuer alle zugleich -- das Spiel kennt keine Einzelwertung. */
async function punkteFuerAlle(
  ctx: SpielKontext,
  partie: PartieInfo,
  punkte: number,
): Promise<void> {
  if (punkte <= 0) return;
  for (const spieler of partie.spieler) await ctx.punkteGeben(spieler.userId, punkte);
}

// ---------- Ablauf ----------------------------------------------------------

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

/**
 * Die Uhr des Ausbruchs.
 *
 * Ein einziger Zeitgeber fuer alles: Er laesst die Einweisung ablaufen, zieht
 * das Zeitkonto leer und schaltet nach der Pause weiter. Zwei Zeitgeber
 * muessten beim Abbruch beide gefunden werden -- einer kann nicht vergessen
 * werden.
 */
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

  const jetzt = Date.now();

  if (l.phase === 'SCHLEUSE') {
    if (jetzt >= l.ablaufUm) await scheitern(code, ctx);
    return;
  }

  if (jetzt < l.phaseEndetUm) return;

  if (l.phase === 'EINWEISUNG' || l.phase === 'GESCHAFFT') await schleuseStarten(code, partie);
  else if (l.phase === 'ENDE') await abschliessen(code, ctx);
}

async function schleuseStarten(code: string, partie: PartieInfo): Promise<void> {
  const l = live(code);
  const ctx = kontextFuer(code);
  if (!l || !ctx) return;

  const nr = l.geloest + 1;
  const art = l.folge[nr - 1];

  // Reihum ans Pult, es sei denn, die Lobby hat den Wechsel abgeschaltet.
  const bedienerId = l.rollentausch
    ? l.reihenfolge[(nr - 1) % l.reihenfolge.length]
    : l.reihenfolge[0];
  const leser = l.reihenfolge.filter((id) => id !== bedienerId);

  l.aktuell = {
    nr,
    art,
    ...raetselKopf(art),
    // Die Nummer der Schleuse zaehlt mit: Innerhalb einer Partie wird es nach
    // hinten heraus mehr, der Modus entscheidet daneben ueber die Sorte.
    raetsel: raetselErzeugen(art, {
      nr: nr - 1,
      schwer: l.schwer,
      leser: Math.max(1, leser.length),
    }),
    bedienerId,
    leser,
    fehlalarme: 0,
  };

  l.phase = 'SCHLEUSE';
  l.ablaufUm = Date.now() + l.restMs;
  l.uhrLaeuft = true;

  system(
    l,
    `Schleuse ${nr} von ${l.schleusen} — ${l.aktuell.titel}. ${name(partie, bedienerId)} steht am Pult.`,
  );

  await ctx.senden();
}

/** Eine Schleuse ist offen: Punkte gutschreiben, Uhr anhalten, weiterzaehlen. */
async function geschafft(code: string, partie: PartieInfo): Promise<void> {
  const l = live(code);
  const ctx = kontextFuer(code);
  if (!l?.aktuell || !ctx) return;

  const nr = l.aktuell.nr;
  l.geloest = nr;

  // Die Uhr steht waehrend der Pause. Sonst zahlte man Zeit fuer einen
  // Bildschirm, auf dem nichts zu tun ist.
  l.restMs = Math.max(0, l.ablaufUm - Date.now());
  l.uhrLaeuft = false;

  await punkteFuerAlle(ctx, partie, PUNKTE_JE_SCHLEUSE);
  system(l, `Schleuse ${nr} offen.`);

  if (nr >= l.schleusen) {
    const sekunden = Math.round(l.restMs / 1000);
    // Der Zeitbonus ist der eigentliche Wettbewerb: Draussen sind entweder
    // alle oder keiner -- wie schnell, steht danach in der Rangliste.
    await punkteFuerAlle(ctx, partie, sekunden);

    l.phase = 'ENDE';
    l.erfolg = true;
    l.phaseDauerMs = ENDE_MS;
    l.phaseEndetUm = Date.now() + ENDE_MS;
    system(l, `Draußen! ${sekunden} Sekunden waren noch auf dem Konto.`);
  } else {
    l.phase = 'GESCHAFFT';
    l.phaseDauerMs = GESCHAFFT_MS;
    l.phaseEndetUm = Date.now() + GESCHAFFT_MS;
  }

  await ctx.senden();
}

async function scheitern(code: string, ctx: SpielKontext): Promise<void> {
  const l = live(code);
  if (!l) return;

  l.phase = 'ENDE';
  l.erfolg = false;
  l.uhrLaeuft = false;
  l.restMs = 0;
  l.phaseDauerMs = ENDE_MS;
  l.phaseEndetUm = Date.now() + ENDE_MS;

  system(l, 'Zeit abgelaufen. Die Schleusen bleiben zu.', 'alarm');

  await ctx.senden();
}

/**
 * Schreibt die Partie fest.
 *
 * Erst nach dem Abspann: Sonst springt die Seite in derselben Sekunde, in der
 * die letzte Schleuse aufgeht, in den Endstand -- und niemand haette gesehen,
 * dass es geklappt hat.
 */
async function abschliessen(code: string, ctx: SpielKontext): Promise<void> {
  const l = live(code);
  if (!l) return;

  uhrStoppen(l);
  await ctx.beenden({ erfolg: l.erfolg === true });
}

// ---------- Ereignisse ------------------------------------------------------

const funkSchema = z.object({ text: z.string().trim().min(1).max(160) });
const uebergabeSchema = z.object({ userId: z.string().uuid() });

export const ausbruch: SpielModul = {
  slug: 'ausbruch',
  name: 'Ausbruch',
  description:
    'Kooperativer Fluchtraum: Einer steht am Pult und sieht die Anlage, die anderen haben die ' +
    'Unterlagen dazu. Nur zusammen kommt ihr durch die Schleusen — und nur gemeinsam raus.',
  minPlayers: 2,
  maxPlayers: 8,
  // Allein gibt es niemanden zum Vorlesen, und darum geht es hier.
  minZumStart: 2,
  leitungSpieltMit: true,
  brauchtWoerter: false,
  // Alle gewinnen oder alle verlieren -- siehe `beenden({ erfolg })`.
  gemeinsameWertung: true,
  einstellungen,

  sicht(partie: PartieInfo, fuer: Zuschauer) {
    const l = live(partie.code);

    // Vor dem Start und nach einem Neustart der API gibt es keinen Live-Teil.
    // Die Lobby ruft diese Sicht trotzdem -- also ein leerer Sektor statt
    // einer halb gefuellten Anzeige.
    if (!l) {
      const konto = zahl(partie, 'schleusen', 5) * zahl(partie, 'zeitJeSchleuse', 90) * 1000;

      return {
        phase: 'EINWEISUNG' as Phase,
        serverZeit: Date.now(),
        schwer: partie.einstellungen['schwierigkeit'] === 'schwer',
        schleuse: 0,
        schleusen: zahl(partie, 'schleusen', 5),
        geloest: 0,
        erfolg: null,
        titel: '',
        auftrag: '',
        raetselArt: null,
        bedienerId: null,
        fehlalarme: 0,
        fehlalarmeGesamt: 0,
        uhrLaeuft: false,
        ablaufUm: null,
        restMs: konto,
        kontoMs: konto,
        strafe: zahl(partie, 'strafe', 20),
        phaseEndetUm: null,
        phaseDauerMs: 0,
        pult: null,
        unterlage: null,
        unterlageNr: null,
        unterlagen: 0,
        funk: [] as Funkspruch[],
      };
    }

    const s = l.aktuell;
    const binBediener = s?.bedienerId === fuer.userId;
    const stelle = s ? s.leser.indexOf(fuer.userId) : -1;

    return {
      phase: l.phase,
      // Die Uhr des Browsers kann Minuten danebenliegen. Mit der Serverzeit im
      // selben Paket rechnet die Oberflaeche den Versatz heraus -- sonst laeuft
      // das Zeitkonto bei manchen sofort ab und bei anderen nie.
      serverZeit: Date.now(),
      schwer: l.schwer,
      schleuse: s?.nr ?? 0,
      schleusen: l.schleusen,
      geloest: l.geloest,
      erfolg: l.erfolg,
      titel: s?.titel ?? '',
      auftrag: s?.auftrag ?? '',
      raetselArt: s?.art ?? null,
      bedienerId: s?.bedienerId ?? null,
      fehlalarme: s?.fehlalarme ?? 0,
      fehlalarmeGesamt: l.fehlalarmeGesamt,
      uhrLaeuft: l.uhrLaeuft,
      ablaufUm: l.uhrLaeuft ? l.ablaufUm : null,
      // Waehrend die Uhr laeuft, steht der gemerkte Rest still -- er gilt erst
      // wieder, wenn sie angehalten wird. Ausgerechnet statt weitergereicht:
      // Sonst stuende neben dem Ablaufzeitpunkt eine Zahl, die ihm
      // widerspricht, und ein Fehlalarm waere daran nicht abzulesen.
      restMs: l.uhrLaeuft ? Math.max(0, l.ablaufUm - Date.now()) : l.restMs,
      kontoMs: l.kontoMs,
      strafe: Math.round(l.strafeMs / 1000),
      phaseEndetUm: l.phase === 'SCHLEUSE' ? null : l.phaseEndetUm,
      phaseDauerMs: l.phaseDauerMs,
      // Das Pult steht nur bei dem auf dem Draht, der es bedient, die
      // Unterlagen nur bei ihrem Leser. Was jemand nicht sehen darf, liegt
      // gar nicht erst in seinem Browser.
      pult: binBediener && s ? raetselPult(s.raetsel) : null,
      unterlage: s && stelle >= 0 ? raetselUnterlagen(s.raetsel, s.leser.length)[stelle] : null,
      unterlageNr: stelle >= 0 ? stelle + 1 : null,
      unterlagen: s?.leser.length ?? 0,
      funk: l.funk,
    };
  },

  spielerSicht(partie, teilnehmerId) {
    const s = live(partie.code)?.aktuell;
    const stelle = s ? s.leser.indexOf(teilnehmerId) : -1;

    return {
      bedient: s?.bedienerId === teilnehmerId,
      unterlageNr: stelle >= 0 ? stelle + 1 : null,
    };
  },

  async gestartet(ctx: SpielKontext) {
    const partie = await ctx.partie();
    if (!partie) return;

    const schleusen = zahl(partie, 'schleusen', 5);
    const konto = schleusen * zahl(partie, 'zeitJeSchleuse', 90) * 1000;
    const rollentausch = partie.einstellungen['rollentausch'] !== false;
    const schwer = partie.einstellungen['schwierigkeit'] === 'schwer';

    // Gemischt statt in Beitrittsreihenfolge: Sonst stuende immer dieselbe
    // Person an der ersten Schleuse, und die ist die ungeuebteste.
    let reihenfolge = mischen(partie.spieler.map((s) => s.userId));

    // Ohne Rollentausch bedient die Spielleitung -- sie hat die Runde
    // zusammengerufen und erklaert sie meistens auch.
    const leitung = partie.teilnehmer.find((t) => t.istLeitung && t.spieltMit)?.userId;
    if (!rollentausch && leitung) {
      reihenfolge = [leitung, ...reihenfolge.filter((id) => id !== leitung)];
    }

    partien.set(ctx.code, {
      phase: 'EINWEISUNG',
      schleusen,
      geloest: 0,
      erfolg: null,
      reihenfolge,
      folge: raetselFolge(schleusen),
      schwer,
      rollentausch,
      strafeMs: zahl(partie, 'strafe', 20) * 1000,
      funkSperreMs: zahl(partie, 'funkSperre', 3) * 1000,
      ablaufUm: 0,
      // Ein Konto fuer den ganzen Ausbruch: Die Zeit je Schleuse ist nur die
      // Rechengroesse dahinter. Wer eine Schleuse schnell aufbekommt, nimmt
      // den Rest mit in die naechste.
      restMs: konto,
      kontoMs: konto,
      uhrLaeuft: false,
      phaseEndetUm: Date.now() + EINWEISUNG_MS,
      phaseDauerMs: EINWEISUNG_MS,
      aktuell: null,
      fehlalarmeGesamt: 0,
      funk: [],
      letzterFunk: new Map(),
      letzteEingabe: new Map(),
      uhr: null,
    });

    const l = live(ctx.code)!;
    system(
      l,
      `Der Sektor ist verriegelt. ${schleusen} Schleusen liegen vor euch` +
        (schwer ? ' — auf der schweren Stufe.' : '.'),
    );

    await ctx.senden();
    uhrStarten(ctx.code);
  },

  ereignisse: {
    async 'pult:eingabe'(ctx: SpielKontext, nutzlast: unknown) {
      const l = live(ctx.code);
      if (!l?.aktuell || l.phase !== 'SCHLEUSE') return;
      if (l.aktuell.bedienerId !== ctx.userId) return;

      const jetzt = Date.now();
      if (jetzt - (l.letzteEingabe.get(ctx.userId) ?? 0) < EINGABE_SPERRE_MS) return;
      l.letzteEingabe.set(ctx.userId, jetzt);

      const partie = await ctx.partie();
      if (!partie || partie.status !== 'RUNNING') return;

      const zug = raetselEingabe(l.aktuell.raetsel, nutzlast);

      if (zug.status === 'geloest') {
        await geschafft(ctx.code, partie);
        return;
      }

      if (zug.status === 'fehlalarm') {
        l.aktuell.fehlalarme += 1;
        l.fehlalarmeGesamt += 1;
        // Der Fehler kostet Zeit, nicht einen Versuch: Ein Ausbruch endet an
        // der Uhr, und nur so bleibt Ausprobieren teurer als Nachfragen.
        l.ablaufUm -= l.strafeMs;
        system(l, zug.meldung, 'alarm');
      }

      await ctx.senden();
    },

    async funk(ctx: SpielKontext, nutzlast: unknown) {
      const l = live(ctx.code);
      if (!l) return;

      const geprueft = funkSchema.safeParse(nutzlast);
      if (!geprueft.success) return;

      const jetzt = Date.now();
      const frei = (l.letzterFunk.get(ctx.userId) ?? 0) + l.funkSperreMs;
      if (jetzt < frei) {
        // Nur an den Absender: Die anderen brauchen nicht zu wissen, dass
        // jemand zu schnell getippt hat.
        ctx.an(ctx.userId, 'ausbruch:funksperre', { bisUm: frei, serverZeit: jetzt });
        return;
      }
      l.letzterFunk.set(ctx.userId, jetzt);

      const partie = await ctx.partie();
      const ich = partie?.teilnehmer.find((t) => t.userId === ctx.userId);
      if (!ich) return;

      // Geht als einzelne Zeile raus statt als ganzer Zustand: Der Funk laeuft
      // die ganze Partie ueber, der Rest aendert sich dabei nicht.
      ctx.anAlle(
        'ausbruch:funk',
        melden(l, {
          userId: ctx.userId,
          name: ich.displayName,
          text: geprueft.data.text,
          art: 'funk',
        }),
      );
    },

    /**
     * Die Bedienung weitergeben.
     *
     * Der Notausgang des Spiels: Wenn der Bediener mitten in der Schleuse die
     * Verbindung verliert, kann die Runde sonst nur noch zusehen, wie die Uhr
     * ablaeuft. Getauscht wird auf der Stelle -- der Abgeloeste bekommt das
     * Paket dessen, der ans Pult geht, und alle anderen behalten ihres.
     */
    async 'bedienung:uebergeben'(ctx: SpielKontext, nutzlast: unknown) {
      if (!ctx.istLeitung) return;

      const l = live(ctx.code);
      if (!l?.aktuell || l.phase !== 'SCHLEUSE') return;

      const geprueft = uebergabeSchema.safeParse(nutzlast);
      if (!geprueft.success) return;

      const stelle = l.aktuell.leser.indexOf(geprueft.data.userId);
      if (stelle === -1) return;

      const partie = await ctx.partie();
      if (!partie) return;

      const abgeloest = l.aktuell.bedienerId;
      l.aktuell.leser[stelle] = abgeloest;
      l.aktuell.bedienerId = geprueft.data.userId;

      system(l, `${name(partie, geprueft.data.userId)} übernimmt das Pult.`);
      await ctx.senden();
    },
  },

  verwerfen(code) {
    const l = live(code);
    if (l) uhrStoppen(l);
    partien.delete(code);
  },
};
