import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    CardModule,
    InputTextModule,
    MessageModule,
    PasswordModule,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    const { username, password } = this.form.getRawValue();

    try {
      await this.auth.login(username, password);

      // Nur interne Ziele zulassen. Eine absolute URL aus dem Query-Parameter
      // waere sonst eine offene Weiterleitung auf eine fremde Seite.
      const target = this.route.snapshot.queryParamMap.get('redirectTo');
      const safeTarget = target?.startsWith('/') && !target.startsWith('//') ? target : '/profile';

      await this.router.navigateByUrl(safeTarget);
    } catch (err) {
      this.error.set(this.messageFor(err));
      this.form.controls.password.reset();
    } finally {
      this.busy.set(false);
    }
  }

  private messageFor(err: unknown): string {
    if (!(err instanceof HttpErrorResponse)) {
      return 'Anmeldung fehlgeschlagen. Ist das Backend erreichbar?';
    }

    switch (err.status) {
      case 401:
        return 'Benutzername oder Passwort falsch.';
      case 429:
        return 'Zu viele Versuche. Bitte kurz warten.';
      case 0:
        return 'Backend nicht erreichbar.';
      default:
        return 'Anmeldung fehlgeschlagen.';
    }
  }
}
