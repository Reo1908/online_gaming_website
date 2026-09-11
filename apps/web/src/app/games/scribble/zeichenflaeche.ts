import {
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

/** Ein Pinselstrich in normierten Koordinaten (0..1), abwechselnd x und y. */
export interface Strich {
  id: string;
  farbe: string;
  breite: number;
  punkte: number[];
}

/**
 * Wie oft gesammelte Punkte auf die Reise gehen.
 *
 * Jeden einzelnen Punkt zu schicken waere bei einem schnellen Strich ein
 * Paket alle paar Millisekunden. Bei 60 ms sieht es fuer die Zuschauer noch
 * fluessig aus und kostet ein Fuenftel davon.
 */
const SENDETAKT_MS = 60;

/**
 * Die Zeichenflaeche.
 *
 * Haelt ihre Striche selbst und zeichnet neue Punkte einzeln nach, statt bei
 * jeder Aenderung alles neu zu malen: Waehrend eines Zuges kommen dutzende
 * Punkte je Sekunde herein, und ein voller Neuaufbau bei jedem waere auf
 * einem schwaecheren Geraet sichtbar ruckelig.
 *
 * Koordinaten laufen von 0 bis 1, nicht in Pixeln. Sonst saehe die Zeichnung
 * auf einem Telefon anders aus als auf dem Rechner, auf dem sie entstand.
 */
@Component({
  selector: 'app-zeichenflaeche',
  template: `
    <canvas
      #leinwand
      [class.zeichnend]="darfZeichnen()"
      (pointerdown)="beginnen($event)"
      (pointermove)="ziehen($event)"
      (pointerup)="loslassen()"
      (pointercancel)="loslassen()"
      (pointerleave)="loslassen()"
    ></canvas>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
    }

    canvas {
      display: block;
      width: 100%;
      aspect-ratio: 4 / 3;
      border-radius: 10px;
      background: #fff;
      border: 1px solid var(--p-surface-300);
      touch-action: none;
      cursor: default;
    }

    canvas.zeichnend {
      cursor: crosshair;
    }
  `,
})
export class Zeichenflaeche implements OnDestroy {
  private readonly leinwand = viewChild.required<ElementRef<HTMLCanvasElement>>('leinwand');

  readonly darfZeichnen = input(false);
  readonly farbe = input('#111827');
  readonly breite = input(4);

  /** Neue Punkte eines Strichs, fertig zum Verschicken. */
  readonly strich = output<Strich>();

  private striche: Strich[] = [];
  private laufend: Strich | null = null;
  /** Noch nicht verschickte Punkte des laufenden Strichs. */
  private ungesendet: number[] = [];
  private sendezeiger: ReturnType<typeof setTimeout> | null = null;

  /** Wie viele Punkte je Strich schon auf der Leinwand stehen. */
  private gezeichnet = new Map<string, number>();

  private beobachter: ResizeObserver | null = null;

  constructor() {
    // Die Leinwand steht erst nach dem ersten Durchlauf; ab da haengt sich der
    // Beobachter an ihre Groesse.
    effect(() => {
      const element = this.leinwand().nativeElement;
      if (this.beobachter) return;

      this.beobachter = new ResizeObserver(() => this.groesseAnpassen());
      this.beobachter.observe(element);
      this.groesseAnpassen();
    });
  }

  ngOnDestroy(): void {
    this.beobachter?.disconnect();
    if (this.sendezeiger) clearTimeout(this.sendezeiger);
  }

  // ----- Von aussen --------------------------------------------------------

  /** Setzt die ganze Zeichnung neu -- beim Betreten, nach Leeren und Rückgängig. */
  setzen(striche: Strich[]): void {
    this.striche = striche.map((s) => ({ ...s, punkte: [...s.punkte] }));
    this.gezeichnet.clear();
    this.neuZeichnen();
  }

  /**
   * Ergaenzt einen Strich um neue Punkte und malt nur diese nach.
   * Kennt sie den Strich noch nicht, legt sie ihn an.
   */
  ergaenzen(teil: Strich): void {
    const vorhanden = this.striche.find((s) => s.id === teil.id);

    if (vorhanden) vorhanden.punkte.push(...teil.punkte);
    else this.striche.push({ ...teil, punkte: [...teil.punkte] });

    this.strichZeichnen(this.striche.find((s) => s.id === teil.id)!);
  }

  leeren(): void {
    this.setzen([]);
  }

  // ----- Zeichnen ----------------------------------------------------------

  private kontext(): CanvasRenderingContext2D | null {
    return this.leinwand().nativeElement.getContext('2d');
  }

  /**
   * Passt die Leinwand an ihre tatsaechliche Groesse an.
   *
   * Ohne die Umrechnung auf `devicePixelRatio` waere jede Linie auf einem
   * hochaufloesenden Bildschirm sichtbar unscharf.
   */
  private groesseAnpassen(): void {
    const element = this.leinwand().nativeElement;
    const rechteck = element.getBoundingClientRect();
    if (rechteck.width === 0) return;

    const dichte = window.devicePixelRatio || 1;
    element.width = Math.round(rechteck.width * dichte);
    element.height = Math.round(rechteck.height * dichte);

    this.gezeichnet.clear();
    this.neuZeichnen();
  }

  private neuZeichnen(): void {
    const ctx = this.kontext();
    const element = this.leinwand().nativeElement;
    if (!ctx) return;

    ctx.clearRect(0, 0, element.width, element.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, element.width, element.height);

    for (const strich of this.striche) this.strichZeichnen(strich);
  }

  /** Malt nur den Teil eines Strichs, der noch nicht auf der Leinwand steht. */
  private strichZeichnen(strich: Strich): void {
    const ctx = this.kontext();
    const element = this.leinwand().nativeElement;
    if (!ctx) return;

    const punkte = strich.punkte;
    const fertig = this.gezeichnet.get(strich.id) ?? 0;
    if (punkte.length < 2 || fertig >= punkte.length) return;

    const dichte = window.devicePixelRatio || 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = strich.farbe;
    ctx.lineWidth = strich.breite * dichte;

    // Ein Punkt zurueck: Sonst klafft zwischen zwei Teilstuecken eine Luecke.
    const start = Math.max(0, fertig - 2);

    ctx.beginPath();
    ctx.moveTo(punkte[start] * element.width, punkte[start + 1] * element.height);

    for (let i = start + 2; i < punkte.length; i += 2) {
      ctx.lineTo(punkte[i] * element.width, punkte[i + 1] * element.height);
    }

    // Ein einzelner Klick ohne Bewegung soll trotzdem einen Punkt hinterlassen.
    if (punkte.length === 2) {
      ctx.lineTo(punkte[0] * element.width + 0.01, punkte[1] * element.height);
    }

    ctx.stroke();
    this.gezeichnet.set(strich.id, punkte.length);
  }

  // ----- Eingabe -----------------------------------------------------------

  private stelle(event: PointerEvent): [number, number] {
    const rechteck = this.leinwand().nativeElement.getBoundingClientRect();
    return [
      (event.clientX - rechteck.left) / rechteck.width,
      (event.clientY - rechteck.top) / rechteck.height,
    ];
  }

  protected beginnen(event: PointerEvent): void {
    if (!this.darfZeichnen()) return;

    this.leinwand().nativeElement.setPointerCapture(event.pointerId);

    const [x, y] = this.stelle(event);
    this.laufend = {
      id: crypto.randomUUID(),
      farbe: this.farbe(),
      breite: this.breite(),
      punkte: [x, y],
    };

    this.striche.push(this.laufend);
    this.ungesendet = [x, y];
    this.strichZeichnen(this.laufend);
    this.sendenPlanen();
  }

  protected ziehen(event: PointerEvent): void {
    if (!this.laufend) return;

    const [x, y] = this.stelle(event);
    this.laufend.punkte.push(x, y);
    this.ungesendet.push(x, y);

    // Sofort malen, nicht erst nach dem Senden: Wer zeichnet, soll seine
    // eigene Linie ohne Umweg ueber das Netz sehen.
    this.strichZeichnen(this.laufend);
    this.sendenPlanen();
  }

  protected loslassen(): void {
    if (!this.laufend) return;
    this.absenden();
    this.laufend = null;
  }

  private sendenPlanen(): void {
    if (this.sendezeiger) return;
    this.sendezeiger = setTimeout(() => this.absenden(), SENDETAKT_MS);
  }

  private absenden(): void {
    if (this.sendezeiger) {
      clearTimeout(this.sendezeiger);
      this.sendezeiger = null;
    }

    if (!this.laufend || this.ungesendet.length === 0) return;

    this.strich.emit({
      id: this.laufend.id,
      farbe: this.laufend.farbe,
      breite: this.laufend.breite,
      punkte: this.ungesendet,
    });

    this.ungesendet = [];
  }

  /** Nimmt den zuletzt gezeichneten Strich zurueck. */
  zurueck(): void {
    this.striche.pop();
    this.gezeichnet.clear();
    this.neuZeichnen();
  }
}
