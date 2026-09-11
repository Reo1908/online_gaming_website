import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import type { SessionUser } from './models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);

  private readonly currentUser = signal<SessionUser | null>(null);

  readonly user = this.currentUser.asReadonly();
  readonly isLoggedIn = computed(() => this.currentUser() !== null);
  /**
   * Steuert nur, was die Oberflaeche anzeigt. Ob jemand wirklich Admin ist,
   * entscheidet allein der Server bei jedem Request.
   */
  readonly isAdmin = computed(() => this.currentUser()?.role === 'ADMIN');

  /** Laeuft einmal beim App-Start, damit ein Reload die Session nicht verliert. */
  async restoreSession(): Promise<void> {
    try {
      const { user } = await firstValueFrom(this.api.session());
      this.currentUser.set(user);
    } catch {
      // Backend nicht erreichbar: als "nicht eingeloggt" behandeln,
      // damit die App startet statt haengen zu bleiben.
      this.currentUser.set(null);
    }
  }

  async login(username: string, password: string): Promise<SessionUser> {
    const user = await firstValueFrom(this.api.login(username, password));
    this.currentUser.set(user);
    return user;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.api.logout());
    } finally {
      // Auch wenn der Server-Aufruf scheitert, lokal ausloggen.
      this.currentUser.set(null);
    }
  }
}
