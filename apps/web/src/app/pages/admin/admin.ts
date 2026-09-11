import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { AdminUser, Role, UpdateUserInput } from '../../core/models';

/**
 * Vereinheitlicht Text fuer die Suche: Kleinschreibung, Umlaute ausgeschrieben,
 * uebrige Akzente entfernt. Damit findet "bjoern" auch "Björn" und umgekehrt --
 * ein reiner Kleinbuchstaben-Vergleich taete das nicht.
 */
function suchform(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    // Zerlegt Zeichen wie "é" in "e" + Akzent, danach faellt der Akzent weg.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Erzeugt ein Startpasswort aus dem Zufallsgenerator des Browsers.
 * Math.random() waere hier ungeeignet: es ist vorhersagbar und nicht fuer
 * Geheimnisse gedacht.
 *
 * Aus dem Zeichensatz sind 0/O/1/l/I bewusst verbannt -- das Passwort wird
 * oft vorgelesen oder abgetippt, und dabei sind genau die verwechselbar.
 */
function passwortErzeugen(laenge = 15): string {
  const zeichen = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const werte = crypto.getRandomValues(new Uint32Array(laenge));

  // Rest-Auswahl verzerrt die Verteilung minimal; bei dieser Laenge und
  // Zeichenzahl ist der Effekt ohne praktische Bedeutung.
  return Array.from(werte, (w) => zeichen[w % zeichen.length]).join('');
}

@Component({
  selector: 'app-admin',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    ButtonModule,
    DialogModule,
    InputTextModule,
    MessageModule,
    TableModule,
    TooltipModule,
  ],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class Admin {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly users = signal<AdminUser[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  /** Der gerade bearbeitete bzw. zu loeschende Benutzer; null = Dialog zu. */
  protected readonly editing = signal<AdminUser | null>(null);
  protected readonly deleting = signal<AdminUser | null>(null);
  protected readonly dialogError = signal<string | null>(null);

  protected readonly roles: Role[] = ['PLAYER', 'ADMIN'];

  protected readonly suche = signal('');

  /** Zuletzt erzeugtes Passwort, damit es zum Weitergeben sichtbar bleibt. */
  protected readonly erzeugtesPasswort = signal<string | null>(null);
  protected readonly passwortKopiert = signal(false);

  /**
   * Gefiltert wird im Browser, nicht auf dem Server: die Liste ist ohnehin
   * schon vollstaendig geladen, so reagiert die Suche ohne Verzoegerung.
   * Bei sehr vielen Benutzern waere eine Abfrage mit Suchbegriff besser.
   */
  protected readonly gefiltert = computed(() => {
    const begriff = suchform(this.suche().trim());
    if (!begriff) return this.users();

    return this.users().filter(
      (u) =>
        suchform(u.username).includes(begriff) ||
        suchform(u.displayName).includes(begriff) ||
        u.id.toLowerCase().includes(begriff),
    );
  });

  /** Anzahl der Admins, die das System handlungsfaehig halten. */
  private readonly aktiveAdmins = computed(
    () => this.users().filter((u) => u.role === 'ADMIN' && u.isActive).length,
  );

  protected readonly createForm = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(32)]],
    displayName: ['', [Validators.required, Validators.maxLength(64)]],
    password: ['', [Validators.required, Validators.minLength(12)]],
    role: ['PLAYER' as Role, Validators.required],
  });

  protected readonly editForm = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(32)]],
    displayName: ['', [Validators.required, Validators.maxLength(64)]],
    role: ['PLAYER' as Role, Validators.required],
    isActive: [true],
    // Leer lassen heisst "nicht aendern", darum hier kein `required`.
    password: ['', [Validators.minLength(12)]],
  });

  constructor() {
    void this.load();
  }

  protected istIchSelbst(user: AdminUser): boolean {
    return user.id === this.auth.user()?.id;
  }

  /**
   * Spiegelt die Server-Regeln, damit die Oberflaeche Aktionen gar nicht
   * erst anbietet, die das Backend ohnehin mit 409 ablehnen wuerde.
   */
  protected loeschenGesperrt(user: AdminUser): string | null {
    if (this.istIchSelbst(user)) return 'Du kannst dein eigenes Konto nicht löschen';
    if (user.role === 'ADMIN' && user.isActive && this.aktiveAdmins() <= 1) {
      return 'Der letzte aktive Administrator kann nicht gelöscht werden';
    }
    return null;
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.users.set(await firstValueFrom(this.api.listUsers()));
    } catch {
      this.error.set('Benutzerliste konnte nicht geladen werden.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async create(): Promise<void> {
    if (this.createForm.invalid || this.busy()) {
      this.createForm.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);

    try {
      const user = await firstValueFrom(this.api.createUser(this.createForm.getRawValue()));
      this.users.update((list) => [...list, user]);
      this.notice.set(`Benutzer „${user.username}“ wurde angelegt.`);
      this.createForm.reset({ role: 'PLAYER' });
      this.erzeugtesPasswort.set(null);
    } catch (err) {
      this.error.set(this.messageFor(err, 'Benutzer konnte nicht angelegt werden.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected neuesPasswort(): void {
    const passwort = passwortErzeugen();
    this.createForm.controls.password.setValue(passwort);
    this.createForm.controls.password.markAsTouched();
    this.erzeugtesPasswort.set(passwort);
    this.passwortKopiert.set(false);
  }

  protected async passwortKopieren(): Promise<void> {
    const passwort = this.erzeugtesPasswort();
    if (!passwort) return;

    try {
      await navigator.clipboard.writeText(passwort);
      this.passwortKopiert.set(true);
      setTimeout(() => this.passwortKopiert.set(false), 2000);
    } catch {
      // Zwischenablage kann gesperrt sein; das Passwort steht sichtbar da
      // und laesst sich von Hand markieren.
    }
  }

  protected openEdit(user: AdminUser): void {
    this.dialogError.set(null);
    this.editForm.reset({
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      isActive: user.isActive,
      password: '',
    });

    // Die eigene Rolle bzw. Aktivierung zu aendern wuerde den Zugang kosten.
    if (this.istIchSelbst(user)) {
      this.editForm.controls.role.disable();
      this.editForm.controls.isActive.disable();
    } else {
      this.editForm.controls.role.enable();
      this.editForm.controls.isActive.enable();
    }

    this.editing.set(user);
  }

  protected async saveEdit(): Promise<void> {
    const target = this.editing();
    if (!target || this.editForm.invalid || this.busy()) {
      this.editForm.markAllAsTouched();
      return;
    }

    // getRawValue() liefert auch deaktivierte Felder -- wichtig, damit
    // die eigene Rolle unveraendert erhalten bleibt statt wegzufallen.
    const values = this.editForm.getRawValue();
    const changes: UpdateUserInput = {};

    if (values.username !== target.username) changes.username = values.username;
    if (values.displayName !== target.displayName) changes.displayName = values.displayName;
    if (values.role !== target.role) changes.role = values.role;
    if (values.isActive !== target.isActive) changes.isActive = values.isActive;
    if (values.password) changes.password = values.password;

    if (Object.keys(changes).length === 0) {
      this.editing.set(null);
      return;
    }

    this.busy.set(true);
    this.dialogError.set(null);

    try {
      const updated = await firstValueFrom(this.api.updateUser(target.id, changes));
      this.users.update((list) => list.map((u) => (u.id === updated.id ? updated : u)));

      this.notice.set(
        changes.password
          ? `„${updated.username}“ gespeichert. Das neue Passwort gilt sofort, alte Sitzungen wurden beendet.`
          : `„${updated.username}“ wurde gespeichert.`,
      );
      this.editing.set(null);
    } catch (err) {
      this.dialogError.set(this.messageFor(err, 'Änderung konnte nicht gespeichert werden.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async confirmDelete(): Promise<void> {
    const target = this.deleting();
    if (!target || this.busy()) return;

    this.busy.set(true);
    this.dialogError.set(null);

    try {
      await firstValueFrom(this.api.deleteUser(target.id));
      this.users.update((list) => list.filter((u) => u.id !== target.id));
      this.notice.set(`Benutzer „${target.username}“ wurde gelöscht.`);
      this.deleting.set(null);
    } catch (err) {
      this.dialogError.set(this.messageFor(err, 'Benutzer konnte nicht gelöscht werden.'));
    } finally {
      this.busy.set(false);
    }
  }

  private messageFor(err: unknown, fallback: string): string {
    if (!(err instanceof HttpErrorResponse)) return fallback;

    // 409 und 400 tragen bereits eine verstaendliche Begruendung vom Server.
    if (err.status === 409) return err.error?.error ?? 'Konflikt.';
    if (err.status === 400) {
      const details = err.error?.details as Record<string, string[]> | undefined;
      return Object.values(details ?? {}).flat()[0] ?? err.error?.error ?? 'Ungültige Eingabe.';
    }
    if (err.status === 403) return 'Keine Berechtigung.';
    if (err.status === 404) return 'Benutzer existiert nicht mehr.';
    return fallback;
  }
}
