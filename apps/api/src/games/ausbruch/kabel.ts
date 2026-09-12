import { randomInt } from 'node:crypto';
import { austeilen, eins, mischen, zahlwort } from './zufall.js';
import type { Anforderung, Zugergebnis } from './raetsel.js';

/**
 * Sicherungskasten -- ein Kabel durchtrennen, aber das richtige.
 *
 * Das Raetsel mit dem laengsten Gespraech: Der Bediener beschreibt, was er
 * sieht, und die Unterlagen sagen, was daraus folgt. Die Regeln gelten
 * **der Reihe nach** -- die erste, die zutrifft, gewinnt. Genau daran haengt
 * die Zusammenarbeit: Wer Regel 4 in der Hand hat, darf nicht einfach
 * losrufen, sondern muss wissen, ob die Regeln davor schon gegriffen haben.
 *
 * Im schweren Modus kommt eine **Modulnummer** dazu, auf die Regeln zeigen
 * koennen, und Bedingungen, die nicht mehr zu sehen, sondern zu zaehlen sind:
 * „mehr blaue als rote", „zwei gruene nebeneinander". Der Unterschied ist
 * nicht die Menge -- es ist, dass der Bediener nicht mehr vorlesen kann, was
 * vor ihm liegt, sondern es auswerten muss.
 */

/**
 * Vier Formen je Farbe, weil das Deutsche sie braucht:
 * „das letzte Kabel ist *rot*", „genau ein *rotes* Kabel", „zwei *rote* Kabel",
 * „zaehle die *roten* Kabel". Mit drei Formen steht in jeder Partie irgendwo
 * ein falscher Satz, und den liest jemand vor.
 */
const FARBEN = {
  rot: { pur: 'rot', ein: 'rotes', mehr: 'rote', zaehl: 'roten' },
  blau: { pur: 'blau', ein: 'blaues', mehr: 'blaue', zaehl: 'blauen' },
  gruen: { pur: 'grün', ein: 'grünes', mehr: 'grüne', zaehl: 'grünen' },
  gelb: { pur: 'gelb', ein: 'gelbes', mehr: 'gelbe', zaehl: 'gelben' },
  weiss: { pur: 'weiß', ein: 'weißes', mehr: 'weiße', zaehl: 'weißen' },
  schwarz: { pur: 'schwarz', ein: 'schwarzes', mehr: 'schwarze', zaehl: 'schwarzen' },
} as const;

export type Kabelfarbe = keyof typeof FARBEN;

const FARBLISTE = Object.keys(FARBEN) as Kabelfarbe[];

interface Kabel {
  farbe: Kabelfarbe;
  /** Ein Stern auf der Isolierung. Manche Regeln haengen daran. */
  markiert: boolean;
}

type Bedingung =
  | { art: 'mindestens'; farbe: Kabelfarbe; wert: number }
  | { art: 'genau'; farbe: Kabelfarbe; wert: number }
  | { art: 'keins'; farbe: Kabelfarbe }
  | { art: 'erstesIst'; farbe: Kabelfarbe }
  | { art: 'letztesIst'; farbe: Kabelfarbe }
  | { art: 'gerade' }
  | { art: 'markiert'; wert: number }
  // Ab hier nur im schweren Modus.
  | { art: 'mehrAls'; farbe: Kabelfarbe; andere: Kabelfarbe }
  | { art: 'nebeneinander'; farbe: Kabelfarbe }
  | { art: 'modul'; gerade: boolean }
  | { art: 'immer' };

type Aktion =
  | { art: 'ersteFarbe'; farbe: Kabelfarbe }
  | { art: 'letzteFarbe'; farbe: Kabelfarbe }
  | { art: 'erstes' }
  | { art: 'letztes' }
  | { art: 'markiertes' }
  | { art: 'nummer'; nr: number }
  // Ab hier nur im schweren Modus.
  | { art: 'zweiteFarbe'; farbe: Kabelfarbe }
  | { art: 'anzahlAlsNummer'; farbe: Kabelfarbe };

interface Regel {
  /** Einsbasiert -- und zugleich die Reihenfolge, in der geprueft wird. */
  nr: number;
  text: string;
  bedingung: Bedingung;
  aktion: Aktion;
}

export interface KabelRaetsel {
  art: 'kabel';
  kabel: Kabel[];
  /** Nur im schweren Modus: die zweite Angabe am Pult, etwa „K-7". */
  modul: string | null;
  regeln: Regel[];
  /** Nullbasiert. Steht nach jedem Bestuecken neu fest. */
  loesung: number;
  /** Welche Regel die Loesung liefert. Nur fuer die Aufloesung am Zugende. */
  greift: number;
}

