import { Component, computed, inject, input, signal, OnDestroy, OnInit } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { RealtimeService } from '../../core/realtime.service';
import type { LiveTeilnehmer, LiveZustand } from '../../core/models';

/** Standardwerte, falls eine Partie noch aus einer aelteren Fassung stammt. */
const PUNKTE_STANDARD = 10;

/** Der Teil des Live-Zustands, den das Buzzer-Modul auf dem Server fuellt. */
interface BuzzerZustand {
  runde: { nummer: number; laeuft: boolean; gestartetUm: number | null };
}

@Component({
  selector: 'app-buzzer',
  imports: [ButtonModule],
  templateUrl: './buzzer.html',
  styleUrl: './buzzer.scss',
  host: {
    // Leertaste buzzert -- beim Buzzer-Spiel zaehlen Zehntelsekunden, und der
    // Weg zur Maus kostet mehr als das. Im Textfeld bleibt sie ein Leerzeichen.
    '(document:keydown)': 'taste($event)',
  },
})
export class Buzzer implements OnInit, OnDestroy {
  private readonly realtime = inject(RealtimeService);

  readonly zustand = input.required<LiveZustand>();
  readonly binLeitung = input.required<boolean>();
  readonly ichId = input.required<string>();

  protected readonly eigenerText = signal('');

  /** Meldet den Zuhoerer wieder ab; sonst kaeme er nach einem Wechsel doppelt. */
  private abmelden: (() => void) | null = null;

  ngOnInit(): void {
    // Der getippte Text kommt einzeln statt als ganzer Zustand: Er aendert
    // sich bei jedem Tastendruck, alles andere nicht.
    this.abmelden = this.realtime.horchen<{ userId: string; text: string }>(
      'spieler:text',
      ({ userId, text }) => this.realtime.teilnehmerSetzen(userId, { text }),
    );
  }

  ngOnDestroy(): void {
    this.abmelden?.();
  }

  // ----- Abgeleitete Sicht -------------------------------------------------

  private readonly spielZustand = computed(
    () => (this.zustand().spielZustand ?? null) as BuzzerZustand | null,
  );

  protected readonly runde = computed(
    () => this.spielZustand()?.runde ?? { nummer: 0, laeuft: false, gestartetUm: null },
  );

  protected readonly teilnehmer = computed<LiveTeilnehmer[]>(() => this.zustand().teilnehmer);
  protected readonly spieler = computed(() => this.teilnehmer().filter((t) => t.spieltMit));
  protected readonly ich = computed(() => this.teilnehmer().find((t) => t.userId === this.ichId()));

  /** Wer gebuzzert hat, in der Reihenfolge des Drueckens. */
  protected readonly amBuzzer = computed(() =>
    this.spieler()
      .filter((t) => t.buzzerPlatz != null)
      .sort((a, b) => (a.buzzerPlatz ?? 0) - (b.buzzerPlatz ?? 0)),
  );

  protected readonly rangliste = computed(() =>
    [...this.spieler()].sort((a, b) => b.punkte - a.punkte),
  );

  protected readonly einstellungen = computed(() => {
    const roh = this.zustand().einstellungen;
    return {
      punkteProTreffer: Number(roh['punkteProTreffer'] ?? PUNKTE_STANDARD),
      nurEinmalBuzzern: roh['nurEinmalBuzzern'] !== false,
      antwortenOeffentlich: roh['antwortenOeffentlich'] === true,
    };
  });

  protected readonly darfBuzzern = computed(() => {
    if (this.binLeitung() || !this.runde().laeuft) return false;

    const schonGedrueckt = this.ich()?.buzzerPlatz != null;
    return !(schonGedrueckt && this.einstellungen().nurEinmalBuzzern);
  });

  protected sekunden(ms: number | null | undefined): string {
    if (ms === null || ms === undefined) return '—';
    return `${(ms / 1000).toFixed(2).replace('.', ',')} s`;
  }

  // ----- Handlungen --------------------------------------------------------

  protected textTippen(wert: string): void {
    this.eigenerText.set(wert);
    this.realtime.senden('text:setzen', { text: wert });
  }

  protected buzzern(): void {
    if (!this.darfBuzzern()) return;
    this.realtime.senden('buzzern');
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
    this.realtime.senden('runde:starten');
  }

  protected rundeStoppen(): void {
    this.realtime.senden('runde:stoppen');
  }

  protected punkte(userId: string, faktor: 1 | -1): void {
    this.realtime.senden('punkte:geben', {
      userId,
      punkte: this.einstellungen().punkteProTreffer * faktor,
    });
  }
}
