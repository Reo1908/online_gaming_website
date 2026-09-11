import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TextareaModule } from 'primeng/textarea';
import { ApiService } from '../../core/api.service';
import type { AdminThema } from '../../core/models';

/**
 * Eine kleine Palette statt eines Farbwaehlers.
 *
 * Die Farbe soll Themen in der Lobbyliste auseinanderhalten, nicht gestaltet
 * werden. Aus einer festen Auswahl kommt niemand auf Blassgelb auf Weiss.
 */
const PALETTE = [
  '#f0b429',
  '#e8743b',
  '#d31f3c',
  '#9b5de5',
  '#4f8ef7',
  '#2ec4b6',
  '#4caf7d',
  '#6b7a90',
];

/**
 * Wörter stehen als Text im Formular, einer je Zeile.
 *
 * Eine Liste mit Plus- und Minusknöpfen wäre bei dreißig Einträgen
 * unbenutzbar: So lässt sich der ganze Vorrat auf einmal einfügen, sortieren
 * und wieder herausnehmen -- mit den Werkzeugen, die der Browser schon hat.
 */
function alsZeilen(woerter: string[]): string {
  return woerter.join('\n');
}

function ausZeilen(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((zeile) => zeile.trim())
    .filter((zeile) => zeile.length > 0);
}

@Component({
  selector: 'app-admin-themen',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    MessageModule,
    TextareaModule,
  ],
  templateUrl: './admin-themen.html',
  styleUrl: './admin-themen.scss',
})
export class AdminThemen {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);

  protected readonly palette = PALETTE;

  protected readonly themen = signal<AdminThema[]>([]);
  protected readonly laedt = signal(true);
  protected readonly busy = signal(false);
  protected readonly fehler = signal<string | null>(null);
  protected readonly hinweis = signal<string | null>(null);

  /** Das gerade bearbeitete Thema; null heisst "neu anlegen", undefined "Dialog zu". */
  protected readonly bearbeitet = signal<AdminThema | null | undefined>(undefined);
  protected readonly loeschen = signal<AdminThema | null>(null);
  protected readonly dialogFehler = signal<string | null>(null);

  protected readonly farbe = signal<string | null>(PALETTE[0]);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(48)]],
    woerter: [''],
  });

  protected readonly wortAnzahl = computed(() => ausZeilen(this.form.getRawValue().woerter).length);

  /** Der Titel des Dialogs haengt daran, ob schon ein Thema geladen ist. */
  protected readonly istNeu = computed(() => this.bearbeitet() === null);

  constructor() {
    void this.laden();
  }

  private async laden(): Promise<void> {
    this.laedt.set(true);
    try {
      this.themen.set(await firstValueFrom(this.api.adminThemen()));
    } catch {
      this.fehler.set('Die Themen konnten nicht geladen werden.');
    } finally {
      this.laedt.set(false);
    }
  }

  protected neu(): void {
    this.dialogFehler.set(null);
    this.form.reset({ name: '', woerter: '' });
    this.farbe.set(PALETTE[0]);
    this.bearbeitet.set(null);
  }

  protected bearbeiten(thema: AdminThema): void {
    this.dialogFehler.set(null);
    this.form.reset({ name: thema.name, woerter: alsZeilen(thema.woerter) });
    this.farbe.set(thema.farbe);
    this.bearbeitet.set(thema);
  }

  protected async speichern(): Promise<void> {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }

    const ziel = this.bearbeitet();
    if (ziel === undefined) return;

    this.busy.set(true);
    this.dialogFehler.set(null);

    const eingabe = {
      name: this.form.getRawValue().name,
      color: this.farbe(),
      woerter: ausZeilen(this.form.getRawValue().woerter),
    };

    try {
      if (ziel === null) {
        const angelegt = await firstValueFrom(this.api.themaAnlegen(eingabe));
        this.themen.update((alt) => [...alt, angelegt].sort((a, b) => a.name.localeCompare(b.name)));
        this.hinweis.set(`Thema „${angelegt.name}" angelegt.`);
      } else {
        const geaendert = await firstValueFrom(this.api.themaAendern(ziel.id, eingabe));
        this.themen.update((alt) =>
          alt
            .map((t) => (t.id === geaendert.id ? geaendert : t))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        this.hinweis.set(`Thema „${geaendert.name}" gespeichert.`);
      }

      this.bearbeitet.set(undefined);
    } catch (err) {
      this.dialogFehler.set(this.meldung(err, 'Das Thema konnte nicht gespeichert werden.'));
    } finally {
      this.busy.set(false);
    }
  }

  /** Ein abgeschaltetes Thema verschwindet aus der Lobby, bleibt aber bestehen. */
  protected async umschalten(thema: AdminThema): Promise<void> {
    this.fehler.set(null);

    try {
      const geaendert = await firstValueFrom(
        this.api.themaAendern(thema.id, { isActive: !thema.isActive }),
      );
      this.themen.update((alt) => alt.map((t) => (t.id === geaendert.id ? geaendert : t)));
    } catch (err) {
      this.fehler.set(this.meldung(err, 'Die Änderung hat nicht geklappt.'));
    }
  }

  protected async loeschenBestaetigen(): Promise<void> {
    const ziel = this.loeschen();
    if (!ziel || this.busy()) return;

    this.busy.set(true);
    this.dialogFehler.set(null);

    try {
      await firstValueFrom(this.api.themaLoeschen(ziel.id));
      this.themen.update((alt) => alt.filter((t) => t.id !== ziel.id));
      this.hinweis.set(`Thema „${ziel.name}" gelöscht.`);
      this.loeschen.set(null);
    } catch (err) {
      this.dialogFehler.set(this.meldung(err, 'Das Thema konnte nicht gelöscht werden.'));
    } finally {
      this.busy.set(false);
    }
  }

  private meldung(err: unknown, ersatz: string): string {
    if (!(err instanceof HttpErrorResponse)) return ersatz;
    if (err.status === 409 || err.status === 400) return err.error?.error ?? ersatz;
    if (err.status === 404) return 'Dieses Thema gibt es nicht mehr.';
    return ersatz;
  }
}
