import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  AdminThema,
  AdminUser,
  CreateUserInput,
  Partie,
  PartieAendern,
  PartieAnlegen,
  SpielArt,
  Thema,
  ThemaEingabe,
  OverallStats,
  StatAdjustment,
  SupportView,
  HealthStatus,
  LeaderboardEntry,
  SessionUser,
  SystemStatus,
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

  leaderboard(): Observable<LeaderboardEntry[]> {
    return this.http.get<LeaderboardEntry[]>('/api/leaderboard');
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

  spielarten(): Observable<SpielArt[]> {
    return this.http.get<SpielArt[]>('/api/games');
  }

  /** Die Themengebiete, aus denen eine Lobby waehlen kann. */
  themen(): Observable<Thema[]> {
    return this.http.get<Thema[]>('/api/tags');
  }

  /** Partien, in denen der angemeldete Benutzer gerade steckt. */
  meinePartien(): Observable<Partie[]> {
    return this.http.get<Partie[]>('/api/matches');
  }

  /** Offene, oeffentliche Lobbys fuer die Startseite. */
  offeneLobbys(): Observable<Partie[]> {
    return this.http.get<Partie[]>('/api/matches/oeffentlich');
  }

  partieAnlegen(eingabe: PartieAnlegen): Observable<Partie> {
    return this.http.post<Partie>('/api/matches', eingabe);
  }

  partie(code: string): Observable<Partie> {
    return this.http.get<Partie>(`/api/matches/${code}`);
  }

  /** Name, Sichtbarkeit und Themen einer wartenden Lobby. */
  partieAendern(code: string, aenderung: PartieAendern): Observable<Partie> {
    return this.http.patch<Partie>(`/api/matches/${code}`, aenderung);
  }

  partieBeitreten(code: string): Observable<Partie> {
    return this.http.post<Partie>(`/api/matches/${code}/join`, {});
  }

  partieVerlassen(code: string): Observable<void> {
    return this.http.post<void>(`/api/matches/${code}/leave`, {});
  }

  partieStarten(code: string): Observable<Partie> {
    return this.http.post<Partie>(`/api/matches/${code}/start`, {});
  }

  /** `gewertet` sagt, ob die Partie in die Bilanzen eingegangen ist. */
  partieBeenden(code: string): Observable<Partie & { gewertet: boolean }> {
    return this.http.post<Partie & { gewertet: boolean }>(`/api/matches/${code}/finish`, {});
  }

  partieAbbrechen(code: string): Observable<Partie> {
    return this.http.post<Partie>(`/api/matches/${code}/abort`, {});
  }

  adminThemen(): Observable<AdminThema[]> {
    return this.http.get<AdminThema[]>('/api/admin/tags');
  }

  themaAnlegen(eingabe: ThemaEingabe): Observable<AdminThema> {
    return this.http.post<AdminThema>('/api/admin/tags', eingabe);
  }

  themaAendern(id: string, eingabe: ThemaEingabe): Observable<AdminThema> {
    return this.http.patch<AdminThema>(`/api/admin/tags/${id}`, eingabe);
  }

  themaLoeschen(id: string): Observable<void> {
    return this.http.delete<void>(`/api/admin/tags/${id}`);
  }

  systemStatus(): Observable<SystemStatus> {
    return this.http.get<SystemStatus>('/api/admin/status');
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

  /** Konto, Bilanz und Aenderungsverlauf in einem Aufruf. */
  supportView(id: string): Observable<SupportView> {
    return this.http.get<SupportView>(`/api/admin/users/${id}/support`);
  }

  adjustStats(
    id: string,
    adjustment: StatAdjustment,
  ): Observable<{ stats: OverallStats; geaenderteFelder: string[] }> {
    return this.http.patch<{ stats: OverallStats; geaenderteFelder: string[] }>(
      `/api/admin/users/${id}/stats`,
      adjustment,
    );
  }
}
