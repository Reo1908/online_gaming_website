import { randomInt } from 'node:crypto';
import { mischen } from './zufall.js';
import type { Anforderung, Zugergebnis } from './raetsel.js';

/**
 * Wartungsschacht -- blind durch ein Labyrinth, Schritt fuer Schritt.
 *
 * Hier wird nicht gerechnet, hier wird geredet: Der Bediener sieht seinen
 * Punkt, sonst nichts. Die Waende stehen in den Unterlagen -- und zwar in
 * Streifen aufgeteilt. Wer den oberen Abschnitt hat, lotst die ersten Schritte
 * und muss danach abgeben.
 *
 * Anders als die anderen drei Raetsel laeuft dieses in vielen kleinen
 * Schritten statt in einer Loesung. Deshalb kostet hier jeder Anstoss gegen
 * eine Wand Zeit: Ohne das waere Ausprobieren schneller als Fragen.
 *
 * Im schweren Modus fehlt dem Bediener zusaetzlich die **Luke** -- er laeuft
 * auf ein Ziel zu, das nur die anderen sehen -- und in den Sackgassen liegen
 * **Sensoren**. Sie liegen nie auf dem richtigen Weg: Wer fragt, kommt an
 * ihnen vorbei; wer losgeht, tritt hinein.
 */

export interface SchachtRaetsel {
  art: 'schacht';
  groesse: number;
  /** rechts[y][x]: Wand zwischen (x,y) und (x+1,y). */
  rechts: boolean[][];
  /** unten[y][x]: Wand zwischen (x,y) und (x,y+1). */
  unten: boolean[][];
  pos: { x: number; y: number };
  ziel: { x: number; y: number };
  /** Ob die Luke nur in den Unterlagen steht. */
  zielVerborgen: boolean;
  /** Felder als „x,y", die Alarm schlagen. Nie auf dem Weg zur Luke. */
  sensoren: string[];
  /** Welche davon schon angesprochen haben -- die sieht dann auch das Pult. */
  ausgeloest: string[];
  /** Wo der Punkt schon war -- sonst verliert der Bediener die Orientierung. */
  besucht: string[];
  /** In wie viele Streifen die Karte zerlegt ist. */
  baender: number;
}

type Feld = { x: number; y: number };

function feldSchluessel(feld: Feld): string {
  return `${feld.x},${feld.y}`;
}

function raster(groesse: number, wert: boolean): boolean[][] {
  return Array.from({ length: groesse }, () => Array.from({ length: groesse }, () => wert));
}

/**
 * Baut ein Labyrinth ohne Rundwege (Tiefensuche mit Ruecksprung).
 *
 * Ohne Rundwege gibt es zwischen zwei Feldern genau einen Weg. Das ist beim
 * Lotsen entscheidend: Zwei Leute, die verschiedene Abschnitte sehen, koennen
 * sich sonst auf zwei Wege einigen, von denen nur einer durchgeht. Und es ist
 * die Grundlage der Sensoren -- „nicht auf dem Weg" ist nur dann eindeutig.
 */
function labyrinthBauen(groesse: number): { rechts: boolean[][]; unten: boolean[][] } {
  const rechts = raster(groesse, true);
  const unten = raster(groesse, true);
  const besucht = raster(groesse, false);

  const start: Feld = { x: randomInt(groesse), y: randomInt(groesse) };
  const stapel: Feld[] = [start];
  besucht[start.y][start.x] = true;

  while (stapel.length > 0) {
    const hier = stapel[stapel.length - 1];

    const offen = mischen([
      { x: hier.x + 1, y: hier.y },
      { x: hier.x - 1, y: hier.y },
      { x: hier.x, y: hier.y + 1 },
      { x: hier.x, y: hier.y - 1 },
    ]).filter(
      (f) => f.x >= 0 && f.y >= 0 && f.x < groesse && f.y < groesse && !besucht[f.y][f.x],
    );

    const naechstes = offen[0];
    if (!naechstes) {
      stapel.pop();
      continue;
    }

    if (naechstes.x > hier.x) rechts[hier.y][hier.x] = false;
    if (naechstes.x < hier.x) rechts[naechstes.y][naechstes.x] = false;
    if (naechstes.y > hier.y) unten[hier.y][hier.x] = false;
    if (naechstes.y < hier.y) unten[naechstes.y][naechstes.x] = false;

    besucht[naechstes.y][naechstes.x] = true;
    stapel.push(naechstes);
  }

  return { rechts, unten };
}

