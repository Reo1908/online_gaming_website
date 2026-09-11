/**
 * Das Punktesystem von Scribble.
 *
 * Angelehnt an scribble.io, aber bewusst schlichter: Dort haengt die Punktzahl
 * an der Restzeit auf die Sekunde genau, was sich niemand im Kopf nachrechnet.
 * Hier zaehlt allein die Reihenfolge -- das kann jeder am Tisch mitzaehlen,
 * und es belohnt dasselbe: schnell erkennen.
 */

/** Wie viel jeder weitere Platz von der Basis abzieht. */
const ABZUG_JE_PLATZ = 0.2;
/** Auch der Letzte bekommt noch so viel von der Basis. */
const MINDESTANTEIL = 0.4;
/** Was der Zeichner je errautem Wort bekommt -- gedeckelt bei der Basis. */
const ZEICHNER_ANTEIL = 0.25;

/**
 * Punkte fuer den, der richtig geraten hat.
 * `platz` ist nullbasiert: 0 fuer den Ersten.
 */
export function ratePunkte(basis: number, platz: number): number {
  const anteil = Math.max(MINDESTANTEIL, 1 - platz * ABZUG_JE_PLATZ);
  return Math.max(1, Math.round(basis * anteil));
}

/**
 * Punkte fuer den Zeichner am Ende seines Zuges.
 *
 * Steigt mit jedem, der das Wort erkennt, und ist bei der Basis gedeckelt:
 * Sonst lohnte es sich, in einer grossen Runde ein besonders leichtes Wort zu
 * nehmen -- und niemand zeichnete mehr das schwere.
 */
export function zeichnerPunkte(basis: number, richtige: number): number {
  if (richtige === 0) return 0;
  return Math.min(basis, Math.round(basis * ZEICHNER_ANTEIL * richtige));
}
