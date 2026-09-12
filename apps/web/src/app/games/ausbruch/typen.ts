/**
 * Der Ausbruch, wie ihn der Browser sieht.
 *
 * Dieselben Formen wie in `apps/api/src/games/ausbruch/` -- nur die Haelfte,
 * die fuer den jeweiligen Zuschauer bestimmt ist, kommt ueberhaupt an:
 * `pult` steht nur beim Bediener, `unterlage` nur bei ihrem Leser. Das andere
 * ist nicht ausgeblendet, es ist gar nicht da.
 */

export type Phase = 'EINWEISUNG' | 'SCHLEUSE' | 'GESCHAFFT' | 'ENDE';

export type RaetselArt = 'kabel' | 'symbole' | 'schacht' | 'zahlen';

export type Kabelfarbe = 'rot' | 'blau' | 'gruen' | 'gelb' | 'weiss' | 'schwarz';

export interface Feld {
  x: number;
  y: number;
}

export interface Funkspruch {
  id: string;
  userId: string | null;
  name: string;
  text: string;
  art: 'funk' | 'system' | 'alarm';
}

// ---------- Das Pult: was nur der Bediener sieht ----------------------------

export interface KabelPult {
  art: 'kabel';
  /** Nur im schweren Modus: die zweite Angabe am Kasten, etwa „K-7". */
  modul: string | null;
  kabel: Array<{ nr: number; farbe: Kabelfarbe; markiert: boolean }>;
}

export interface SymbolePult {
  art: 'symbole';
  tasten: string[];
  gedrueckt: string[];
  gesamt: number;
}

export interface SchachtPult {
  art: 'schacht';
  groesse: number;
  pos: Feld;
  /** Im schweren Modus leer: Die Luke sehen dann nur die Unterlagen. */
  ziel: Feld | null;
  /** Felder als „x,y" -- wo der Melder schon war. */
  besucht: string[];
  /** Sensoren, die schon angesprochen haben. Die sind kein Geheimnis mehr. */
  ausgeloest: string[];
}

export interface ZahlenPult {
  art: 'zahlen';
  seriennummer: string;
  lampen: boolean[];
  /** Wie viele Stellen der Code hat. */
  stellen: number;
}

export type Pult = KabelPult | SymbolePult | SchachtPult | ZahlenPult;

// ---------- Die Unterlagen: was nur die Leser sehen -------------------------

export interface KabelUnterlage {
  art: 'kabel';
  /** Wie viele Regeln es insgesamt gibt -- der Rest liegt bei den anderen. */
  gesamt: number;
  /** Ob am Pult eine Modulnummer steht, nach der zu fragen sich lohnt. */
  modul: boolean;
  regeln: Array<{ nr: number; text: string }>;
}

export interface SymboleUnterlage {
  art: 'symbole';
  gesamt: number;
  spalten: Array<{ nr: number; symbole: string[] }>;
}

export interface SchachtUnterlage {
  art: 'schacht';
  groesse: number;
  vonZeile: number;
  bisZeile: number;
  /** Nur die Zeilen des eigenen Abschnitts. */
  rechts: boolean[][];
  unten: boolean[][];
  pos: Feld;
  ziel: Feld;
  /** Sensorfelder im eigenen Abschnitt -- davor muss gewarnt werden. */
  sensoren: string[];
  ausgeloest: string[];
  abschnitt: number;
  abschnitte: number;
}

export interface ZahlenUnterlage {
  art: 'zahlen';
  gesamt: number;
  stellen: Array<{
    nr: number;
    text: string;
    /** Zeigt die Stelle auf andere Stellen? Dann erst fragen, dann rechnen. */
    verkettet: boolean;
  }>;
}

export type Unterlage = KabelUnterlage | SymboleUnterlage | SchachtUnterlage | ZahlenUnterlage;

// ---------- Der Zustand ------------------------------------------------------

export interface AusbruchZustand {
  phase: Phase;
  /** Die Uhr des Servers im selben Paket -- die des Browsers geht anders. */
  serverZeit: number;
  /** Die schwere Stufe: andere Raetsel, nicht nur mehr davon. */
  schwer: boolean;

  schleuse: number;
  schleusen: number;
  geloest: number;
  erfolg: boolean | null;

  titel: string;
  auftrag: string;
  raetselArt: RaetselArt | null;
  bedienerId: string | null;

  fehlalarme: number;
  fehlalarmeGesamt: number;
  /** Sekunden, die ein Fehlalarm vom Zeitkonto nimmt. */
  strafe: number;

  /** Das Zeitkonto laeuft nur waehrend einer Schleuse. */
  uhrLaeuft: boolean;
  ablaufUm: number | null;
  restMs: number;
  /** Was zu Beginn auf dem Konto lag -- der Massstab fuer den Balken. */
  kontoMs: number;

  /** Ende der Zwischenphase (Einweisung, Pause, Abspann). */
  phaseEndetUm: number | null;
  phaseDauerMs: number;

  pult: Pult | null;
  unterlage: Unterlage | null;
  unterlageNr: number | null;
  unterlagen: number;

  funk: Funkspruch[];
}