/** Wie viele Kabel im Kasten liegen. Daran haengt, bis wohin „Kabel N" gilt. */
const MIN_KABEL = 4;
const MAX_KABEL = 8;

// ---------- Auswerten -------------------------------------------------------

function zaehlen(kabel: Kabel[], farbe: Kabelfarbe): number {
  return kabel.filter((k) => k.farbe === farbe).length;
}

/** Die Ziffer der Modulnummer. Ohne Modul zaehlt die Regel nie. */
function modulziffer(raetsel: Pick<KabelRaetsel, 'modul'>): number | null {
  const ziffer = raetsel.modul?.slice(-1);
  return ziffer ? Number(ziffer) : null;
}

function trifftZu(bedingung: Bedingung, raetsel: KabelRaetsel): boolean {
  const kabel = raetsel.kabel;

  switch (bedingung.art) {
    case 'mindestens':
      return zaehlen(kabel, bedingung.farbe) >= bedingung.wert;
    case 'genau':
      return zaehlen(kabel, bedingung.farbe) === bedingung.wert;
    case 'keins':
      return zaehlen(kabel, bedingung.farbe) === 0;
    case 'erstesIst':
      return kabel[0].farbe === bedingung.farbe;
    case 'letztesIst':
      return kabel[kabel.length - 1].farbe === bedingung.farbe;
    case 'gerade':
      return kabel.length % 2 === 0;
    case 'markiert':
      return kabel.filter((k) => k.markiert).length === bedingung.wert;
    case 'mehrAls':
      return zaehlen(kabel, bedingung.farbe) > zaehlen(kabel, bedingung.andere);
    case 'nebeneinander':
      return kabel.some(
        (k, i) => i > 0 && k.farbe === bedingung.farbe && kabel[i - 1].farbe === bedingung.farbe,
      );
    case 'modul': {
      const ziffer = modulziffer(raetsel);
      return ziffer !== null && ziffer % 2 === (bedingung.gerade ? 0 : 1);
    }
    case 'immer':
      return true;
  }
}

/** Welches Kabel die Aktion meint -- oder -1, wenn es keines dazu gibt. */
function aufloesen(aktion: Aktion, kabel: Kabel[]): number {
  switch (aktion.art) {
    case 'ersteFarbe':
      return kabel.findIndex((k) => k.farbe === aktion.farbe);
    case 'letzteFarbe':
      return kabel.findLastIndex((k) => k.farbe === aktion.farbe);
    case 'erstes':
      return 0;
    case 'letztes':
      return kabel.length - 1;
    case 'markiertes':
      return kabel.findIndex((k) => k.markiert);
    case 'nummer':
      return aktion.nr - 1 < kabel.length ? aktion.nr - 1 : -1;
    case 'zweiteFarbe': {
      const stellen = kabel.flatMap((k, i) => (k.farbe === aktion.farbe ? [i] : []));
      return stellen.length >= 2 ? stellen[1] : -1;
    }
    case 'anzahlAlsNummer': {
      const anzahl = zaehlen(kabel, aktion.farbe);
      return anzahl >= 1 && anzahl <= kabel.length ? anzahl - 1 : -1;
    }
  }
}

/**
 * Die erste Regel, die zutrifft und auf ein vorhandenes Kabel zeigt.
 *
 * Beides muss stimmen: Eine Regel, deren Bedingung greift, deren Kabel aber
 * gar nicht im Kasten liegt, waere am Tisch nicht zu erklaeren. Bedingung und
 * Aktion sind beim Bauen schon so gepaart, dass das nicht vorkommen kann --
 * die Pruefung hier ist der Gurt dazu.
 */
function auswerten(raetsel: KabelRaetsel): { loesung: number; greift: number } {
  for (const regel of raetsel.regeln) {
    if (!trifftZu(regel.bedingung, raetsel)) continue;

    const ziel = aufloesen(regel.aktion, raetsel.kabel);
    if (ziel >= 0) return { loesung: ziel, greift: regel.nr };
  }

  // Kommt nicht vor: Die letzte Regel ist „Sonst" mit einer Aktion, die immer
  // aufgeht. Lieber das erste Kabel als ein Absturz mitten in der Partie.
  return { loesung: 0, greift: raetsel.regeln.length };
}

// ---------- Bauen -----------------------------------------------------------

const MODULBUCHSTABEN = 'BCDFGHKLMNPRSTVWXZ';

