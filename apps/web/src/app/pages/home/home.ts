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
import { nutztThemen, spielDefinition, type EinstellungsFeld } from '../../games/registry';
import type { Partie, SpielArt, Thema } from '../../core/models';

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
  protected readonly themen = signal<Thema[]>([]);
  protected readonly laufende = signal<Partie[]>([]);
  protected readonly offene = signal<Partie[]>([]);
  protected readonly fehler = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly anlegenOffen = signal(false);
  protected readonly beitretenOffen = signal(false);
  protected readonly dialogFehler = signal<string | null>(null);

  private readonly gewaehlterSlug = signal<string | null>(null);
  protected readonly gewaehlteThemen = signal<string[]>([]);
  protected readonly oeffentlich = signal(false);
  protected readonly suche = signal('');

  /**
   * Ab wann die Auswahl ein Suchfeld bekommt.
   *
   * Bis zu einem halben Dutzend Kacheln findet man mit dem Auge schneller,
   * als man tippen kann -- ein Feld waere dann nur ein Kasten mehr im Dialog.
   */
  private static readonly SUCHE_AB = 6;

  /**
   * Die Einstellungen einer Spielart stehen nicht im Formular, sondern werden
   * daraus gebaut: Welche Felder es gibt, sagt die Spielbeschreibung, ihre
   * Standardwerte kommen mit `/api/games` vom Server. Eine neue Spielart
   * braucht in dieser Datei deshalb keine Zeile.
   */
  protected readonly einstellungswerte = signal<Record<string, unknown>>({});

  /** Die im Formular gewaehlte Spielart -- bestimmt, welche Einstellungen erscheinen. */
  protected readonly gewaehlteArt = computed(() =>
    this.spielarten().find((a) => a.slug === this.gewaehlterSlug()),
  );

  protected readonly felder = computed<EinstellungsFeld[]>(
    () => spielDefinition(this.gewaehlterSlug() ?? '')?.felder ?? [],
  );

  protected readonly sucheMoeglich = computed(() => this.spielarten().length > Home.SUCHE_AB);

  /**
   * Die Kacheln, die gerade dastehen.
   *
   * Gesucht wird in Name und Beschreibung: „zeichnen" soll Scribble finden,
   * auch wenn das Wort im Namen nicht vorkommt.
   */
  protected readonly gefilterteArten = computed<SpielArt[]>(() => {
    const suche = this.suche().trim().toLowerCase();
    if (!suche) return this.spielarten();

    return this.spielarten().filter((art) =>
      `${art.name} ${art.description ?? ''}`.toLowerCase().includes(suche),
    );
  });

  /** Themen gibt es nur bei Spielen, die Woerter daraus ziehen. */
  protected readonly themenMoeglich = computed(() => nutztThemen(this.gewaehlterSlug() ?? ''));

  protected readonly anlegenForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
  });

  protected readonly beitretenForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
  });

  constructor() {
    void this.laden();
  }

  private async laden(): Promise<void> {
    try {
      const [arten, partien, offen, themen] = await Promise.all([
        firstValueFrom(this.api.spielarten()),
        firstValueFrom(this.api.meinePartien()),
        firstValueFrom(this.api.offeneLobbys()),
        firstValueFrom(this.api.themen()),
      ]);

      this.spielarten.set(arten);
      this.laufende.set(partien);
      this.offene.set(offen);
      this.themen.set(themen);
      this.artWaehlen(arten[0]?.slug ?? '');
    } catch {
      this.fehler.set('Die Spiele konnten nicht geladen werden.');
    }
  }

  protected artWaehlen(slug: string): void {
    if (!slug) return;

    this.gewaehlterSlug.set(slug);

    // Beim Wechsel auf ein Spiel ohne Themen die Auswahl leeren: Sonst gingen
    // unsichtbar Etiketten mit, die der Server dann zurueckweist.
    if (!nutztThemen(slug)) this.gewaehlteThemen.set([]);

    // Die Standardwerte gelten je Spielart: Beim Wechsel muss der Satz
    // komplett getauscht werden, sonst bliebe ein Feld des anderen Spiels stehen.
    this.einstellungswerte.set({
      ...(this.spielarten().find((a) => a.slug === slug)?.standardEinstellungen ?? {}),
    });
  }

  protected istGewaehlt(slug: string): boolean {
    return this.gewaehlterSlug() === slug;
  }

  /**
   * Zeichen und Art einer Kachel.
   *
   * Beide kommen aus der Spielbeschreibung im Browser, nicht aus `/api/games`:
   * Der Server weiss, wie ein Spiel heisst und wie viele mitspielen -- wie es
   * aussieht, geht ihn nichts an. Kennt die Oberflaeche eine Spielart noch
   * nicht, bleibt ein neutrales Zeichen stehen, statt dass die Kachel fehlt.
   */
  protected zeichen(slug: string): string {
    return spielDefinition(slug)?.icon ?? 'th-large';
  }

  protected zusammen(slug: string): boolean {
    return spielDefinition(slug)?.art === 'zusammen';
  }

  protected wert(key: string): unknown {
    return this.einstellungswerte()[key];
  }

  protected wertSetzen(feld: EinstellungsFeld, roh: unknown): void {
    const wert =
      feld.typ === 'schalter' ? roh === true : feld.typ === 'auswahl' ? String(roh) : Number(roh);

    this.einstellungswerte.update((alt) => ({ ...alt, [feld.key]: wert }));
  }

  /** Die Erklaerung unter einer Knopfreihe -- die der gewaehlten Moeglichkeit. */
  protected optionsHilfe(feld: EinstellungsFeld): string | undefined {
    return feld.optionen?.find((o) => o.wert === this.wert(feld.key))?.hilfe;
  }

  protected themaUmschalten(slug: string): void {
    this.gewaehlteThemen.update((alt) =>
      alt.includes(slug) ? alt.filter((s) => s !== slug) : [...alt, slug],
    );
  }

  protected themaGewaehlt(slug: string): boolean {
    return this.gewaehlteThemen().includes(slug);
  }

  protected anlegenOeffnen(): void {
    this.dialogFehler.set(null);
    this.anlegenForm.reset({ name: '' });
    this.gewaehlteThemen.set([]);
    this.oeffentlich.set(false);
    this.suche.set('');
    this.artWaehlen(this.gewaehlterSlug() ?? this.spielarten()[0]?.slug ?? '');
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

    try {
      const partie = await firstValueFrom(
        this.api.partieAnlegen({
          gameSlug: slug,
          name: this.anlegenForm.getRawValue().name,
          oeffentlich: this.oeffentlich(),
          etiketten: this.gewaehlteThemen(),
          settings: this.einstellungswerte(),
        }),
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

  /**
   * Eine offene Lobby wird ueber ihre Seite betreten, nicht direkt.
   *
   * So sieht man vor dem Beitritt, wer schon da ist und worum es geht --
   * genau dafuer ist die Liste da.
   */
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
