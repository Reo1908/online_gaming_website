import { Component, computed, effect, inject, input, signal, OnDestroy, OnInit } from '@angular/core';
import { RealtimeService } from '../../core/realtime.service';
import type { LiveTeilnehmer, LiveZustand } from '../../core/models';
import { PultAnsicht } from './pult';
import { Unterlagen } from './unterlagen';
import type { AusbruchZustand, Funkspruch, Phase } from './typen';

/**
 * Der Ausbruch.
 *
 * Die Seite zerfaellt in zwei Haelften: links die Anlage -- Pult oder
 * Unterlagen, je nachdem, was der Server geschickt hat -- und rechts der
 * Funk mit der Mannschaft. Was jemand nicht sehen darf, fehlt hier nicht
 * bloss in der Vorlage: Es ist nie im Browser angekommen.
 *
 * Diese Datei weiss deshalb ueberraschend wenig ueber die Raetsel. Sie fuehrt
 * die Uhr, den Funk und die Rollen -- ob gerade Kabel oder Symbole vor einem
 * liegen, entscheiden `app-pult` und `app-unterlagen`.
 */
@Component({
  selector: 'app-ausbruch',
  imports: [PultAnsicht, Unterlagen],
  templateUrl: './ausbruch.html',
  styleUrl: './ausbruch.scss',
})
export class Ausbruch implements OnInit, OnDestroy {
  private readonly realtime = inject(RealtimeService);

  readonly zustand = input.required<LiveZustand>();
  readonly ichId = input.required<string>();
  readonly binLeitung = input.required<boolean>();

  protected readonly eingabe = signal('');

  /**
   * Der Funk kommt doppelt: im vollen Zustand und als einzelne Zeile. Der
   * volle Zustand ist immer der vollstaendige und darf deshalb ueberschreiben.
   */
  protected readonly funk = signal<Funkspruch[]>([]);

  /** Bis wann der eigene Sender belegt ist -- in Browserzeit. */
  protected readonly sperreBis = signal(0);

  /** Versatz zwischen Server- und Browseruhr, in Millisekunden. */
  private versatz = 0;
  private readonly jetzt = signal(Date.now());
  private uhr: ReturnType<typeof setInterval> | null = null;
  private abmelden: Array<() => void> = [];

  constructor() {
    effect(() => {
      const s = this.spielZustand();
      if (!s) return;

      this.versatz = s.serverZeit - Date.now();
      this.funk.set(s.funk);
    });
  }

  ngOnInit(): void {
    this.uhr = setInterval(() => this.jetzt.set(Date.now()), 250);

    this.abmelden = [
      this.realtime.horchen<Funkspruch>('ausbruch:funk', (spruch) =>
        this.funk.update((alt) => [...alt, spruch].slice(-60)),
      ),
      // Der Server hat den Spruch verworfen, weil der Sender noch belegt war.
      this.realtime.horchen<{ bisUm: number; serverZeit: number }>(
        'ausbruch:funksperre',
        ({ bisUm, serverZeit }) => this.sperreBis.set(bisUm - (serverZeit - Date.now())),
      ),
    ];
  }

  ngOnDestroy(): void {
    if (this.uhr) clearInterval(this.uhr);
    for (const ab of this.abmelden) ab();
  }

  // ----- Abgeleitete Sicht -------------------------------------------------

  protected readonly spielZustand = computed(
    () => (this.zustand().spielZustand ?? null) as AusbruchZustand | null,
  );

  protected readonly phase = computed<Phase>(() => this.spielZustand()?.phase ?? 'EINWEISUNG');
  protected readonly schleuse = computed(() => this.spielZustand()?.schleuse ?? 0);
  protected readonly schleusen = computed(() => this.spielZustand()?.schleusen ?? 0);
  protected readonly titel = computed(() => this.spielZustand()?.titel ?? '');
  protected readonly auftrag = computed(() => this.spielZustand()?.auftrag ?? '');
  protected readonly erfolg = computed(() => this.spielZustand()?.erfolg ?? null);
  protected readonly schwer = computed(() => this.spielZustand()?.schwer ?? false);
  protected readonly fehlalarme = computed(() => this.spielZustand()?.fehlalarmeGesamt ?? 0);
  protected readonly strafe = computed(() => this.spielZustand()?.strafe ?? 0);