/** Eine Modulnummer wie „K-7". Die Null bleibt draussen: „gerade" ist strittig genug. */
function modulWuerfeln(): string {
  return `${MODULBUCHSTABEN[randomInt(MODULBUCHSTABEN.length)]}-${1 + randomInt(9)}`;
}

function kabelWuerfeln(anzahl: number): Kabel[] {
  const kabel: Kabel[] = [];
  for (let i = 0; i < anzahl; i++) {
    kabel.push({ farbe: eins(FARBLISTE), markiert: false });
  }

  // Hoechstens zwei Sterne: Bei dreien ist „genau ein Kabel mit Stern" so gut
  // wie nie wahr, und die Regel stuende nur als Fuellsel in den Unterlagen.
  const sterne = randomInt(3);
  for (const stelle of mischen(kabel.map((_, i) => i)).slice(0, sterne)) {
    kabel[stelle].markiert = true;
  }

  return kabel;
}

type Vorlage = Exclude<Bedingung['art'], 'immer'>;

const LEICHTE_VORLAGEN: Vorlage[] = [
  'mindestens',
  'genau',
  'keins',
  'erstesIst',
  'letztesIst',
  'gerade',
  'markiert',
];

/**
 * Die Bedingungen, die man nicht mehr sieht, sondern auszaehlen muss.
 *
 * `modul` steht hier **einmal**, obwohl es gerade und ungerade gibt: Zwei
 * Regeln, von denen immer genau eine zutrifft, machen jede Regel darunter zu
 * totem Text -- und niemand merkt es, weil die Unterlagen verteilt sind.
 */
const SCHWERE_VORLAGEN: Vorlage[] = ['mehrAls', 'nebeneinander', 'modul'];

function bedingungBauen(vorlage: Vorlage, farbe: Kabelfarbe, andere: Kabelfarbe): Bedingung {
  switch (vorlage) {
    case 'mindestens':
      return { art: 'mindestens', farbe, wert: 2 };
    case 'genau':
      return { art: 'genau', farbe, wert: 1 + randomInt(2) };
    case 'keins':
      return { art: 'keins', farbe };
    case 'erstesIst':
      return { art: 'erstesIst', farbe };
    case 'letztesIst':
      return { art: 'letztesIst', farbe };
    case 'gerade':
      return { art: 'gerade' };
    case 'markiert':
      return { art: 'markiert', wert: 1 + randomInt(2) };
    case 'mehrAls':
      return { art: 'mehrAls', farbe, andere };
    case 'nebeneinander':
      return { art: 'nebeneinander', farbe };
    case 'modul':
      return { art: 'modul', gerade: randomInt(2) === 0 };
  }
}

/**
 * Eine Aktion, die zur Bedingung passt.
 *
 * „Passt" heisst: Solange die Bedingung zutrifft, gibt es das genannte Kabel
 * mit Sicherheit. Wer nach dem zweiten blauen Kabel greifen laesst, muss in
 * derselben Regel gesagt haben, dass es mindestens zwei blaue gibt -- sonst
 * stuende eine Regel in den Unterlagen, die ins Leere zeigt.
 */
function aktionBauen(bedingung: Bedingung, kabelAnzahl: number, schwer: boolean): Aktion {
  const irgendeins: Aktion[] = [
    { art: 'erstes' },
    { art: 'letztes' },
    { art: 'nummer', nr: 2 + randomInt(Math.min(kabelAnzahl, MIN_KABEL) - 1) },
  ];

  /**
   * Fuer Bedingungen, die mindestens ein Kabel dieser Farbe verbuergen.
   *
   * `zaehlbar` ist falsch, wo die Bedingung die Anzahl schon nennt: „Wenn genau
   * ein blaues Kabel dabei ist, zaehle die blauen Kabel" laeuft immer auf
   * Kabel 1 hinaus -- eine Regel, die schwer aussieht und keine ist.
   */
  const zurFarbe = (farbe: Kabelfarbe, mindestensZwei: boolean, zaehlbar = true): Aktion[] => [
    { art: 'ersteFarbe', farbe },
    { art: 'letzteFarbe', farbe },
    ...(schwer && zaehlbar ? ([{ art: 'anzahlAlsNummer', farbe }] as Aktion[]) : []),
    ...(schwer && mindestensZwei ? ([{ art: 'zweiteFarbe', farbe }] as Aktion[]) : []),
  ];

  switch (bedingung.art) {
    case 'mindestens':
      return eins(zurFarbe(bedingung.farbe, bedingung.wert >= 2));
    case 'genau':
      return eins(zurFarbe(bedingung.farbe, bedingung.wert >= 2, false));
    case 'erstesIst':
    case 'letztesIst':
      return eins([...zurFarbe(bedingung.farbe, false, false), ...irgendeins]);
    case 'mehrAls':
      return eins(zurFarbe(bedingung.farbe, false));
    case 'nebeneinander':
      return eins(zurFarbe(bedingung.farbe, true));
    case 'markiert':
      return eins<Aktion>([{ art: 'markiertes' }, ...irgendeins]);
    case 'keins':
    case 'gerade':
    case 'modul':
    case 'immer':
      return eins(irgendeins);
  }
}

