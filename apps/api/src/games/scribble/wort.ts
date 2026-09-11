/**
 * Wortvergleich und Maske fuer Scribble.
 *
 * Geraten wird in einen Chat getippt, nicht in ein Formular -- also muss der
 * Vergleich nachsichtig sein: Gross- und Kleinschreibung, Umlaute,
 * Bindestriche und doppelte Leerzeichen duerfen nicht ueber einen Punkt
 * entscheiden. "Pikachu", "pikachu " und "PIKACHU" sind dasselbe Wort.
 */
export function vergleichsform(wort: string): string {
  return wort
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Alles, was kein Buchstabe oder keine Ziffer ist, faellt weg: damit
    // stolpert niemand ueber einen fehlenden Bindestrich in "Mr. Mime".
    .replace(/[^a-z0-9]/g, '');
}

export function istRichtig(geraten: string, gesucht: string): boolean {
  const a = vergleichsform(geraten);
  return a.length > 0 && a === vergleichsform(gesucht);
}

/**
 * Die Luecken, die alle ausser dem Zeichner sehen.
 *
 * Laenge und Wortgrenzen bleiben erkennbar, Bindestriche und Punkte stehen
 * offen da -- sie verraten nichts und helfen beim Abzaehlen.
 */
export function maske(wort: string, aufgedeckt: number[] = []): string {
  const offen = new Set(aufgedeckt);

  return [...wort]
    .map((zeichen, i) => {
      if (zeichen === ' ') return ' ';
      if (!/[\p{L}\p{N}]/u.test(zeichen)) return zeichen;
      return offen.has(i) ? zeichen : '_';
    })
    .join('');
}

/**
 * Waehlt Stellen aus, die als Hilfe aufgedeckt werden.
 *
 * Ueber die Zeit faellt das Raten sonst auseinander: Wer es nach dreissig
 * Sekunden nicht hat, hat es auch nach sechzig nicht. Aufgedeckt wird nie
 * mehr als die Haelfte -- sonst steht das Wort irgendwann einfach da.
 */
export function hinweisStellen(wort: string, anteil: number): number[] {
  const stellen = [...wort]
    .map((zeichen, i) => (/[\p{L}\p{N}]/u.test(zeichen) ? i : -1))
    .filter((i) => i !== -1);

  const anzahl = Math.floor(stellen.length * Math.min(0.5, Math.max(0, anteil)));
  if (anzahl <= 0) return [];

  // Immer dieselbe Reihenfolge je Wort statt Zufall: die Hilfe soll mit der
  // Zeit wachsen, nicht bei jedem Schritt andere Buchstaben zeigen.
  const gemischt = [...stellen].sort(
    (a, b) => streuwert(wort, a) - streuwert(wort, b),
  );

  return gemischt.slice(0, anzahl);
}

/** Kleine, stabile Streuung -- kein Zufall, damit die Hilfe nicht springt. */
function streuwert(wort: string, stelle: number): number {
  let wert = stelle * 2654435761;
  for (const zeichen of wort) wert = (wert ^ zeichen.charCodeAt(0)) * 16777619;
  return (wert >>> 0) % 100000;
}
