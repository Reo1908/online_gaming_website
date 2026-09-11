import { Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { ApiService } from '../../core/api.service';
import type { AdminUser, SupportView } from '../../core/models';

/** Beschriftungen fuer die Zaehler, in der Reihenfolge der Anzeige. */
const ZAEHLER = [
  { key: 'matchesPlayed', label: 'Partien' },
  { key: 'wins', label: 'Siege' },
  { key: 'losses', label: 'Niederlagen' },
  { key: 'draws', label: 'Unentschieden' },
] as const;

@Component({
  selector: 'app-admin-tools',
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    MessageModule,
    SelectModule,
    TagModule,
    TextareaModule,
  ],
  templateUrl: './admin-tools.html',
  styleUrl: './admin-tools.scss',
})
export class AdminTools {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);

  /** Wird von der Benutzerverwaltung gereicht, damit die Liste nur einmal laedt. */
  readonly users = input.required<AdminUser[]>();

  protected readonly zaehler = ZAEHLER;

  protected readonly gewaehlt = signal<string | null>(null);
  protected readonly ansicht = signal<SupportView | null>(null);
  protected readonly laedt = signal(false);
  protected readonly busy = signal(false);
  protected readonly fehler = signal<string | null>(null);
  protected readonly hinweis = signal<string | null>(null);

  /** Nur der Verlauf einer einzelnen Zahl, wenn danach gefiltert wird. */
  protected readonly feldFilter = signal<string | null>(null);

  protected readonly auswahl = computed(() =>
    this.users().map((u) => ({
      label: `${u.displayName} (${u.username})`,
      value: u.id,
    })),
  );

  protected readonly verlauf = computed(() => {
    const eintraege = this.ansicht()?.history ?? [];
    const filter = this.feldFilter();
    return filter ? eintraege.filter((e) => e.field === filter) : eintraege;
  });

  protected readonly form = this.fb.nonNullable.group({
    matchesPlayed: [0, [Validators.required, Validators.min(0)]],
    wins: [0, [Validators.required, Validators.min(0)]],
    losses: [0, [Validators.required, Validators.min(0)]],
    draws: [0, [Validators.required, Validators.min(0)]],
    reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]],
  });

  protected async auswaehlen(userId: string | null): Promise<void> {
    this.gewaehlt.set(userId);
    this.ansicht.set(null);
    this.fehler.set(null);
    this.hinweis.set(null);
    this.feldFilter.set(null);

    if (!userId) return;
    await this.laden(userId);
  }

  protected async laden(userId: string): Promise<void> {
    this.laedt.set(true);
    try {
      const ansicht = await firstValueFrom(this.api.supportView(userId));
      this.ansicht.set(ansicht);
      this.form.reset({
        matchesPlayed: ansicht.stats.matchesPlayed,
        wins: ansicht.stats.wins,
        losses: ansicht.stats.losses,
        draws: ansicht.stats.draws,
        reason: '',
      });
    } catch {
      this.fehler.set('Daten konnten nicht geladen werden.');
    } finally {
      this.laedt.set(false);
    }
  }

  protected async speichern(): Promise<void> {
    const userId = this.gewaehlt();
    if (!userId || this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.fehler.set(null);
    this.hinweis.set(null);

    const { reason, ...werte } = this.form.getRawValue();

    try {
      const { geaenderteFelder } = await firstValueFrom(
        this.api.adjustStats(userId, { ...werte, reason }),
      );

      this.hinweis.set(
        geaenderteFelder.length === 0
          ? 'Keine Änderung — die Werte waren bereits so.'
          : `${geaenderteFelder.length} ${geaenderteFelder.length === 1 ? 'Wert' : 'Werte'} geändert und protokolliert.`,
      );

      // Neu laden, damit Bilanz und Verlauf den frischen Stand zeigen.
      await this.laden(userId);
    } catch (err) {
      this.fehler.set(this.meldungZu(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Macht aus STAT_ADJUSTED lesbares Deutsch. */
  protected aktionText(action: string): string {
    switch (action) {
      case 'USER_CREATED':
        return 'Konto angelegt';
      case 'USER_UPDATED':
        return 'Konto geändert';
      case 'USER_DELETED':
        return 'Konto gelöscht';
      case 'USER_PASSWORD_RESET':
        return 'Passwort zurückgesetzt';
      case 'STAT_ADJUSTED':
        return 'Bilanz korrigiert';
      default:
        return action;
    }
  }

  protected feldText(feld: string | null): string {
    return ZAEHLER.find((z) => z.key === feld)?.label ?? feld ?? '';
  }

  private meldungZu(err: unknown): string {
    if (!(err instanceof HttpErrorResponse)) return 'Unbekannter Fehler.';

    if (err.status === 400) {
      const details = err.error?.details as Record<string, string[]> | undefined;
      return Object.values(details ?? {}).flat()[0] ?? err.error?.error ?? 'Ungültige Eingabe.';
    }
    if (err.status === 404) return 'Benutzer existiert nicht mehr.';
    if (err.status === 403) return 'Keine Berechtigung.';
    return 'Änderung konnte nicht gespeichert werden.';
  }
}
