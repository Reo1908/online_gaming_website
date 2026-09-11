import { Component, inject, signal } from '@angular/core';
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
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
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
  imports: [RouterLink, ReactiveFormsModule, ButtonModule, InputTextModule, MessageModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group(
    {
      currentPassword: ['', Validators.required],
      // Spiegelt die Server-Regel; verbindlich bleibt die Pruefung im Backend.
      newPassword: ['', [Validators.required, Validators.minLength(12)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwoerterGleich },
  );

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);

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
      this.form.reset();
    } catch (err) {
      this.error.set(this.messageFor(err));
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
