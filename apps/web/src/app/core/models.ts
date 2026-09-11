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