type Karte = Pick<SchachtRaetsel, 'groesse' | 'rechts' | 'unten'>;

function nachbarn(karte: Karte, feld: Feld): Feld[] {
  const { groesse, rechts, unten } = karte;
  const liste: Feld[] = [];

  if (feld.x + 1 < groesse && !rechts[feld.y][feld.x]) liste.push({ x: feld.x + 1, y: feld.y });
  if (feld.x > 0 && !rechts[feld.y][feld.x - 1]) liste.push({ x: feld.x - 1, y: feld.y });
  if (feld.y + 1 < groesse && !unten[feld.y][feld.x]) liste.push({ x: feld.x, y: feld.y + 1 });
  if (feld.y > 0 && !unten[feld.y - 1][feld.x]) liste.push({ x: feld.x, y: feld.y - 1 });

  return liste;
}

/** Der einzige Weg von A nach B, Feld fuer Feld. Leer, wenn es keinen gibt. */
function weg(karte: Karte, von: Feld, nach: Feld): string[] {
  const her = new Map<string, string | null>([[feldSchluessel(von), null]]);
  const schlange: Feld[] = [von];

  while (schlange.length > 0) {
    const hier = schlange.shift()!;
    if (hier.x === nach.x && hier.y === nach.y) break;

    for (const feld of nachbarn(karte, hier)) {
      const schluessel = feldSchluessel(feld);
      if (her.has(schluessel)) continue;
      her.set(schluessel, feldSchluessel(hier));
      schlange.push(feld);
    }
  }

  const strecke: string[] = [];
  let stelle: string | null = feldSchluessel(nach);
  if (!her.has(stelle)) return [];

  while (stelle) {
    strecke.unshift(stelle);
    stelle = her.get(stelle) ?? null;
  }

  return strecke;
}

export function erzeugen({ nr, schwer, leser }: Anforderung): SchachtRaetsel {
  const groesse = schwer ? Math.min(8, 6 + Math.floor(nr / 2)) : Math.min(7, 5 + Math.floor(nr / 2));

  // Ein paar Anlaeufe fuer eine Strecke, die durch die ganze Karte fuehrt:
  // Ein kurzer Weg liefe in einem Abschnitt ab, und der Rest saehe zu.
  let karte: Karte = { groesse, ...labyrinthBauen(groesse) };
  let start: Feld = { x: randomInt(groesse), y: 0 };
  let ziel: Feld = { x: randomInt(groesse), y: groesse - 1 };
  let strecke = weg(karte, start, ziel);

  for (let versuch = 0; versuch < 12 && strecke.length < groesse + 3; versuch++) {
    karte = { groesse, ...labyrinthBauen(groesse) };
    start = { x: randomInt(groesse), y: 0 };
    ziel = { x: randomInt(groesse), y: groesse - 1 };
    strecke = weg(karte, start, ziel);
  }

  // Sensoren nur abseits der Strecke. Sonst waeren sie nicht zu umgehen, und
  // aus einer Warnung wuerde eine Gebuehr.
  const abseits = mischen(
    Array.from({ length: groesse * groesse }, (_, i) => `${i % groesse},${Math.floor(i / groesse)}`)
      .filter((feld) => !strecke.includes(feld)),
  );

  return {
    art: 'schacht',
    groesse,
    rechts: karte.rechts,
    unten: karte.unten,
    pos: start,
    ziel,
    zielVerborgen: schwer,
    sensoren: schwer ? abseits.slice(0, Math.round(groesse * 0.8)) : [],
    ausgeloest: [],
    besucht: [feldSchluessel(start)],
    // Mehr Streifen als Zeilen gaebe leere Unterlagen. Bei vielen Mitspielenden
    // teilen sich dann zwei denselben Abschnitt -- doppelt gesehen ist besser
    // als gar nicht gesehen.
    baender: Math.min(Math.max(1, leser), groesse),
  };
}

