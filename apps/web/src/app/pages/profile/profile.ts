import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';
import { TagModule } from 'primeng/tag';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

/** Prueft, ob Neueingabe und Wiederholung uebereinstimmen. */
function passwoerterGleich(group: AbstractControl): ValidationErrors | null {
  const neu = group.get('newPassword')?.value;
  const wiederholung = group.get('confirmPassword')?.value;
  return neu && wiederholung && neu !== wiederholung ? { stimmenNichtUeberein: true } : null;
}

@Component({
  selector: 'app-profile',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    AvatarModule,
    ButtonModule,
    CardModule,
    DialogModule,
    InputTextModule,
    MessageModule,
    PasswordModule,
    TagModule,
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);

  protected readonly dialogOffen = signal(false);
  protected readonly busy = signal(false);
  protected readonly dialogFehler = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly idKopiert = signal(false);

  /** Bis zu zwei Anfangsbuchstaben fuer den Avatar, z. B. "Max Mustermann" -> "MM". */
  protected readonly initialen = computed(() => {
    const name = this.auth.user()?.displayName ?? '';
    return (
      name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((teil) => teil[0]?.toUpperCase() ?? '')
        .join('') || '?'
    );
  });

  protected readonly form = this.fb.nonNullable.group(
    {
      currentPassword: ['', Validators.required],
      // Spiegelt die Server-Regel; verbindlich bleibt die Pruefung im Backend.
      newPassword: ['', [Validators.required, Validators.minLength(12)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwoerterGleich },
  );

  protected dialogOeffnen(): void {
    this.form.reset();
    this.dialogFehler.set(null);
    this.notice.set(null);
    this.dialogOffen.set(true);
  }

  protected async kopiereId(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      this.idKopiert.set(true);
      setTimeout(() => this.idKopiert.set(false), 2000);
    } catch {
      // Zwischenablage kann gesperrt sein (fehlende Berechtigung, kein
      // sicherer Kontext). Kein Grund, die Seite mit einem Fehler zu behelligen.
    }
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.dialogFehler.set(null);

    const { currentPassword, newPassword } = this.form.getRawValue();

    try {
      const { abgemeldeteGeraete } = await firstValueFrom(
        this.api.changePassword(currentPassword, newPassword),
      );

      this.notice.set(
        abgemeldeteGeraete > 0
          ? `Passwort geändert. ${abgemeldeteGeraete} weitere ${
              abgemeldeteGeraete === 1 ? 'Anmeldung wurde' : 'Anmeldungen wurden'
            } beendet.`
          : 'Passwort geändert.',
      );
      this.dialogOffen.set(false);
      this.form.reset();
    } catch (err) {
      // Fehler bleibt im Dialog stehen, damit die Eingaben nicht verloren gehen.
      this.dialogFehler.set(this.messageFor(err));
    } finally {
      this.busy.set(false);
    }
  }

  private messageFor(err: unknown): string {
    if (!(err instanceof HttpErrorResponse)) return 'Unbekannter Fehler.';

    switch (err.status) {
      case 401:
        // Die eigene Sitzung gilt noch -- also ging es um das eingegebene
        // Passwort, nicht um eine abgelaufene Anmeldung.
        return 'Das aktuelle Passwort ist falsch.';
      case 400: {
        const details = err.error?.details as Record<string, string[]> | undefined;
        return Object.values(details ?? {}).flat()[0] ?? err.error?.error ?? 'Ungültige Eingabe.';
      }
      case 429:
        return 'Zu viele Versuche. Bitte später erneut probieren.';
      default:
        return 'Passwort konnte nicht geändert werden.';
    }
  }
}
