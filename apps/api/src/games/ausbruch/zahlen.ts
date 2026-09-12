import { randomInt } from 'node:crypto';
import { austeilen, eins, mischen } from './zufall.js';
import type { Anforderung, Zugergebnis } from './raetsel.js';

/**
 * Zahlenschloss -- jeder rechnet eine Ziffer aus, zusammen ergibt es den Code.
 *
 * Das schnellste der vier Raetsel, und das einzige, bei dem alle gleichzeitig
 * etwas zu tun haben: Der Bediener liest Seriennummer und Lampen vor, danach
 * rechnet jeder an seiner Stelle. Die Nummer der Stelle sagt, wohin die Ziffer
 * gehoert -- also muss auch noch sortiert werden, wer wann dran ist.
 *
 * Im schweren Modus verweisen Stellen auf **andere Stellen**: „die Summe der
 * Stellen 1 und 3". Damit reden die Leser nicht mehr nur mit dem Pult, sondern
 * miteinander -- und zwar in einer Reihenfolge, die sie selbst herausfinden
 * muessen. Eine Kette zeigt dabei nur nach hinten; im Kreis kaeme niemand an.
 *
 * Nach einem Fehlalarm wechseln Seriennummer und Lampen. Die Regeln bleiben,
 * das Rechnen faengt von vorn an -- Durchprobieren kostet damit mehr Zeit, als
 * es einbringt.
 */

const BUCHSTABEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const VOKALE = 'AEIOU';

type Grundregel =
  | 'buchstaben'
  | 'ziffern'
  | 'quersumme'
  | 'ersteZiffer'
  | 'letzteZiffer'
  | 'groessteZiffer'
  | 'kleinsteZiffer'
  | 'vokale'
  | 'lampenAn'
  | 'lampenAusDoppelt'
  | 'lampeEntscheidet'
  | 'lampeUndQuersumme'
  // Ab hier nur im schweren Modus.
  | 'buchstabenWert'
  | 'vorErsterZiffer'
  | 'lampenPaar'
  | 'ziffernSpanne';

const GRUNDTEXT: Record<Grundregel, string> = {
  buchstaben: 'Die Anzahl der Buchstaben in der Seriennummer.',
  ziffern: 'Die Anzahl der Ziffern in der Seriennummer.',
  quersumme: 'Die Quersumme aller Ziffern der Seriennummer — davon die letzte Stelle.',
  ersteZiffer: 'Die erste Ziffer, die in der Seriennummer vorkommt.',
  letzteZiffer: 'Die letzte Ziffer, die in der Seriennummer vorkommt.',
  groessteZiffer: 'Die größte Ziffer der Seriennummer.',
  kleinsteZiffer: 'Die kleinste Ziffer der Seriennummer.',
  vokale: 'Die Anzahl der Vokale (A, E, I, O, U) in der Seriennummer.',
  lampenAn: 'Die Anzahl der leuchtenden Lampen.',
  lampenAusDoppelt: 'Die Anzahl der dunklen Lampen, mal zwei — davon die letzte Stelle.',
  lampeEntscheidet:
    'Leuchtet Lampe 1, ist es die erste Ziffer der Seriennummer — sonst die letzte.',
  lampeUndQuersumme:
    'Leuchtet Lampe 3, ist es die Anzahl der Buchstaben — sonst die Quersumme der Ziffern.',
  buchstabenWert:
    'Der Platz des ersten Buchstabens im Alphabet (A=1, B=2 …) — davon die letzte Stelle.',
  vorErsterZiffer: 'Die Anzahl der Buchstaben, die vor der ersten Ziffer stehen.',
  lampenPaar:
    'Leuchten Lampe 2 und Lampe 4 beide? Dann die Anzahl der Ziffern, sonst die der Buchstaben.',
  ziffernSpanne: 'Der Abstand zwischen der größten und der kleinsten Ziffer der Seriennummer.',
};

const LEICHTE_REGELN: Grundregel[] = [
  'buchstaben',
  'ziffern',
  'quersumme',
  'ersteZiffer',
  'letzteZiffer',
  'groessteZiffer',
  'kleinsteZiffer',
  'vokale',
  'lampenAn',
  'lampenAusDoppelt',
  'lampeEntscheidet',
  'lampeUndQuersumme',
];

const SCHWERE_REGELN: Grundregel[] = [
  'buchstabenWert',
  'vorErsterZiffer',
  'lampenPaar',
  'ziffernSpanne',
];

