import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { LeaderboardEntry } from '../../core/models';

@Component({
  selector: 'app-leaderboard',
  imports: [DecimalPipe, ButtonModule, TableModule],
  templateUrl: './leaderboard.html',
  styleUrl: './leaderboard.scss',
})
export class Leaderboard {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly eintraege = signal<LeaderboardEntry[]>([]);
  protected readonly laedt = signal(true);
  protected readonly fehler = signal<string | null>(null);

  /**
   * Solange niemand gespielt hat, steht die Tabelle voller Nullen. Dann ist
   * ein Hinweis ehrlicher als eine Rangliste, die es noch nicht gibt.
   */
  protected readonly nochNichtsGespielt = computed(() =>
    this.eintraege().every((e) => e.matchesPlayed === 0),
  );

  constructor() {
    void this.laden();
  }

  protected async laden(): Promise<void> {
    this.laedt.set(true);
    this.fehler.set(null);
    try {
      this.eintraege.set(await firstValueFrom(this.api.leaderboard()));
    } catch {
      this.fehler.set('Rangliste konnte nicht geladen werden.');
    } finally {
      this.laedt.set(false);
    }
  }

  protected binIch(eintrag: LeaderboardEntry): boolean {
    return eintrag.userId === this.auth.user()?.id;
  }
}