export function pult(raetsel: SchachtRaetsel) {
  return {
    art: 'schacht' as const,
    groesse: raetsel.groesse,
    pos: raetsel.pos,
    // Im schweren Modus laeuft der Bediener auf ein Ziel zu, das nur die
    // anderen sehen. Es fehlt hier, statt nur ausgeblendet zu sein.
    ziel: raetsel.zielVerborgen ? null : raetsel.ziel,
    besucht: raetsel.besucht,
    // Ein Sensor, der schon angesprochen hat, ist kein Geheimnis mehr.
    ausgeloest: raetsel.ausgeloest,
  };
}

export function unterlagen(raetsel: SchachtRaetsel, haende: number) {
  const { groesse, baender } = raetsel;

  return Array.from({ length: haende }, (_, hand) => {
    const band = hand % baender;
    const von = Math.floor((band * groesse) / baender);
    const bis = Math.floor(((band + 1) * groesse) / baender) - 1;

    return {
      art: 'schacht' as const,
      groesse,
      vonZeile: von,
      bisZeile: bis,
      // Nur die Zeilen des eigenen Abschnitts gehen raus. Die anderen liegen
      // damit nicht einmal im Browser -- ausblenden waere hier kein Schutz.
      rechts: raetsel.rechts.slice(von, bis + 1),
      unten: raetsel.unten.slice(von, bis + 1),
      pos: raetsel.pos,
      ziel: raetsel.ziel,
      // Auch die Sensoren nur im eigenen Streifen: Wer warnt, muss dafuer
      // zustaendig sein.
      sensoren: raetsel.sensoren.filter((feld) => {
        const y = Number(feld.split(',')[1]);
        return y >= von && y <= bis;
      }),
      ausgeloest: raetsel.ausgeloest,
      abschnitt: band + 1,
      abschnitte: baender,
    };
  });
}

const RICHTUNGEN = {
  hoch: { x: 0, y: -1 },
  runter: { x: 0, y: 1 },
  links: { x: -1, y: 0 },
  rechts: { x: 1, y: 0 },
} as const;

type Richtung = keyof typeof RICHTUNGEN;

export function eingabe(raetsel: SchachtRaetsel, nutzlast: unknown): Zugergebnis {
  const richtung = (nutzlast as { richtung?: unknown } | null)?.richtung as Richtung | undefined;
  if (!richtung || !(richtung in RICHTUNGEN)) return { status: 'weiter' };

  const schritt = RICHTUNGEN[richtung];
  const ziel = { x: raetsel.pos.x + schritt.x, y: raetsel.pos.y + schritt.y };

  const frei = nachbarn(raetsel, raetsel.pos).some((f) => f.x === ziel.x && f.y === ziel.y);
  if (!frei) {
    return { status: 'fehlalarm', meldung: 'Gegen eine Wand gelaufen — die Sensoren schlagen an.' };
  }

  raetsel.pos = ziel;
  const schluessel = feldSchluessel(ziel);
  if (!raetsel.besucht.includes(schluessel)) raetsel.besucht.push(schluessel);

  if (ziel.x === raetsel.ziel.x && ziel.y === raetsel.ziel.y) return { status: 'geloest' };

  // Der Schritt gilt trotzdem: Der Melder steht jetzt eben auf einem Feld, das
  // gerade Alarm geschlagen hat. Ihn zurueckzusetzen waere eine zweite Strafe
  // fuer denselben Fehler.
  if (raetsel.sensoren.includes(schluessel) && !raetsel.ausgeloest.includes(schluessel)) {
    raetsel.ausgeloest.push(schluessel);
    return {
      status: 'fehlalarm',
      meldung: `Sensorfeld getroffen — jemand hätte das kommen sehen können.`,
    };
  }

  return { status: 'weiter' };
}
