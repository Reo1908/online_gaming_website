import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { RealtimeService } from '../../core/realtime.service';
import type { LiveTeilnehmer, LiveZustand } from '../../core/models';
import { Zeichenflaeche, type Strich } from './zeichenflaeche';

export type Phase = 'WORTWAHL' | 'ZEICHNEN' | 'ZUGENDE' | 'ENDE';

interface Nachricht {
  id: string;
  userId: string | null;
  name: string;
  text: string;
  art: 'rateversuch' | 'treffer' | 'system';
  nurWissende: boolean;
}

/** Der Teil des Live-Zustands, den das Scribble-Modul auf dem Server fuellt. */
interface ScribbleZustand {
  phase: Phase;
  serverZeit: number;
  runde: number;
  runden: number;
  zeichnerId: string | null;
  endetUm: number | null;
  dauerMs: number;
  /** Nur fuer die, die es kennen duerfen. */
  wort: string | null;
  maske: string;
  /** Nur fuer den Zeichner in der Wortwahl. */
  wahl: string[] | null;
  richtig: string[];
  chat: Nachricht[];
  ergebnis: Record<string, number> | null;
}

/** Die Palette. Acht Farben reichen -- mehr macht die Leiste unuebersichtlich. */
const FARBEN = [
  '#111827',
  '#ffffff',
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#92400e',
];

const BREITEN = [3, 8, 18];

@Component({
  selector: 'app-scribble',
  imports: [ButtonModule, Zeichenflaeche],
  templateUrl: './scribble.html',
  styleUrl: './scribble.scss',
})
export class Scribble implements OnInit, OnDestroy {
  private readonly realtime = inject(RealtimeService);
  private readonly flaeche = viewChild<Zeichenflaeche>(Zeichenflaeche);

  readonly zustand = input.required<LiveZustand>();
  readonly ichId = input.required<string>();

  protected readonly farben = FARBEN;
  protected readonly breiten = BREITEN;

  protected readonly farbe = signal(FARBEN[0]);
  protected readonly breite = signal(BREITEN[1]);
  protected readonly eingabe = signal('');

  /**
   * Chat und Maske kommen doppelt: im vollen Zustand und als Einzelmeldung.
   * Der volle Zustand ist immer der vollstaendige -- deshalb darf er hier
   * schlicht ueberschreiben, ohne dass etwas verloren geht.
   */
  protected readonly chat = signal<Nachricht[]>([]);
  protected readonly maske = signal('');

  /** Versatz zwischen Server- und Browseruhr, in Millisekunden. */
  private versatz = 0;
  private readonly jetzt = signal(Date.now());
  private uhr: ReturnType<typeof setInterval> | null = null;
  private abmelden: Array<() => void> = [];

  constructor() {
    // Der volle Zustand ist massgeblich: Er setzt die Uhr gerade und
    // ueberschreibt, was zwischendurch einzeln hereinkam.
    effect(() => {
      const s = this.spielZustand();
      if (!s) return;

      this.versatz = s.serverZeit - Date.now();
      this.chat.set(s.chat);
      this.maske.set(s.maske);
    });
  }

  ngOnInit(): void {
    this.uhr = setInterval(() => this.jetzt.set(Date.now()), 250);

    this.abmelden = [
      // Die Zeichnung als Ganzes -- beim Betreten, nach Leeren und Zurück.
      this.realtime.horchen<{ striche: Strich[] }>('scribble:striche', ({ striche }) =>
        this.flaeche()?.setzen(striche),
      ),
      // Einzelne Punkte waehrend des Zeichnens.
      this.realtime.horchen<Strich>('scribble:strich', (strich) =>
        this.flaeche()?.ergaenzen(strich),
      ),
      this.realtime.horchen<Nachricht>('scribble:chat', (nachricht) =>
        this.chat.update((alt) => [...alt, nachricht].slice(-60)),
      ),
      this.realtime.horchen<{ maske: string }>('scribble:maske', ({ maske }) =>
        this.maske.set(maske),
      ),
    ];
  }

  ngOnDestroy(): void {
    if (this.uhr) clearInterval(this.uhr);
    for (const ab of this.abmelden) ab();
  }