function bedingungstext(bedingung: Bedingung): string {
  switch (bedingung.art) {
    case 'mindestens':
      return `Wenn mindestens ${zahlwort(bedingung.wert)} ${FARBEN[bedingung.farbe].mehr} Kabel dabei sind`;
    case 'genau':
      return bedingung.wert === 1
        ? `Wenn genau ein ${FARBEN[bedingung.farbe].ein} Kabel dabei ist`
        : `Wenn genau ${zahlwort(bedingung.wert)} ${FARBEN[bedingung.farbe].mehr} Kabel dabei sind`;
    case 'keins':
      return `Wenn kein ${FARBEN[bedingung.farbe].ein} Kabel dabei ist`;
    case 'erstesIst':
      return `Wenn das erste Kabel ${FARBEN[bedingung.farbe].pur} ist`;
    case 'letztesIst':
      return `Wenn das letzte Kabel ${FARBEN[bedingung.farbe].pur} ist`;
    case 'gerade':
      return 'Wenn die Anzahl der Kabel gerade ist';
    case 'markiert':
      return bedingung.wert === 1
        ? 'Wenn genau ein Kabel einen Stern trägt'
        : `Wenn genau ${zahlwort(bedingung.wert)} Kabel einen Stern tragen`;
    case 'mehrAls':
      return `Wenn mehr ${FARBEN[bedingung.farbe].mehr} als ${FARBEN[bedingung.andere].mehr} Kabel dabei sind`;
    case 'nebeneinander':
      return `Wenn zwei ${FARBEN[bedingung.farbe].mehr} Kabel direkt nebeneinander liegen`;
    case 'modul':
      return `Wenn die Ziffer der Modulnummer ${bedingung.gerade ? 'gerade' : 'ungerade'} ist`;
    case 'immer':
      return 'Sonst';
  }
}

function aktionstext(aktion: Aktion): string {
  switch (aktion.art) {
    case 'ersteFarbe':
      return `durchtrenne das erste ${FARBEN[aktion.farbe].mehr} Kabel.`;
    case 'letzteFarbe':
      return `durchtrenne das letzte ${FARBEN[aktion.farbe].mehr} Kabel.`;
    case 'zweiteFarbe':
      return `durchtrenne das zweite ${FARBEN[aktion.farbe].mehr} Kabel.`;
    case 'erstes':
      return 'durchtrenne das erste Kabel.';
    case 'letztes':
      return 'durchtrenne das letzte Kabel.';
    case 'markiertes':
      return 'durchtrenne das erste Kabel mit Stern.';
    case 'nummer':
      return `durchtrenne Kabel ${aktion.nr}.`;
    case 'anzahlAlsNummer':
      return `zähle die ${FARBEN[aktion.farbe].zaehl} Kabel und durchtrenne das Kabel mit dieser Nummer.`;
  }
}

function regelnBauen(anzahl: number, kabelAnzahl: number, schwer: boolean): Regel[] {
  // Im schweren Modus mischen sich die zaehlenden Bedingungen unter die
  // sichtbaren. Nur sie waeren eintoenig -- der Reiz liegt darin, dass man
  // jeder Regel erst ansehen muss, welche Sorte Arbeit sie macht.
  const vorrat = schwer ? [...LEICHTE_VORLAGEN, ...SCHWERE_VORLAGEN] : LEICHTE_VORLAGEN;
  const vorlagen = mischen(vorrat).slice(0, anzahl - 1);
  const farben = mischen(FARBLISTE);

  const regeln: Regel[] = vorlagen.map((vorlage, i) => {
    const bedingung = bedingungBauen(
      vorlage,
      farben[i % farben.length],
      farben[(i + 1) % farben.length],
    );
    const aktion = aktionBauen(bedingung, kabelAnzahl, schwer);

    return {
      nr: i + 1,
      text: `${bedingungstext(bedingung)}: ${aktionstext(aktion)}`,
      bedingung,
      aktion,
    };
  });

  // Die Schlussregel faengt auf, was keine andere erwischt. Ohne sie koennte
  // ein Kasten dastehen, zu dem die Unterlagen nichts sagen.
  const schluss: Bedingung = { art: 'immer' };
  const aktion = aktionBauen(schluss, kabelAnzahl, schwer);

  regeln.push({
    nr: regeln.length + 1,
    text: `${bedingungstext(schluss)}: ${aktionstext(aktion)}`,
    bedingung: schluss,
    aktion,
  });

  return regeln;
}

