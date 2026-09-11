import type { SpielKontext } from './typen.js';

/**
 * Der Weg vom Spielmodul zurueck an die Sockets, ausserhalb eines Ereignisses.
 *
 * Spiele mit Uhr -- Scribble etwa -- muessen von sich aus etwas schicken: Der
 * Zug ist um, obwohl gerade niemand etwas gedrueckt hat. In einem Ereignis
 * kommt der Kontext mit, bei einem Zeitgeber nicht.
 *
 * Diese Datei ist absichtlich leer an Abhaengigkeiten: Wuerde ein Spielmodul
 * `realtime.ts` direkt einbinden, das seinerseits die Spiele kennt, stuenden
 * die beiden im Kreis. So setzt die Socket-Schicht beim Start einmal die
 * Fabrik, und die Module holen sich daraus ihren Kontext.
 */
type Fabrik = (code: string) => SpielKontext;

let fabrik: Fabrik | null = null;

export function brueckeSetzen(neue: Fabrik): void {
  fabrik = neue;
}

/**
 * Kontext fuer eine Partie ohne ausloesenden Socket -- also fuer alles, was
 * das Spiel selbst anstoesst. `userId` ist dabei leer.
 */
export function kontextFuer(code: string): SpielKontext | null {
  return fabrik ? fabrik(code) : null;
}
