import { randomInt } from 'node:crypto';

/**
 * Der Zufall des Ausbruchs.
 *
 * Jede Schleuse wird frisch gewuerfelt -- darauf beruht der ganze Reiz des
 * Spiels. Deshalb steht das Mischen hier einmal fuer alle Raetsel und nicht
 * vier Mal nebeneinander.
 *
 * Gewuerfelt wird mit `randomInt` aus `node:crypto`, nicht mit `Math.random`:
 * nicht aus Sicherheitsgruenden, sondern weil es gleichverteilt ist, ohne dass
 * man sich um den Rest einer Division kuemmern muss.
 */

export function eins<T>(liste: readonly T[]): T {
  return liste[randomInt(liste.length)];
}

export function mischen<T>(liste: readonly T[]): T[] {
  const kopie = [...liste];
  for (let i = kopie.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [kopie[i], kopie[j]] = [kopie[j], kopie[i]];
  }
  return kopie;
}

/** Zieht `anzahl` verschiedene Eintraege. Weniger, wenn die Liste kuerzer ist. */
export function ziehen<T>(liste: readonly T[], anzahl: number): T[] {
  return mischen(liste).slice(0, anzahl);
}

/**
 * Teilt Karten reihum auf mehrere Haende auf.
 *
 * Reihum und nicht am Stueck: Bei den Kabelregeln zaehlt die Nummer, und wer
 * die Regeln 1 bis 3 in der Hand haelt, redet die halbe Schleuse allein.
 * So bekommt jeder etwas aus dem vorderen und dem hinteren Teil.
 */
export function austeilen<T>(karten: readonly T[], haende: number): T[][] {
  const stapel: T[][] = Array.from({ length: Math.max(1, haende) }, () => []);
  karten.forEach((karte, i) => stapel[i % stapel.length].push(karte));
  return stapel;
}

/** Zahlen als Wort -- „mindestens zwei rote Kabel" liest sich besser als „2". */
const ZAHLWORT = ['null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht'];

export function zahlwort(n: number): string {
  return ZAHLWORT[n] ?? String(n);
}
