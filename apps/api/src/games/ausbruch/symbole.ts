import { randomInt } from 'node:crypto';
import { austeilen, eins, mischen, ziehen } from './zufall.js';
import type { Anforderung, Zugergebnis } from './raetsel.js';

/**
 * Symbolschloss -- vier Tasten, aber nur eine Reihenfolge stimmt.
 *
 * Das Raetsel, an dem die Sprache scheitert: Die Zeichen haben keinen Namen.
 * Der Bediener muss beschreiben, was er sieht („so ein Hufeisen, offen nach
 * unten"), und die Unterlagen halten Spalten mit derselben Sorte Zeichen.
 * Genau **eine** Spalte enthaelt alle Tasten -- ihre Reihenfolge ist die
 * gesuchte.
 *
 * Tippen laesst sich keines dieser Zeichen; das Raetsel ist damit von selbst
 * gegen den Weg ueber die Zwischenablage gesichert.
 *
 * Der Unterschied der Modi liegt nicht in der Menge, sondern in der
 * Beschreibbarkeit: Normal kommen die Zeichen aus allen Familien -- ein Stern,
 * ein Buchstabe, ein Herz, das sagt sich in drei Worten. Schwer zieht **eine
 * einzige Familie**, und dann stehen acht Sterne nebeneinander, die sich nur
 * in der Zahl ihrer Zacken unterscheiden.
 */

const FAMILIEN = {
  sterne: ['★', '☆', '✦', '✧', '✶', '✷', '✸', '✹', '✺', '✳', '✴', '✵', '❄', '❅', '❆', '❂'],
  kanten: ['Λ', 'Δ', 'Ξ', 'Σ', 'Π', 'Θ', 'Ω', 'Ψ', 'Φ', 'Υ', 'Ж', 'Я', 'Ю', 'Ц', 'Щ', 'Э'],
  zeichen: ['♠', '♣', '♥', '♦', '♪', '♫', '✚', '✖', '✽', '✾', '✿', '❀', '❖', '❥', '❍', '☂'],
} as const;

const ALLE = Object.values(FAMILIEN).flat();

export interface SymboleRaetsel {
  art: 'symbole';
  /** Die Spalten der Unterlagen. Genau eine enthaelt alle Tasten. */
  spalten: string[][];
  /** Was am Pult steht, in Anzeigereihenfolge. */
  tasten: string[];
  /** Dieselben Tasten in der Reihenfolge ihrer Spalte. */
  loesung: string[];
  /** Wie weit die Folge schon steht. */
  gedrueckt: string[];
}

export function erzeugen({ nr, schwer, leser }: Anforderung): SymboleRaetsel {
  const tastenAnzahl = schwer ? (nr >= 2 ? 6 : 5) : nr >= 2 ? 5 : 4;
  // Die Spalte ist laenger als die Tastenreihe: Sonst waere sie schon an der
  // Anzahl zu erkennen, und niemand muesste die Zeichen vergleichen.
  const laenge = tastenAnzahl + 2;
  // Nie weniger Spalten als Leser -- sonst haelt jemand ein leeres Blatt.
  const spaltenAnzahl = schwer ? Math.max(5, leser + 1) : Math.max(4, leser);

  // Im schweren Modus stammt alles aus einer Familie. Damit hilft kein
  // Oberbegriff mehr weiter, sondern nur noch die genaue Form.
  const vorrat = mischen(schwer ? eins(Object.values(FAMILIEN)) : ALLE);

  const loesungsspalte = vorrat.slice(0, laenge);
  const tasten = ziehen(loesungsspalte, tastenAnzahl);
  const loesung = loesungsspalte.filter((s) => tasten.includes(s));

  // Fuellzeichen sind alles, was keine Taste ist -- auch die uebrigen Zeichen
  // der richtigen Spalte. Gerade die machen die Suche schwer: Zwei Spalten
  // unterscheiden sich dann in einem einzigen Zeichen.
  const fuellung = vorrat.filter((s) => !tasten.includes(s));

  const spalten: string[][] = [loesungsspalte];

  for (let i = 1; i < spaltenAnzahl; i++) {
    // Hoechstens eine Taste weniger als noetig: Die anderen Spalten sollen
    // fast passen -- sonst faellt die richtige beim Ueberfliegen ins Auge.
    const treffer = randomInt(tastenAnzahl);
    spalten.push(mischen([...ziehen(tasten, treffer), ...ziehen(fuellung, laenge - treffer)]));
  }

  return {
    art: 'symbole',
    spalten: mischen(spalten),
    tasten: mischen(tasten),
    loesung,
    gedrueckt: [],
  };
}

export function pult(raetsel: SymboleRaetsel) {
  return {
    art: 'symbole' as const,
    tasten: raetsel.tasten,
    gedrueckt: raetsel.gedrueckt,
    gesamt: raetsel.loesung.length,
  };
}

export function unterlagen(raetsel: SymboleRaetsel, haende: number) {
  const nummeriert = raetsel.spalten.map((symbole, i) => ({ nr: i + 1, symbole }));

  return austeilen(nummeriert, haende).map((stapel) => ({
    art: 'symbole' as const,
    gesamt: raetsel.spalten.length,
    spalten: stapel,
  }));
}

export function eingabe(raetsel: SymboleRaetsel, nutzlast: unknown): Zugergebnis {
  const symbol = (nutzlast as { symbol?: unknown } | null)?.symbol;
  if (typeof symbol !== 'string' || !raetsel.tasten.includes(symbol)) return { status: 'weiter' };

  if (symbol === raetsel.loesung[raetsel.gedrueckt.length]) {
    raetsel.gedrueckt.push(symbol);
    return raetsel.gedrueckt.length >= raetsel.loesung.length
      ? { status: 'geloest' }
      : { status: 'weiter' };
  }

  // Zurueck auf Anfang. Die halb richtige Folge stehen zu lassen waere
  // gnaediger -- und wuerde das Schloss in ein Ausprobieren verwandeln.
  const bisher = raetsel.gedrueckt.length;
  raetsel.gedrueckt = [];

  return {
    status: 'fehlalarm',
    meldung:
      bisher > 0
        ? `Falsches Zeichen an Stelle ${bisher + 1} — die Folge beginnt von vorn.`
        : 'Falsches Zeichen — das Schloss fängt von vorn an.',
  };
}
