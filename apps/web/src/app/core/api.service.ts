import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  AdminUser,
  CreateUserInput,
  HealthStatus,
  SessionUser,
  UpdateUserInput,
} from './models';

/**
 * Einzige Stelle, die API-Pfade kennt. Alle Pfade sind relativ:
 * im Dev leitet der Angular-Proxy /api an Fastify weiter,
 * in Produktion liegen Frontend und Backend hinter derselben Origin.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  health(): Observable<HealthStatus> {
    return this.http.get<HealthStatus>('/api/health');
  }

  session(): Observable<{ user: SessionUser | null }> {
    return this.http.get<{ user: SessionUser | null }>('/api/auth/session');
  }

  login(username: string, password: string): Observable<SessionUser> {
    return this.http.post<SessionUser>('/api/auth/login', { username, password });
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {});
  }

  /** Antwortet mit der Zahl der Geraete, die dabei abgemeldet wurden. */
  changePassword(
    currentPassword: string,
    newPassword: string,
  ): Observable<{ abgemeldeteGeraete: number }> {
    return this.http.post<{ abgemeldeteGeraete: number }>('/api/auth/change-password', {
      currentPassword,
      newPassword,
    });
  }

  listUsers(): Observable<AdminUser[]> {
    return this.http.get<AdminUser[]>('/api/admin/users');
  }

  createUser(input: CreateUserInput): Observable<AdminUser> {
    return this.http.post<AdminUser>('/api/admin/users', input);
  }

  updateUser(id: string, changes: UpdateUserInput): Observable<AdminUser> {
    return this.http.patch<AdminUser>(`/api/admin/users/${id}`, changes);
  }

  deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`/api/admin/users/${id}`);
  }
}
