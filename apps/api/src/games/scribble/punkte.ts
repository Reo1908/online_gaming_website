/**
 * Das Punktesystem von Scribble.
 *
 * Angelehnt an scribble.io, aber bewusst schlichter: Dort haengt die Punktzahl
 * an der Restzeit auf die Sekunde genau, was sich niemand im Kopf nachrechnet.
 * Hier zaehlt allein die Reihenfolge -- das kann jeder am Tisch mitzaehlen,
 * und es belohnt dasselbe: schnell erkennen.
 */

/** Was der Letzte, der es noch errät, von der Basis bekommt. */
const MINDESTANTEIL = 0.4;
/** Was der Zeichner je errautem Wort bekommt -- gedeckelt bei der Basis. */
const ZEICHNER_ANTEIL = 0.25;

/**
 * Punkte fuer den, der richtig geraten hat.
 *
 * Der Erste bekommt die volle Basis, der Letzte 40 %, alle dazwischen
 * gleichmaessig gestaffelt. Die Stufe haengt also an der Rundengroesse und
 * nicht an einer festen Zahl.
 *
 * Der Grund: Bei einem festen Abzug je Platz -- etwa 20 Punkte -- stiesse eine
 * grosse Runde nach vier Leuten auf den Mindestanteil, und ab da bekaeme jeder
 * dasselbe. Genau dort ist die Reihenfolge aber noch spannend.
 *
 * `platz` ist nullbasiert: 0 fuer den Ersten. `ratende` ist, wie viele
 * ueberhaupt raten konnten -- der Zeichner zaehlt nicht mit.
 */
export function ratePunkte(basis: number, platz: number, ratende: number): number {
  // Bei nur einem Ratenden gibt es nichts zu staffeln.
  if (ratende <= 1) return Math.max(1, Math.round(basis));

  const stufe = (1 - MINDESTANTEIL) / (ratende - 1);
  const anteil = Math.max(MINDESTANTEIL, 1 - platz * stufe);

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
