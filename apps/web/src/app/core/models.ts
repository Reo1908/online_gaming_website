export type Role = 'ADMIN' | 'PLAYER';

/** Der eingeloggte Benutzer, wie ihn /api/auth/me liefert. */
export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

/** Ein Benutzer aus der Admin-Liste (enthaelt nie einen Passwort-Hash). */
export interface AdminUser extends SessionUser {
  isActive: boolean;
  /** Ob der Spieler in der Rangliste auftaucht. */
  isVisible: boolean;
  createdAt: string;
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  password: string;
  role: Role;
  isVisible: boolean;
}

export interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
}

/** Antwort von /api/admin/status -- nur fuer Administratoren. */
export interface SystemStatus {
  api: {
    status: 'online';
    laufzeitSekunden: number;
    umgebung: string;
    nodeVersion: string;
  };
  datenbank: {
    status: 'online' | 'offline';
    antwortzeitMs: number;
    benutzer: number | null;
    aktiveSitzungen: number | null;
  };
  zeitpunkt: string;
}

/**
 * Alle Felder optional -- gesendet wird nur, was der Administrator
 * tatsaechlich geaendert hat. Ein weggelassenes `password` bedeutet
 * ausdruecklich "Passwort unveraendert lassen".
 */
export interface UpdateUserInput {
  username?: string;
  displayName?: string;
  role?: Role;
  isActive?: boolean;
  isVisible?: boolean;
  password?: string;
}

/** Ein Platz in der Rangliste, wie ihn /api/leaderboard liefert. */
export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  /** Anteil von 0 bis 1. */
  winRate: number;
  updatedAt: string | null;
}

export type AuditAction =
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | 'USER_PASSWORD_RESET'
  | 'STAT_ADJUSTED';

/** Ein Protokolleintrag im Verlauf eines Kontos. */
export interface AuditEntry {
  id: string;
  action: AuditAction;
  /** Leer, wenn die Aenderung vom System kam. */
  actorUsername: string | null;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  createdAt: string;
}

export interface OverallStats {
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  updatedAt: string | null;
}

/** Antwort von /api/admin/users/:id/support. */
export interface SupportView {
  user: AdminUser;
  stats: OverallStats;
  history: AuditEntry[];
}

export interface StatAdjustment {
  matchesPlayed?: number;
  wins?: number;
  losses?: number;
  draws?: number;
  reason: string;
}

export type MatchStatus = 'LOBBY' | 'RUNNING' | 'FINISHED' | 'ABORTED';
export type MatchResult = 'WIN' | 'LOSS' | 'DRAW';

/** Eine waehlbare Spielart samt Vorgaben fuer das Einstellungsformular. */
export interface SpielArt {
  slug: string;
  name: string;
  description: string | null;
  minPlayers: number;
  maxPlayers: number;
  standardEinstellungen: Record<string, unknown>;
  /** Ob die Spielart Woerter aus den Themen zieht -- Scribble ja, Buzzer nein. */
  brauchtThemen: boolean;
}

/** Ein Themengebiet, wie es die Lobby zur Auswahl bekommt. */
export interface Thema {
  slug: string;
  name: string;
  farbe: string | null;
  /** Wie viele Woerter darin stehen. */
  woerter: number;
}

/** Dasselbe Thema in der Verwaltung -- dort steht die Wortliste selbst drin. */
export interface AdminThema {
  id: string;
  slug: string;
  name: string;
  farbe: string | null;
  isActive: boolean;
  createdAt: string;
  woerter: string[];
}

export interface ThemaEingabe {
  name?: string;
  color?: string | null;
  isActive?: boolean;
  woerter?: string[];
}

/** Ein Etikett an einer Partie. */
export interface Etikett {
  slug: string;
  name: string;
  farbe: string | null;
}

export interface Teilnehmer {
  userId: string;
  displayName: string;
  username: string;
  istLeitung: boolean;
  /** Ob der Eintrag gewertet wird; die Buzzer-Spielleitung etwa nicht. */
  spieltMit: boolean;
  punkte: number;
  ergebnis: MatchResult | null;
  platz: number | null;
}

/** Eine Partie, wie sie die REST-Schnittstelle liefert. */
export interface Partie {
  id: string;
  code: string;
  name: string;
  status: MatchStatus;
  settings: Record<string, unknown>;
  /** Oeffentliche Lobbys stehen fuer alle auf der Startseite. */
  oeffentlich: boolean;
  spiel: { slug: string; name: string; minPlayers: number; maxPlayers: number };
  etiketten: Etikett[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  teilnehmer: Teilnehmer[];
}

/**
 * Ein Teilnehmer im Live-Zustand.
 *
 * Die Felder ab `gebuzzertUm` steuert die jeweilige Spielart bei -- beim
 * Buzzer der Platz am Buzzer, bei Scribble, wer gerade zeichnet. Sie fehlen
 * deshalb, sobald das andere Spiel laeuft.
 */
export interface LiveTeilnehmer {
  userId: string;
  displayName: string;
  istLeitung: boolean;
  spieltMit: boolean;
  punkte: number;
  verbunden: boolean;

  /** Buzzer: Millisekunden seit Rundenstart. */
  gebuzzertUm?: number | null;
  /** Buzzer: Rang am Buzzer, 1 fuer den Ersten. */
  buzzerPlatz?: number | null;
  /** Buzzer: fehlt, wenn die Partie die Antworten nicht oeffentlich zeigt. */
  text?: string;

  /** Scribble: ob diese Person gerade zeichnet. */
  zeichnet?: boolean;
  /** Scribble: ob sie das Wort in diesem Zug schon hat. */
  hatGeraten?: boolean;
  /** Scribble: was sie im abgelaufenen Zug bekommen hat. */
  zugPunkte?: number | null;
}

/** Der Live-Zustand einer Partie, wie ihn die Socket-Verbindung schickt. */
export interface LiveZustand {
  code: string;
  name: string;
  status: MatchStatus;
  oeffentlich: boolean;
  spiel: { slug: string; name: string };
  einstellungen: Record<string, unknown>;
  etiketten: Etikett[];
  teilnehmer: LiveTeilnehmer[];
  /** Alles Spielabhaengige -- je nach Spielart anders geformt. */
  spielZustand: unknown;
}

export interface PartieAnlegen {
  gameSlug: string;
  name: string;
  oeffentlich: boolean;
  etiketten: string[];
  settings: Record<string, unknown>;
}

/** Was sich an einer wartenden Lobby noch aendern laesst. */
export interface PartieAendern {
  name?: string;
  oeffentlich?: boolean;
  etiketten?: string[];
}
