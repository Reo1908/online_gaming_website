/**
 * Der Notvorrat an Woertern.
 *
 * Normalerweise kommen die Woerter aus den Themengebieten, die ein
 * Administrator anlegt. Dieser Vorrat greift nur, wenn kein einziges Gebiet
 * ein Wort hergibt -- sonst stuende eine frisch aufgesetzte Anwendung beim
 * ersten Zug still, und niemand wuesste warum.
 *
 * Bewusst kurz und ganz allgemein: Er soll die Themengebiete nicht ersetzen,
 * sondern nur verhindern, dass gar nichts geht.
 */
export const NOTVORRAT = [
  'Haus',
  'Baum',
  'Auto',
  'Sonne',
  'Fahrrad',
  'Brille',
  'Katze',
  'Hund',
  'Pizza',
  'Regenschirm',
  'Leuchtturm',
  'Gitarre',
  'Schneemann',
  'Roboter',
  'Rakete',
  'Krone',
  'Banane',
  'Fernseher',
  'Zahnbuerste',
  'Drachen',
] as const;