/**
 * Eine Regel zeigt entweder auf die Anlage oder auf andere Stellen.
 *
 * Die verketteten Formen stehen nur im schweren Modus und nie an erster
 * Stelle: `a` und `b` sind immer kleiner als die eigene Nummer.
 */
type Regel =
  | { art: 'grund'; grund: Grundregel }
  | { art: 'summe'; a: number; b: number }
  | { art: 'abstand'; a: number; b: number }
  | { art: 'doppelt'; a: number };

interface Stelle {
  /** Einsbasiert: die Stelle im Code, an die diese Ziffer gehoert. */
  nr: number;
  regel: Regel;
  text: string;
}

export interface ZahlenRaetsel {
  art: 'zahlen';
  schwer: boolean;
  seriennummer: string;
  lampen: boolean[];
  stellen: Stelle[];
  loesung: string;
}

const LAMPEN = 4;

function seriennummerWuerfeln(schwer: boolean): string {
  const buchstabe = () => BUCHSTABEN[randomInt(BUCHSTABEN.length)];
  const ziffer = () => String(randomInt(10));

  // Laenger im schweren Modus: mehr zu diktieren, mehr zu zaehlen, mehr
  // Gelegenheit, sich beim Vorlesen zu vertun.
  return schwer
    ? `${buchstabe()}${buchstabe()}${ziffer()}${ziffer()}-${buchstabe()}${ziffer()}${buchstabe()}${ziffer()}`
    : `${buchstabe()}${buchstabe()}${ziffer()}-${ziffer()}${buchstabe()}${ziffer()}`;
}

const ziffernVon = (text: string): number[] =>
  [...text].filter((z) => z >= '0' && z <= '9').map(Number);

const buchstabenVon = (text: string): string[] => [...text].filter((z) => z >= 'A' && z <= 'Z');

function grundrechnen(grund: Grundregel, seriennummer: string, lampen: boolean[]): number {
  const ziffern = ziffernVon(seriennummer);
  const buchstaben = buchstabenVon(seriennummer);
  const quersumme = ziffern.reduce((summe, z) => summe + z, 0);
  const an = lampen.filter(Boolean).length;

  switch (grund) {
    case 'buchstaben':
      return buchstaben.length;
    case 'ziffern':
      return ziffern.length;
    case 'quersumme':
      return quersumme;
    case 'ersteZiffer':
      return ziffern[0];
    case 'letzteZiffer':
      return ziffern[ziffern.length - 1];
    case 'groessteZiffer':
      return Math.max(...ziffern);
    case 'kleinsteZiffer':
      return Math.min(...ziffern);
    case 'vokale':
      return buchstaben.filter((b) => VOKALE.includes(b)).length;
    case 'lampenAn':
      return an;
    case 'lampenAusDoppelt':
      return (lampen.length - an) * 2;
    case 'lampeEntscheidet':
      return lampen[0] ? ziffern[0] : ziffern[ziffern.length - 1];
    case 'lampeUndQuersumme':
      return lampen[2] ? buchstaben.length : quersumme;
    case 'buchstabenWert':
      return buchstaben[0].charCodeAt(0) - 64;
    case 'vorErsterZiffer': {
      // Wirklich zaehlen statt die Position zu nehmen: Im Bindestrich staeke
      // sonst ein Buchstabe, den niemand sieht.
      const bisZiffer = seriennummer.slice(
        0,
        [...seriennummer].findIndex((z) => z >= '0' && z <= '9'),
      );
      return buchstabenVon(bisZiffer).length;
    }
    case 'lampenPaar':
      return lampen[1] && lampen[3] ? ziffern.length : buchstaben.length;
    case 'ziffernSpanne':
      return Math.max(...ziffern) - Math.min(...ziffern);
  }
}

/** `bisher` haelt die schon berechneten Ziffern -- Stelle 1 steht an Index 0. */
function rechnen(
  regel: Regel,
  seriennummer: string,
  lampen: boolean[],
  bisher: number[],
): number {
  switch (regel.art) {
    case 'grund':
      return grundrechnen(regel.grund, seriennummer, lampen);
    case 'summe':
      return bisher[regel.a - 1] + bisher[regel.b - 1];
    case 'abstand':
      return Math.abs(bisher[regel.a - 1] - bisher[regel.b - 1]);
    case 'doppelt':
      return bisher[regel.a - 1] * 2;
  }
}

function regeltext(regel: Regel): string {
  switch (regel.art) {
    case 'grund':
      return GRUNDTEXT[regel.grund];
    case 'summe':
      return `Die Summe der Stellen ${regel.a} und ${regel.b} — davon die letzte Stelle.`;
    case 'abstand':
      return `Der Abstand zwischen Stelle ${regel.a} und Stelle ${regel.b}.`;
    case 'doppelt':
      return `Das Doppelte von Stelle ${regel.a} — davon die letzte Stelle.`;
  }
}

