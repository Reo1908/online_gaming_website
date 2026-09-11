import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ApiService } from '../../core/api.service';
import type { Partie, SpielArt } from '../../core/models';

@Component({
  selector: 'app-home',
  imports: [ReactiveFormsModule, ButtonModule, DialogModule, InputTextModule, MessageModule],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly spielarten = signal<SpielArt[]>([]);
  protected readonly laufende = signal<Partie[]>([]);
  protected readonly fehler = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly anlegenOffen = signal(false);
  protected readonly beitretenOffen = signal(false);
  protected readonly dialogFehler = signal<string | null>(null);

  /** Die im Formular gewaehlte Spielart -- bestimmt, welche Einstellungen erscheinen. */
  protected readonly gewaehlteArt = computed(() =>
    this.spielarten().find((a) => a.slug === this.gewaehlterSlug()),
  );

  private readonly gewaehlterSlug = signal<string | null>(null);

  protected readonly anlegenForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    punkteProTreffer: [10, [Validators.required, Validators.min(1), Validators.max(100)]],
    nurEinmalBuzzern: [true],
    antwortenOeffentlich: [false],
  });

  protected readonly beitretenForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
  });

  constructor() {
    void this.laden();
  }

  private async laden(): Promise<void> {
    try {
      const [arten, partien] = await Promise.all([
        firstValueFrom(this.api.spielarten()),
        firstValueFrom(this.api.meinePartien()),
      ]);
      this.spielarten.set(arten);
      this.laufende.set(partien);
      this.gewaehlterSlug.set(arten[0]?.slug ?? null);
    } catch {
      this.fehler.set('Die Spiele konnten nicht geladen werden.');
    }
  }

  protected artWaehlen(slug: string): void {
    this.gewaehlterSlug.set(slug);
  }

  protected istGewaehlt(slug: string): boolean {
    return this.gewaehlterSlug() === slug;
  }

  protected anlegenOeffnen(): void {
    this.dialogFehler.set(null);
    this.anlegenForm.reset({
      name: '',
      punkteProTreffer: 10,
      nurEinmalBuzzern: true,
      antwortenOeffentlich: false,
    });
    this.anlegenOffen.set(true);
  }

  protected async anlegen(): Promise<void> {
    const slug = this.gewaehlterSlug();
    if (!slug || this.anlegenForm.invalid || this.busy()) {
      this.anlegenForm.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.dialogFehler.set(null);

    const { name, ...einstellungen } = this.anlegenForm.getRawValue();

    try {
      const partie = await firstValueFrom(
        this.api.partieAnlegen({ gameSlug: slug, name, settings: einstellungen }),
      );
      this.anlegenOffen.set(false);
      await this.router.navigate(['/partie', partie.code]);
    } catch (err) {
      this.dialogFehler.set(this.meldung(err, 'Die Lobby konnte nicht geöffnet werden.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async beitreten(): Promise<void> {
    if (this.beitretenForm.invalid || this.busy()) {
      this.beitretenForm.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.dialogFehler.set(null);

    const code = this.beitretenForm.getRawValue().code.trim().toUpperCase();

    try {
      const partie = await firstValueFrom(this.api.partieBeitreten(code));
      this.beitretenOffen.set(false);
      await this.router.navigate(['/partie', partie.code]);
    } catch (err) {
      this.dialogFehler.set(this.meldung(err, 'Der Beitritt hat nicht geklappt.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async oeffnen(partie: Partie): Promise<void> {
    await this.router.navigate(['/partie', partie.code]);
  }

  private meldung(err: unknown, ersatz: string): string {
    if (!(err instanceof HttpErrorResponse)) return ersatz;

    if (err.status === 404) return 'Diesen Code gibt es nicht.';
    if (err.status === 409 || err.status === 400) return err.error?.error ?? ersatz;
    return ersatz;
  }
}
