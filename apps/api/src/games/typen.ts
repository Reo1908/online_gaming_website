import type { ZodType } from 'zod';

/**
 * Was jede Spielart mitbringt.
 *
 * Ein Spiel besteht aus drei Teilen: seinen Einstellungen (ein Zod-Schema,
 * aus dem zugleich die Standardwerte fuer das Formular kommen), dem Stueck
 * Live-Zustand, das es zum Bild beisteuert, und den Ereignissen, die es vom
 * Browser annimmt. Alles andere -- Lobby, Beitritt, Punkte, Wertung -- ist
 * fuer alle Spiele gleich und steht ausserhalb dieses Ordners.
 */
export interface SpielModul {
  slug: string;
  name: string;
  description: string;
  /** Mitspielende, ohne eine nicht mitspielende Leitung. Nur zur Anzeige. */
  minPlayers: number;
  maxPlayers: number;

  /**
   * Wie viele Mitspielende es zum Start mindestens braucht.
   *
   * Getrennt von `minPlayers`, weil beides auseinanderfaellt: Beim Buzzer
   * darf die Leitung zum Ausprobieren auch mit einer Person starten (gewertet
   * wird die Partie dann nicht), bei Scribble waere eine Runde ohne jemanden
   * zum Raten sinnlos.
   */
  minZumStart: number;

  /**
   * Ob die Spielleitung selbst mitspielt.
   *
   * Beim Buzzer stellt sie nur Fragen und taucht in keiner Wertung auf, bei
   * Scribble zeichnet sie mit. Daraus wird beim Anlegen `MatchPlayer.isPlaying`
   * gesetzt -- und daran haengt, wer am Ende gewertet wird.
   */
  leitungSpieltMit: boolean;

  /** Braucht das Spiel Woerter aus den Themengebieten? */
  brauchtWoerter: boolean;

  einstellungen: ZodType;

  /**
   * Der Teil des Live-Zustands, den dieses Spiel beisteuert.
   *
   * Wird je Zuschauer gerufen: Beim Scribble sieht der Zeichner das Wort,
   * alle anderen nur die Luecken. Der Aufruf ist bewusst synchron und ohne
   * Datenbank -- der Zustand geht bei jeder Aenderung an jeden Socket einzeln.
   */
  sicht(partie: PartieInfo, fuer: Zuschauer): unknown;

  /**
   * Zusaetzliche Felder je Teilnehmer, in den gemeinsamen Eintrag gemischt.
   * Damit bleibt die Teilnehmerliste eine Liste -- und nicht zwei, die der
   * Browser wieder zusammenfuehren muesste.
   */
  spielerSicht?(partie: PartieInfo, teilnehmerId: string, fuer: Zuschauer): Record<string, unknown>;

  /** Ereignisse aus dem Browser, nach Namen. */
  ereignisse: Record<string, SpielEreignis>;

  /** Wird gerufen, sobald die Partie von der Lobby in den Lauf wechselt. */
  gestartet?(ctx: SpielKontext): Promise<void>;

  /**
   * Wird gerufen, wenn jemand die Partie betritt oder die Seite neu laedt.
   * Fuer alles, was zu gross fuer den regulaeren Zustand ist -- beim Scribble
   * etwa die bisherige Zeichnung.
   */
  betreten?(ctx: SpielKontext): void | Promise<void>;

  /** Raeumt den Live-Zustand einer Partie weg. */
  verwerfen(code: string): void;
}

export type SpielEreignis = (ctx: SpielKontext, nutzlast: unknown) => void | Promise<void>;

/** Wer gerade zuschaut -- entscheidet, was von der Sicht sichtbar ist. */
export interface Zuschauer {
  userId: string;
  istLeitung: boolean;
}

export interface PartieTeilnehmer {
  userId: string;
  displayName: string;
  istLeitung: boolean;
  /** Ob der Eintrag gewertet wird; die Buzzer-Leitung etwa nicht. */
  spieltMit: boolean;
  punkte: number;
  verbunden: boolean;
}

export interface PartieEtikett {
  slug: string;
  name: string;
  farbe: string | null;
}

/** Die Partie, wie ein Spielmodul sie sieht: aus der Datenbank, ohne Live-Teil. */
export interface PartieInfo {
  id: string;
  code: string;
  name: string;
  status: string;
  oeffentlich: boolean;
  spiel: { slug: string; name: string };
  einstellungen: Record<string, unknown>;
  etiketten: PartieEtikett[];
  teilnehmer: PartieTeilnehmer[];
  /** Nur die, die gewertet werden. */
  spieler: PartieTeilnehmer[];
}

/**
 * Der Draht nach draussen, den ein Spielmodul in einem Ereignis bekommt.
 *
 * Alles, was die Datenbank braucht, ist hier asynchron -- alles andere nicht.
 * Das ist kein Zufall: Ein Pinselstrich beim Scribble laeuft dutzende Male je
 * Sekunde durch `anAndere` und darf dabei die Datenbank nicht anfassen.
 */
export interface SpielKontext {
  code: string;
  /** Wer das Ereignis ausgeloest hat. */
  userId: string;
  istLeitung: boolean;

  /** An alle in der Partie, den Absender eingeschlossen. */
  anAlle(ereignis: string, daten: unknown): void;
  /** An alle ausser den Absender. */
  anAndere(ereignis: string, daten: unknown): void;
  /** An einen einzelnen Teilnehmer, ueber alle seine offenen Tabs. */
  an(userId: string, ereignis: string, daten: unknown): void;
  /** Nur an die Spielleitung. */
  anLeitung(ereignis: string, daten: unknown): void;

  /** Schickt den ganzen Zustand neu -- jedem seine Sicht. */
  senden(): Promise<void>;

  /** Laedt die Partie frisch aus der Datenbank. */
  partie(): Promise<PartieInfo | null>;

  /** Woerter aus den gewaehlten Themengebieten, gemischt. */
  woerter(): Promise<string[]>;

  /** Schreibt Punkte gut. Sie landen sofort in der Datenbank. */
  punkteGeben(userId: string, punkte: number): Promise<boolean>;

  /**
   * Beendet die Partie regulaer und schreibt die Wertung fest.
   * Fuer Spiele, die von selbst ans Ende kommen.
   */
  beenden(): Promise<void>;
}