/**
 * Bestueckt den Kasten neu und rechnet die Loesung nach.
 *
 * Wird auch nach einem Fehlalarm gerufen: Die Regeln bleiben stehen, die
 * Kabel wechseln -- und mit ihnen die Modulnummer. Sonst waere ein falsch
 * durchtrenntes Kabel nur ein Ausschlussverfahren, und bei fuenf Kabeln
 * haette man es nach vier Versuchen.
 */
function neuBestuecken(raetsel: KabelRaetsel): void {
  const anzahl = raetsel.kabel.length > 0 ? raetsel.kabel.length : MIN_KABEL;

  // Ein paar Anlaeufe fuer einen Kasten, bei dem nicht gleich die Schlussregel
  // greift: Der Reiz liegt darin, die Regeln der Reihe nach durchzugehen.
  for (let versuch = 0; versuch < 8; versuch++) {
    raetsel.kabel = kabelWuerfeln(anzahl);
    if (raetsel.modul !== null) raetsel.modul = modulWuerfeln();

    const { loesung, greift } = auswerten(raetsel);
    raetsel.loesung = loesung;
    raetsel.greift = greift;

    if (greift < raetsel.regeln.length) return;
  }
}

export function erzeugen({ nr, schwer, leser }: Anforderung): KabelRaetsel {
  const kabelAnzahl = schwer
    ? Math.min(MAX_KABEL, 5 + Math.floor(nr / 2))
    : Math.min(7, MIN_KABEL + Math.floor(nr / 2));

  // Mindestens eine Regel mehr als Leser: Sonst geht jemand leer aus und
  // sitzt eine ganze Schleuse lang daneben.
  const regelAnzahl = schwer
    ? Math.min(9, Math.max(6 + Math.floor(nr / 2), leser + 1))
    : Math.min(8, Math.max(4 + Math.floor(nr / 2), leser + 1));

  const raetsel: KabelRaetsel = {
    art: 'kabel',
    kabel: [],
    modul: schwer ? modulWuerfeln() : null,
    regeln: regelnBauen(regelAnzahl, kabelAnzahl, schwer),
    loesung: 0,
    greift: 0,
  };

  raetsel.kabel = kabelWuerfeln(kabelAnzahl);
  neuBestuecken(raetsel);

  return raetsel;
}

// ---------- Sichten und Eingabe ---------------------------------------------

export function pult(raetsel: KabelRaetsel) {
  return {
    art: 'kabel' as const,
    modul: raetsel.modul,
    kabel: raetsel.kabel.map((k, i) => ({ nr: i + 1, farbe: k.farbe, markiert: k.markiert })),
  };
}

export function unterlagen(raetsel: KabelRaetsel, haende: number) {
  return austeilen(raetsel.regeln, haende).map((stapel) => ({
    art: 'kabel' as const,
    gesamt: raetsel.regeln.length,
    /** Ob am Pult eine Modulnummer steht, nach der zu fragen sich lohnt. */
    modul: raetsel.modul !== null,
    regeln: stapel.map((r) => ({ nr: r.nr, text: r.text })),
  }));
}

export function eingabe(raetsel: KabelRaetsel, nutzlast: unknown): Zugergebnis {
  const nr = (nutzlast as { kabel?: unknown } | null)?.kabel;
  if (typeof nr !== 'number' || !Number.isInteger(nr)) return { status: 'weiter' };

  const stelle = nr - 1;
  if (stelle < 0 || stelle >= raetsel.kabel.length) return { status: 'weiter' };

  if (stelle === raetsel.loesung) return { status: 'geloest' };

  const falsch = raetsel.kabel[stelle];
  neuBestuecken(raetsel);

  return {
    status: 'fehlalarm',
    meldung: `Kabel ${nr} (${FARBEN[falsch.farbe].pur}) war falsch — der Kasten bestückt sich neu.`,
  };
}