  protected readonly pult = computed(() => this.spielZustand()?.pult ?? null);
  protected readonly unterlage = computed(() => this.spielZustand()?.unterlage ?? null);
  protected readonly unterlageNr = computed(() => this.spielZustand()?.unterlageNr ?? null);
  protected readonly unterlagen = computed(() => this.spielZustand()?.unterlagen ?? 0);

  protected readonly binBediener = computed(
    () => this.spielZustand()?.bedienerId === this.ichId(),
  );

  protected readonly mannschaft = computed<LiveTeilnehmer[]>(() =>
    this.zustand().teilnehmer.filter((t) => t.spieltMit),
  );

  protected readonly bediener = computed(() => {
    const id = this.spielZustand()?.bedienerId;
    return id ? this.mannschaft().find((t) => t.userId === id) : undefined;
  });

  /** Der Punktestand ist fuer alle derselbe -- gewonnen wird zusammen. */
  protected readonly punkte = computed(() => this.mannschaft()[0]?.punkte ?? 0);

  /** Was vom Zeitkonto uebrig ist, in Millisekunden. */
  protected readonly restMs = computed(() => {
    const s = this.spielZustand();
    if (!s) return 0;
    if (!s.uhrLaeuft || s.ablaufUm === null) return Math.max(0, s.restMs);

    return Math.max(0, s.ablaufUm - (this.jetzt() + this.versatz));
  });

  protected readonly restText = computed(() => {
    const sekunden = Math.ceil(this.restMs() / 1000);
    const minuten = Math.floor(sekunden / 60);

    return `${minuten}:${String(sekunden % 60).padStart(2, '0')}`;
  });

  /** Die letzte Minute ist die, in der es weh tut. */
  protected readonly knapp = computed(() => this.restMs() <= 60_000);

  /**
   * Wie voll das Konto noch ist, 0 bis 1.
   *
   * Gemessen an dem, was zu Beginn darauf lag -- nicht an der laufenden
   * Schleuse. Der Balken zeigt damit den ganzen Ausbruch, nicht einen Zug.
   */
  protected readonly kontoAnteil = computed(() => {
    const konto = this.spielZustand()?.kontoMs ?? 0;
    return konto > 0 ? Math.min(1, this.restMs() / konto) : 0;
  });

  /** Restsekunden der Zwischenphase -- Einweisung, Pause, Abspann. */
  protected readonly phaseRest = computed(() => {
    const ende = this.spielZustand()?.phaseEndetUm;
    if (!ende) return 0;

    return Math.max(0, Math.ceil((ende - (this.jetzt() + this.versatz)) / 1000));
  });

  protected readonly sperreRest = computed(() =>
    Math.max(0, Math.ceil((this.sperreBis() - this.jetzt()) / 1000)),
  );

  /** Wie weit sie gekommen sind -- steht im Abspann einer verlorenen Partie. */
  protected readonly geloestText = computed(() => {
    const geschafft = this.spielZustand()?.geloest ?? 0;

    if (geschafft === 0) return 'Keine einzige Schleuse ging auf';
    if (geschafft === 1) return 'Eine von ' + this.schleusen() + ' Schleusen habt ihr geschafft';
    return `${geschafft} von ${this.schleusen()} Schleusen habt ihr geschafft`;
  });

  /** Ob die Leitung die Bedienung gerade weiterreichen darf. */
  protected readonly darfUebergeben = computed(
    () => this.binLeitung() && this.phase() === 'SCHLEUSE',
  );

  // ----- Handlungen --------------------------------------------------------

  protected pultEingabe(nutzlast: unknown): void {
    this.realtime.senden('pult:eingabe', nutzlast);
  }

  protected funken(): void {
    const text = this.eingabe().trim();
    if (!text || this.sperreRest() > 0) return;

    this.realtime.senden('funk', { text });
    this.eingabe.set('');

    // Die Sperre gleich hier setzen statt auf die Antwort zu warten: Sonst
    // tippt man den zweiten Spruch, bevor der erste abgelehnt ist.
    const sekunden = Number(this.zustand().einstellungen['funkSperre'] ?? 0);
    if (sekunden > 0) this.sperreBis.set(Date.now() + sekunden * 1000);
  }

  protected uebergeben(userId: string): void {
    this.realtime.senden('bedienung:uebergeben', { userId });
  }
}
