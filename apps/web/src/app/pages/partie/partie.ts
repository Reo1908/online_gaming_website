import { Component, computed, effect, inject, input, signal, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { RealtimeService } from '../../core/realtime.service';
import type { LiveTeilnehmer, MatchStatus, Partie as PartieModel } from '../../core/models';

/** Standardwerte, falls eine Partie noch aus einer aelteren Fassung stammt. */
const PUNKTE_STANDARD = 10;

@Component({
  selector: 'app-partie',
  imports: [ButtonModule, MessageModule],
  templateUrl: './partie.html',
  styleUrl: './partie.scss',
  host: {
    // Leertaste buzzert -- beim Buzzer-Spiel zaehlen Zehntelsekunden, und der
    // Weg zur Maus kostet mehr als das. Im Textfeld bleibt sie ein Leerzeichen.
    '(document:keydown)': 'taste($event)',
  },
})
export class Partie implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly realtime = inject(RealtimeService);
  private readonly router = inject(Router);

  /** Kommt aus der Route (`/partie/:code`). */
  readonly code = input.required<string>();

  protected readonly partie = signal<PartieModel | null>(null);
  protected readonly laedt = signal(true);
  protected readonly busy = signal(false);
  protected readonly fehler = signal<string | null>(null);
  protected readonly hinweis = signal<string | null>(null);
  protected readonly codeKopiert = signal(false);
  protected readonly eigenerText = signal('');

  protected readonly zustand = this.realtime.zustand;
  protected readonly verbunden = this.realtime.verbunden;

  constructor() {
    // Der Code steht erst nach der Bindung der Route fest.
    effect(() => {
      const code = this.code();
      void this.laden(code);
    });
  }

  ngOnDestroy(): void {
    this.realtime.verlassen();
  }

  // ----- Abgeleitete Sicht -------------------------------------------------

  protected readonly status = computed<MatchStatus>(
    () => this.zustand()?.status ?? this.partie()?.status ?? 'LOBBY',
  );

  /**
   * Der Live-Zustand ist massgeblich, sobald er da ist. Bis dahin kommen die
   * Teilnehmer aus dem REST-Aufruf -- sonst bliebe die Karte beim Laden leer.
   */
  protected readonly teilnehmer = computed<LiveTeilnehmer[]>(() => {
    const live = this.zustand();
    if (live) return live.teilnehmer;

    return (this.partie()?.teilnehmer ?? []).map((t) => ({
      userId: t.userId,
      displayName: t.displayName,
      istLeitung: t.istLeitung,
      punkte: t.punkte,
      verbunden: false,
      gebuzzertUm: null,
      buzzerPlatz: null,
    }));
  });

  protected readonly ich = computed(() =>
    this.teilnehmer().find((t) => t.userId === this.auth.user()?.id),
  );

  protected readonly binLeitung = computed(() => this.ich()?.istLeitung === true);
  protected readonly binDabei = computed(() => this.ich() !== undefined);

  protected readonly spieler = computed(() => this.teilnehmer().filter((t) => !t.istLeitung));
  protected readonly leitung = computed(() => this.teilnehmer().find((t) => t.istLeitung));

  /** Wer gebuzzert hat, in der Reihenfolge des Drueckens. */
  protected readonly amBuzzer = computed(() =>
    this.spieler()
      .filter((t) => t.buzzerPlatz !== null)
      .sort((a, b) => (a.buzzerPlatz ?? 0) - (b.buzzerPlatz ?? 0)),
  );

  protected readonly rangliste = computed(() =>
    [...this.spieler()].sort((a, b) => b.punkte - a.punkte),
  );

  /**
   * Der Endstand kommt aus der Datenbank, nicht aus dem Live-Zustand: dort
   * steht die festgeschriebene Platzierung, und der Live-Teil ist nach dem
   * Ende der Partie ohnehin weggeraeumt.
   */
  protected readonly endstand = computed(() =>
    (this.partie()?.teilnehmer ?? [])
      .filter((t) => !t.istLeitung)
      .sort((a, b) => (a.platz ?? 99) - (b.platz ?? 99) || b.punkte - a.punkte),
  );

  protected readonly runde = computed(
    () => this.zustand()?.runde ?? { nummer: 0, laeuft: false, gestartetUm: null },
  );

  protected readonly einstellungen = computed(() => {
    const roh = this.zustand()?.einstellungen ?? this.partie()?.settings ?? {};
    return {
      punkteProTreffer: Number(roh['punkteProTreffer'] ?? PUNKTE_STANDARD),
      nurEinmalBuzzern: roh['nurEinmalBuzzern'] !== false,
      antwortenOeffentlich: roh['antwortenOeffentlich'] === true,
    };
  });

  protected readonly darfBuzzern = computed(() => {
    if (this.binLeitung() || this.status() !== 'RUNNING') return false;
    if (!this.runde().laeuft) return false;

    const schonGedrueckt = this.ich()?.buzzerPlatz !== null;
    return !(schonGedrueckt && this.einstellungen().nurEinmalBuzzern);
  });

  protected sekunden(ms: number | null): string {
    if (ms === null) return '—';
    return `${(ms / 1000).toFixed(2).replace('.', ',')} s`;
  }

  // ----- Laden und Beitreten ----------------------------------------------

  private async laden(code: string): Promise<void> {
    this.laedt.set(true);
    this.fehler.set(null);

    try {
      const partie = await firstValueFrom(this.api.partie(code));
      this.partie.set(partie);

      const dabei = partie.teilnehmer.some((t) => t.userId === this.auth.user()?.id);
      if (dabei) this.realtime.betreten(code);
    } catch (err) {
      this.fehler.set(this.meldung(err, 'Diese Partie konnte nicht geladen werden.'));
    } finally {
      this.laedt.set(false);
    }
  }

  protected async beitreten(): Promise<void> {
    this.busy.set(true);
    try {
      const partie = await firstValueFrom(this.api.partieBeitreten(this.code()));
      this.partie.set(partie);
      this.realtime.betreten(partie.code);
    } catch (err) {
      this.fehler.set(this.meldung(err, 'Der Beitritt hat nicht geklappt.'));
    } finally {
      this.busy.set(false);
    }
  }

  // ----- Lobby -------------------------------------------------------------

  protected async codeKopieren(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.code());
      this.codeKopiert.set(true);
      setTimeout(() => this.codeKopiert.set(false), 2000);
    } catch {
      // Zwischenablage gesperrt: der Code steht gross auf dem Schirm und
      // laesst sich vorlesen oder markieren.
    }
  }

  protected async starten(): Promise<void> {
    await this.aktion(() => firstValueFrom(this.api.partieStarten(this.code())));
  }

  protected async beenden(): Promise<void> {
    await this.aktion(async () => {
      const ergebnis = await firstValueFrom(this.api.partieBeenden(this.code()));
      this.hinweis.set(
        ergebnis.gewertet
          ? 'Partie beendet. Die Bilanzen sind aktualisiert.'
          : 'Partie beendet. Mit nur einem Mitspieler zählt sie nicht für die Rangliste.',
      );
      return ergebnis;
    });
  }

  protected async abbrechen(): Promise<void> {
    await this.aktion(async () => {
      const abgebrochen = await firstValueFrom(this.api.partieAbbrechen(this.code()));
      this.hinweis.set('Partie abgebrochen. Sie zählt für keine Statistik.');
      return abgebrochen;
    });
  }

  protected async zurStartseite(): Promise<void> {
    await this.router.navigate(['/']);
  }

  protected async zurRangliste(): Promise<void> {
    await this.router.navigate(['/leaderboard']);
  }

  protected async verlassen(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.partieVerlassen(this.code()));
      this.realtime.verlassen();
      await this.router.navigate(['/']);
    } catch (err) {
      this.fehler.set(this.meldung(err, 'Verlassen hat nicht geklappt.'));
    } finally {
      this.busy.set(false);
    }
  }

  private async aktion(ausfuehren: () => Promise<PartieModel>): Promise<void> {
    if (this.busy()) return;

    this.busy.set(true);
    this.fehler.set(null);

    try {
      this.partie.set(await ausfuehren());
    } catch (err) {
      this.fehler.set(this.meldung(err, 'Das hat nicht geklappt.'));
    } finally {
      this.busy.set(false);
    }
  }

  // ----- Im Spiel ----------------------------------------------------------

  protected textTippen(wert: string): void {
    this.eigenerText.set(wert);
    this.realtime.textSenden(wert);
  }

  protected buzzern(): void {
    if (!this.darfBuzzern()) return;
    this.realtime.buzzern();
  }

  protected taste(event: KeyboardEvent): void {
    if (event.code !== 'Space' && event.key !== ' ') return;

    // Im Textfeld ist die Leertaste ein Leerzeichen und sonst nichts.
    const ziel = event.target as HTMLElement | null;
    if (ziel && (ziel.tagName === 'INPUT' || ziel.tagName === 'TEXTAREA')) return;
    if (!this.darfBuzzern()) return;

    event.preventDefault();
    this.buzzern();
  }

  protected rundeStarten(): void {
    this.realtime.rundeStarten();
  }

  protected rundeStoppen(): void {
    this.realtime.rundeStoppen();
  }

  protected punkte(userId: string, faktor: 1 | -1): void {
    this.realtime.punkteGeben(userId, this.einstellungen().punkteProTreffer * faktor);
  }

  private meldung(err: unknown, ersatz: string): string {
    if (!(err instanceof HttpErrorResponse)) return ersatz;

    if (err.status === 404) return 'Diese Partie gibt es nicht.';
    if (err.status === 403) return err.error?.error ?? 'Dafür fehlt dir die Berechtigung.';
    if (err.status === 409 || err.status === 400) return err.error?.error ?? ersatz;
    return ersatz;
  }
}
