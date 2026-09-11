import { Component, computed, effect, inject, input, signal, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { RealtimeService } from '../../core/realtime.service';
import { Buzzer } from '../../games/buzzer/buzzer';
import { Scribble } from '../../games/scribble/scribble';
import { einstellungenLesbar, spielDefinition } from '../../games/registry';
import type {
  Etikett,
  LiveTeilnehmer,
  MatchStatus,
  Partie as PartieModel,
  Thema,
} from '../../core/models';

/**
 * Der Rahmen um eine Partie.
 *
 * Alles, was fuer jede Spielart gleich ist, steht hier: laden, beitreten, die
 * wartende Lobby, der Endstand. Sobald es losgeht, uebernimmt die Komponente
 * der Spielart -- was dort passiert, weiss diese Datei nicht.
 */
@Component({
  selector: 'app-partie',
  imports: [ButtonModule, MessageModule, Buzzer, Scribble],
  templateUrl: './partie.html',
  styleUrl: './partie.scss',
})
export class Partie implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly realtime = inject(RealtimeService);
  private readonly router = inject(Router);

  /** Kommt aus der Route (`/partie/:code`). */
  readonly code = input.required<string>();

  protected readonly partie = signal<PartieModel | null>(null);
  protected readonly themen = signal<Thema[]>([]);
  protected readonly laedt = signal(true);
  protected readonly busy = signal(false);
  protected readonly fehler = signal<string | null>(null);
  protected readonly hinweis = signal<string | null>(null);
  protected readonly codeKopiert = signal(false);

  protected readonly zustand = this.realtime.zustand;
  protected readonly verbunden = this.realtime.verbunden;

  constructor() {
    // Der Code steht erst nach der Bindung der Route fest.
    effect(() => {
      const code = this.code();
      void this.laden(code);
    });

    /*
     * Scribble endet von selbst -- die Nachricht kommt ueber die
     * Socket-Verbindung. Die festgeschriebenen Plaetze stehen dann aber nur
     * in der Datenbank, nicht im Live-Zustand: also einmal nachladen.
     */
    effect(() => {
      const live = this.zustand();
      const geladen = this.partie();
      if (!live || !geladen) return;
      if (live.status === geladen.status) return;
      if (live.status !== 'FINISHED' && live.status !== 'ABORTED') return;

      void this.nachladen();
    });
  }

  ngOnDestroy(): void {
    this.realtime.verlassen();
  }

  // ----- Abgeleitete Sicht -------------------------------------------------

  protected readonly status = computed<MatchStatus>(
    () => this.zustand()?.status ?? this.partie()?.status ?? 'LOBBY',
  );

  protected readonly spielSlug = computed(
    () => this.zustand()?.spiel.slug ?? this.partie()?.spiel.slug ?? '',
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
      spieltMit: t.spieltMit,
      punkte: t.punkte,
      verbunden: false,
    }));
  });

  protected readonly ichId = computed(() => this.auth.user()?.id ?? '');
  protected readonly ich = computed(() =>
    this.teilnehmer().find((t) => t.userId === this.ichId()),
  );

  protected readonly binLeitung = computed(() => this.ich()?.istLeitung === true);
  protected readonly binDabei = computed(() => this.ich() !== undefined);

  /** Wer mitspielt und gewertet wird -- die Buzzer-Leitung also nicht. */
  protected readonly spieler = computed(() => this.teilnehmer().filter((t) => t.spieltMit));
  protected readonly leitung = computed(() => this.teilnehmer().find((t) => t.istLeitung));

  protected readonly etiketten = computed<Etikett[]>(
    () => this.zustand()?.etiketten ?? this.partie()?.etiketten ?? [],
  );

  protected readonly oeffentlich = computed(
    () => this.zustand()?.oeffentlich ?? this.partie()?.oeffentlich ?? false,
  );

  /** Die Einstellungen der Partie, lesbar gemacht -- je Spielart andere. */
  protected readonly einstellungen = computed(() =>
    einstellungenLesbar(
      this.spielSlug(),
      this.zustand()?.einstellungen ?? this.partie()?.settings ?? {},
    ),
  );

  protected readonly manuellesEnde = computed(
    () => spielDefinition(this.spielSlug())?.manuellesEnde ?? true,
  );

  /** Wie viele Mitspielende es zum Start braucht. */
  protected readonly genugSpieler = computed(() => {
    const noetig = this.spielSlug() === 'scribble' ? 2 : 1;
    return this.spieler().length >= noetig;
  });

  /**
   * Der Endstand kommt aus der Datenbank, nicht aus dem Live-Zustand: dort
   * steht die festgeschriebene Platzierung, und der Live-Teil ist nach dem
   * Ende der Partie ohnehin weggeraeumt.
   */
  protected readonly endstand = computed(() =>
    (this.partie()?.teilnehmer ?? [])
      .filter((t) => t.spieltMit)
      .sort((a, b) => (a.platz ?? 99) - (b.platz ?? 99) || b.punkte - a.punkte),
  );

  protected istGewaehlt(slug: string): boolean {
    return this.etiketten().some((e) => e.slug === slug);
  }

  // ----- Laden und Beitreten ----------------------------------------------

  private async laden(code: string): Promise<void> {
    this.laedt.set(true);
    this.fehler.set(null);

    try {
      const partie = await firstValueFrom(this.api.partie(code));
      this.partie.set(partie);

      const dabei = partie.teilnehmer.some((t) => t.userId === this.ichId());
      if (dabei) this.realtime.betreten(code);

      // Die Themen braucht nur die Leitung einer wartenden Lobby -- deshalb
      // erst dann und nicht bei jedem Aufruf.
      if (dabei && partie.status === 'LOBBY') void this.themenLaden();
    } catch (err) {
      this.fehler.set(this.meldung(err, 'Diese Partie konnte nicht geladen werden.'));
    } finally {
      this.laedt.set(false);
    }
  }

  private async nachladen(): Promise<void> {
    try {
      this.partie.set(await firstValueFrom(this.api.partie(this.code())));
    } catch {
      // Der Live-Zustand hat den Endstand schon gezeigt; ein Fehler beim
      // Nachladen darf die Seite nicht mit einer Meldung zupflastern.
    }
  }

  private async themenLaden(): Promise<void> {
    try {
      this.themen.set(await firstValueFrom(this.api.themen()));
    } catch {
      // Ohne Themen laesst sich trotzdem spielen -- dann zaehlt einfach alles.
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

  /** Schaltet ein Thema an oder ab. Nur die Leitung sieht die Knoepfe. */
  protected async themaUmschalten(slug: string): Promise<void> {
    const vorher = this.etiketten().map((e) => e.slug);
    const nachher = vorher.includes(slug)
      ? vorher.filter((s) => s !== slug)
      : [...vorher, slug];

    await this.einstellen({ etiketten: nachher });
  }

  protected async sichtbarkeitUmschalten(): Promise<void> {
    await this.einstellen({ oeffentlich: !this.oeffentlich() });
  }

  private async einstellen(aenderung: {
    oeffentlich?: boolean;
    etiketten?: string[];
  }): Promise<void> {
    if (this.busy()) return;

    this.busy.set(true);
    this.fehler.set(null);

    try {
      this.partie.set(await firstValueFrom(this.api.partieAendern(this.code(), aenderung)));
    } catch (err) {
      this.fehler.set(this.meldung(err, 'Die Einstellung konnte nicht gespeichert werden.'));
    } finally {
      this.busy.set(false);
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

  private meldung(err: unknown, ersatz: string): string {
    if (!(err instanceof HttpErrorResponse)) return ersatz;

    if (err.status === 404) return 'Diese Partie gibt es nicht.';
    if (err.status === 403) return err.error?.error ?? 'Dafür fehlt dir die Berechtigung.';
    if (err.status === 409 || err.status === 400) return err.error?.error ?? ersatz;
    return ersatz;
  }
}