  // ----- Abgeleitete Sicht -------------------------------------------------

  protected readonly spielZustand = computed(
    () => (this.zustand().spielZustand ?? null) as ScribbleZustand | null,
  );

  protected readonly phase = computed<Phase>(() => this.spielZustand()?.phase ?? 'WORTWAHL');
  protected readonly runde = computed(() => this.spielZustand()?.runde ?? 0);
  protected readonly runden = computed(() => this.spielZustand()?.runden ?? 0);
  protected readonly wort = computed(() => this.spielZustand()?.wort ?? null);
  protected readonly wahl = computed(() => this.spielZustand()?.wahl ?? null);

  protected readonly teilnehmer = computed<LiveTeilnehmer[]>(() => this.zustand().teilnehmer);

  protected readonly zeichner = computed(() => {
    const id = this.spielZustand()?.zeichnerId;
    return id ? this.teilnehmer().find((t) => t.userId === id) : undefined;
  });

  protected readonly binZeichner = computed(
    () => this.spielZustand()?.zeichnerId === this.ichId(),
  );

  protected readonly habeGeraten = computed(
    () => this.spielZustand()?.richtig.includes(this.ichId()) ?? false,
  );

  protected readonly rangliste = computed(() =>
    [...this.teilnehmer()].filter((t) => t.spieltMit).sort((a, b) => b.punkte - a.punkte),
  );

  protected readonly darfZeichnen = computed(
    () => this.binZeichner() && this.phase() === 'ZEICHNEN',
  );

  protected readonly darfRaten = computed(
    () => !this.binZeichner() && this.phase() === 'ZEICHNEN' && !this.habeGeraten(),
  );

  /** Verbleibende Sekunden der laufenden Phase, ganzzahlig. */
  protected readonly restSekunden = computed(() => {
    const ende = this.spielZustand()?.endetUm;
    if (!ende) return 0;

    return Math.max(0, Math.ceil((ende - (this.jetzt() + this.versatz)) / 1000));
  });

  /** Anteil der noch offenen Zeit, 0 bis 1 -- fuer den Balken. */
  protected readonly restAnteil = computed(() => {
    const s = this.spielZustand();
    if (!s?.endetUm || !s.dauerMs) return 0;

    const rest = s.endetUm - (this.jetzt() + this.versatz);
    return Math.min(1, Math.max(0, rest / s.dauerMs));
  });

  /** Knapp wird es in den letzten zehn Sekunden. */
  protected readonly knapp = computed(
    () => this.phase() === 'ZEICHNEN' && this.restSekunden() <= 10,
  );

  /**
   * Was oben in der Mitte steht.
   * Der Zeichner sieht sein Wort, alle anderen die Luecken -- und am Zugende
   * sehen es alle.
   */
  protected readonly wortAnzeige = computed(() => {
    const wort = this.wort();
    if (wort) return wort;
    return this.maske();
  });

  protected readonly zugPunkte = computed(() => {
    const ergebnis = this.spielZustand()?.ergebnis ?? {};

    return this.teilnehmer()
      .filter((t) => (ergebnis[t.userId] ?? 0) > 0)
      .map((t) => ({ name: t.displayName, punkte: ergebnis[t.userId] }))
      .sort((a, b) => b.punkte - a.punkte);
  });

  // ----- Handlungen --------------------------------------------------------

  protected wortWaehlen(wort: string): void {
    this.realtime.senden('wort:waehlen', { wort });
  }

  protected strichSenden(strich: Strich): void {
    this.realtime.senden('zeichnen:strich', strich);
  }

  protected zurueck(): void {
    // Sofort auf der eigenen Leinwand, damit der Klick nicht ins Leere geht;
    // der Server schickt gleich darauf die verbindliche Fassung.
    this.flaeche()?.zurueck();
    this.realtime.senden('zeichnen:zurueck');
  }

  protected leeren(): void {
    this.flaeche()?.leeren();
    this.realtime.senden('zeichnen:leeren');
  }

  protected abschicken(): void {
    const text = this.eingabe().trim();
    if (!text) return;

    this.realtime.senden('raten', { text });
    this.eingabe.set('');
  }
}
