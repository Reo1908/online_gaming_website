/**
 * Der Farbeimer.
 *
 * Bewusst von Hand statt als Abhaengigkeit: Der Scanline-Algorithmus unten ist
 * seit den Achtzigern derselbe, passt in achtzig Zeilen und braucht kein
 * Paket, das mitgepflegt und mitgeladen werden will. Die fertigen Pakete
 * koennen ausserdem alle dasselbe -- nur ohne die Toleranz, auf die es hier
 * ankommt.
 *
 * Die Toleranz ist der Grund, warum eine naive Fassung haesslich aussieht:
 * Der Browser zeichnet Linien mit weichen Kanten, also steht zwischen Schwarz
 * und Weiss ein Saum aus Grautoenen. Ohne Toleranz laeuft die Farbe genau bis
 * an diesen Saum und laesst einen hellen Rand stehen.
 */

/** Wie weit ein Farbwert je Kanal abweichen darf und noch als gleich gilt. */
const TOLERANZ = 48;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexZuRgb(hex: string): Rgb {
  const wert = parseInt(hex.slice(1), 16);
  return { r: (wert >> 16) & 255, g: (wert >> 8) & 255, b: wert & 255 };
}

/**
 * Faerbt die zusammenhaengende Flaeche um (x, y) ein.
 *
 * `x` und `y` sind Pixel auf der Leinwand, nicht die normierten Koordinaten
 * aus dem Netz -- die rechnet der Aufrufer um, weil nur er die Groesse kennt.
 */
export function fuellen(
  ctx: CanvasRenderingContext2D,
  breite: number,
  hoehe: number,
  x: number,
  y: number,
  hexFarbe: string,
): void {
  const startX = Math.round(x);
  const startY = Math.round(y);
  if (startX < 0 || startY < 0 || startX >= breite || startY >= hoehe) return;

  const bild = ctx.getImageData(0, 0, breite, hoehe);
  const daten = bild.data;

  const beginn = (startY * breite + startX) * 4;
  const alt = { r: daten[beginn], g: daten[beginn + 1], b: daten[beginn + 2] };
  const neu = hexZuRgb(hexFarbe);

  // Dieselbe Farbe noch einmal auszugiessen liefe endlos: Die gefuellten
  // Pixel sind danach nicht von den offenen zu unterscheiden.
  if (
    Math.abs(alt.r - neu.r) <= 1 &&
    Math.abs(alt.g - neu.g) <= 1 &&
    Math.abs(alt.b - neu.b) <= 1
  ) {
    return;
  }

  const passt = (stelle: number): boolean =>
    Math.abs(daten[stelle] - alt.r) <= TOLERANZ &&
    Math.abs(daten[stelle + 1] - alt.g) <= TOLERANZ &&
    Math.abs(daten[stelle + 2] - alt.b) <= TOLERANZ;

  // Eigener Stapel statt Rekursion: Eine grosse Flaeche haette sonst
  // zehntausende Aufrufe tief verschachtelt und den Aufrufstapel gesprengt.
  const stapel: number[] = [startX, startY];
  const erledigt = new Uint8Array(breite * hoehe);

  while (stapel.length > 0) {
    const py = stapel.pop()!;
    const px = stapel.pop()!;

    let links = px;
    let rechts = px;

    // Von der Startstelle aus so weit nach links und rechts, wie die Farbe
    // passt -- eine ganze Zeile auf einmal statt Pixel fuer Pixel.
    while (links > 0 && passt(((py * breite + links - 1) * 4))) links--;
    while (rechts < breite - 1 && passt((py * breite + rechts + 1) * 4)) rechts++;

    for (let sx = links; sx <= rechts; sx++) {
      const index = py * breite + sx;
      if (erledigt[index]) continue;
      erledigt[index] = 1;

      const stelle = index * 4;
      daten[stelle] = neu.r;
      daten[stelle + 1] = neu.g;
      daten[stelle + 2] = neu.b;
      daten[stelle + 3] = 255;

      // Die Zeilen darueber und darunter nur dort weiterverfolgen, wo die
      // Farbe passt und noch nichts gesetzt wurde.
      for (const ny of [py - 1, py + 1]) {
        if (ny < 0 || ny >= hoehe) continue;
        const nachbar = ny * breite + sx;
        if (!erledigt[nachbar] && passt(nachbar * 4)) stapel.push(sx, ny);
      }
    }
  }

  ctx.putImageData(bild, 0, 0);
}