/** Jede Stelle ist eine einzelne Ziffer -- alles darueber faellt weg. */
function loesungBauen(raetsel: ZahlenRaetsel): string {
  const bisher: number[] = [];

  // Von vorn nach hinten: Eine verkettete Regel zeigt nur auf Stellen vor der
  // eigenen, also steht ihr Verweis hier immer schon bereit.
  for (const stelle of raetsel.stellen) {
    bisher.push(rechnen(stelle.regel, raetsel.seriennummer, raetsel.lampen, bisher) % 10);
  }

  return bisher.join('');
}

function neuWuerfeln(raetsel: ZahlenRaetsel): void {
  raetsel.seriennummer = seriennummerWuerfeln(raetsel.schwer);
  raetsel.lampen = Array.from({ length: LAMPEN }, () => randomInt(2) === 1);
  raetsel.loesung = loesungBauen(raetsel);
}

export function erzeugen({ nr, schwer, leser }: Anforderung): ZahlenRaetsel {
  // So viele Stellen wie Leser: Dann hat jeder genau eine Ziffer und keiner
  // wartet. Bei wenigen Leuten wird aufgefuellt -- ein zweistelliger Code
  // waere in drei Sekunden geraten.
  const anzahl = schwer
    ? Math.min(7, Math.max(4, leser + 1) + (nr >= 2 ? 1 : 0))
    : Math.min(LEICHTE_REGELN.length, Math.max(3, leser) + (nr >= 3 ? 1 : 0));

  const vorrat = mischen(schwer ? [...LEICHTE_REGELN, ...SCHWERE_REGELN] : LEICHTE_REGELN);
  const stellen: Stelle[] = [];

  for (let i = 0; i < anzahl; i++) {
    // Die erste Stelle muss an der Anlage haengen -- eine Kette braucht einen
    // Anfang. Danach hoechstens jede dritte verkettet: Zu viele, und niemand
    // haette mehr etwas zu rechnen.
    const verkettbar = schwer && i >= 2 && stellen.filter((s) => s.regel.art !== 'grund').length * 3 < i;
    const regel: Regel = verkettbar
      ? eins<Regel>([
          { art: 'summe', a: 1 + randomInt(i), b: 1 + randomInt(i) },
          { art: 'abstand', a: 1 + randomInt(i), b: 1 + randomInt(i) },
          { art: 'doppelt', a: 1 + randomInt(i) },
        ])
      : { art: 'grund', grund: vorrat[i % vorrat.length] };

    // Eine Summe aus einer Stelle mit sich selbst waere das Doppelte, und ein
    // Abstand zu sich selbst immer null.
    if ((regel.art === 'summe' || regel.art === 'abstand') && regel.a === regel.b) {
      regel.b = (regel.b % i) + 1;
    }

    stellen.push({ nr: i + 1, regel, text: regeltext(regel) });
  }

  const raetsel: ZahlenRaetsel = {
    art: 'zahlen',
    schwer,
    seriennummer: '',
    lampen: [],
    stellen,
    loesung: '',
  };

  neuWuerfeln(raetsel);

  return raetsel;
}

export function pult(raetsel: ZahlenRaetsel) {
  return {
    art: 'zahlen' as const,
    seriennummer: raetsel.seriennummer,
    lampen: raetsel.lampen,
    stellen: raetsel.loesung.length,
  };
}

export function unterlagen(raetsel: ZahlenRaetsel, haende: number) {
  return austeilen(raetsel.stellen, haende).map((stapel) => ({
    art: 'zahlen' as const,
    gesamt: raetsel.stellen.length,
    stellen: stapel.map((s) => ({
      nr: s.nr,
      text: s.text,
      /** Ob die Stelle auf andere Stellen zeigt -- dann erst fragen, dann rechnen. */
      verkettet: s.regel.art !== 'grund',
    })),
  }));
}

export function eingabe(raetsel: ZahlenRaetsel, nutzlast: unknown): Zugergebnis {
  const code = (nutzlast as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || code.length !== raetsel.loesung.length) {
    return { status: 'weiter' };
  }

  if (code === raetsel.loesung) return { status: 'geloest' };

  neuWuerfeln(raetsel);

  return {
    status: 'fehlalarm',
    meldung: `${code} war falsch — Seriennummer und Lampen wechseln.`,
  };
}
