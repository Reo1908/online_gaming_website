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
  createdAt: string;
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  password: string;
  role: Role;
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
