import { mischen } from './zufall.js';
import * as kabel from './kabel.js';
import * as symbole from './symbole.js';
import * as schacht from './schacht.js';
import * as zahlen from './zahlen.js';
import type { KabelRaetsel } from './kabel.js';
import type { SymboleRaetsel } from './symbole.js';
import type { SchachtRaetsel } from './schacht.js';
import type { ZahlenRaetsel } from './zahlen.js';

/**
 * Die Schleusen, aus denen ein Ausbruch besteht.
 *
 * Jede Schleuse ist ein Raetsel, das in zwei Haelften zerfaellt: das **Pult**,
 * das nur der Bediener sieht, und die **Unterlagen**, die auf alle anderen
 * verteilt werden. Keine Haelfte fuehrt allein zur Loesung -- das ist die
 * ganze Idee des Spiels.
 *
 * Diese Datei ist die Verteilstelle. Sie kennt die vier Raetsel und sonst
 * nichts vom Spiel: kein Zeitkonto, keine Punkte, keinen Funk. Umgekehrt kennt
 * `index.ts` kein einzelnes Raetsel -- dort geht es nur noch um „geloest" oder
 * „Fehlalarm".
 *
 * Ein fuenftes Raetsel dazubauen heisst: eine Datei daneben legen, die
 * `erzeugen`, `pult`, `unterlagen` und `eingabe` ausfuehrt, und sie hier in
 * die vier Verteiler eintragen. Ausdruecklich mit `switch` statt mit einer
 * Tabelle: So sagt der Compiler Bescheid, wenn eine der vier Stellen vergessen
 * wurde.
 */

/** Was eine Eingabe am Pult bewirkt hat. */
export type Zugergebnis =
  | { status: 'weiter' }
  | { status: 'geloest' }
  | { status: 'fehlalarm'; meldung: string };

/**
 * Wie schwer eine Schleuse ausfallen soll.
 *
 * Drei Groessen, die jedes Raetsel anders auslegt -- deshalb stehen sie
 * zusammen in einem Umschlag statt als drei Parameter, die man an vier Stellen
 * in derselben Reihenfolge wiederholen muss.
 *
 * `schwer` ist dabei kein Regler, sondern ein Schalter auf **andere** Raetsel:
 * Der Sicherungskasten bekommt eine Modulnummer und Regeln, die zaehlen statt
 * zu zeigen; das Symbolschloss zieht alle Zeichen aus **einer** Familie, so
 * dass „ein Stern" nichts mehr aussagt; im Schacht liegen Sensoren und die
 * Luke fehlt auf dem Pult; und im Zahlenschloss verweisen Stellen aufeinander,
 * womit die Leser nicht mehr nur mit dem Pult reden, sondern miteinander.
 */
export interface Anforderung {
  /** Die wievielte Schleuse, nullbasiert. Nach hinten heraus wird es mehr. */
  nr: number;
  /** Der schwere Modus. */
  schwer: boolean;
  /** Auf wie viele Personen die Unterlagen gehen. */
  leser: number;
}

export type Raetsel = KabelRaetsel | SymboleRaetsel | SchachtRaetsel | ZahlenRaetsel;
export type RaetselArt = Raetsel['art'];

const KOPF: Record<RaetselArt, { titel: string; auftrag: string }> = {
  kabel: {
    titel: 'Sicherungskasten',
    auftrag: 'Ein Kabel durchtrennen — das, auf das die Regeln zeigen.',
  },
  symbole: {
    titel: 'Symbolschloss',
    auftrag: 'Die Zeichen in der richtigen Reihenfolge drücken.',
  },
  schacht: {
    titel: 'Wartungsschacht',
    auftrag: 'Den Melder blind durch den Schacht zur Luke lotsen.',
  },
  zahlen: {
    titel: 'Zahlenschloss',
    auftrag: 'Den Code eingeben — jede Stelle steht in einer anderen Unterlage.',
  },
};

export function kopf(art: RaetselArt): { titel: string; auftrag: string } {
  return KOPF[art];
}

/**
 * Welche Raetsel in welcher Reihenfolge drankommen.
 *
 * Erst alle vier, dann wieder alle vier: Bei reinem Zufall kaeme derselbe
 * Kasten zweimal hintereinander, und die zweite Schleuse waere dann nur noch
 * dieselbe Rechnung mit anderen Zahlen.
 */
export function folge(anzahl: number): RaetselArt[] {
  const arten = Object.keys(KOPF) as RaetselArt[];
  const liste: RaetselArt[] = [];

  while (liste.length < anzahl) {
    const runde = mischen(arten);
    // Kein Uebergang, bei dem dieselbe Art zweimal hintereinander steht.
    if (liste.length > 0 && runde[0] === liste[liste.length - 1]) {
      [runde[0], runde[runde.length - 1]] = [runde[runde.length - 1], runde[0]];
    }
    liste.push(...runde);
  }

  return liste.slice(0, anzahl);
}

/** Baut ein Raetsel nach der geforderten Schwere. */
export function erzeugen(art: RaetselArt, anforderung: Anforderung): Raetsel {
  switch (art) {
    case 'kabel':
      return kabel.erzeugen(anforderung);
    case 'symbole':
      return symbole.erzeugen(anforderung);
    case 'schacht':
      return schacht.erzeugen(anforderung);
    case 'zahlen':
      return zahlen.erzeugen(anforderung);
  }
}

/** Was der Bediener sieht -- und sonst niemand. */
export function pult(raetsel: Raetsel) {
  switch (raetsel.art) {
    case 'kabel':
      return kabel.pult(raetsel);
    case 'symbole':
      return symbole.pult(raetsel);
    case 'schacht':
      return schacht.pult(raetsel);
    case 'zahlen':
      return zahlen.pult(raetsel);
  }
}

/**
 * Die Unterlagen, fertig auf `haende` Personen verteilt.
 *
 * Die Reihenfolge ist die Reihenfolge der Leser: Wer an Stelle 2 steht,
 * bekommt das zweite Paeckchen -- und behaelt es die ganze Schleuse lang.
 */
export function unterlagen(raetsel: Raetsel, haende: number) {
  switch (raetsel.art) {
    case 'kabel':
      return kabel.unterlagen(raetsel, haende);
    case 'symbole':
      return symbole.unterlagen(raetsel, haende);
    case 'schacht':
      return schacht.unterlagen(raetsel, haende);
    case 'zahlen':
      return zahlen.unterlagen(raetsel, haende);
  }
}

/**
 * Nimmt eine Eingabe am Pult an.
 *
 * Veraendert das Raetsel dabei: Der Schacht merkt sich den neuen Standort, das
 * Symbolschloss die halbe Folge, und nach einem Fehlalarm wuerfeln Kasten und
 * Zahlenschloss neu.
 */
export function eingabe(raetsel: Raetsel, nutzlast: unknown): Zugergebnis {
  switch (raetsel.art) {
    case 'kabel':
      return kabel.eingabe(raetsel, nutzlast);
    case 'symbole':
      return symbole.eingabe(raetsel, nutzlast);
    case 'schacht':
      return schacht.eingabe(raetsel, nutzlast);
    case 'zahlen':
      return zahlen.eingabe(raetsel, nutzlast);
  }
}
