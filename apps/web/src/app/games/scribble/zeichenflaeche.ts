import {
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { fuellen } from './fuellen';

export type Malart = 'strich' | 'fuellung';

/**
 * Ein Malzug in normierten Koordinaten (0..1), abwechselnd x und y.
 *
 * Ein `strich` sammelt seine Punkte ueber die Zeit, eine `fuellung` hat genau
 * einen: die Stelle, an der der Eimer ausgekippt wurde. Beide stehen in
 * derselben Liste, weil ihre Reihenfolge zaehlt.
 */
export interface Malzug {
  id: string;
  art: Malart;
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
 * Haelt ihre Malzuege selbst und zeichnet neue Punkte einzeln nach, statt bei
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
      [class.malend]="darfZeichnen()"
      [class.eimer]="darfZeichnen() && werkzeug() === 'fuellung'"
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
      height: 100%;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
      background: #fff;
      touch-action: none;
      cursor: default;
      border-radius: inherit;
    }

    canvas.malend {
      cursor: crosshair;
    }

    /* Der Eimer bekommt einen eigenen Zeiger: Beim Fuellen entscheidet ein
       einzelner Klick ueber die halbe Flaeche, und man will vorher wissen,
       dass man nicht im Stiftmodus ist. */
    canvas.eimer {
      cursor: cell;
    }
  `,
})
export class Zeichenflaeche implements OnDestroy {
  private readonly leinwand = viewChild.required<ElementRef<HTMLCanvasElement>>('leinwand');

  readonly darfZeichnen = input(false);
  readonly werkzeug = input<Malart>('strich');
  readonly farbe = input('#111827');
  readonly breite = input(4);

  /** Neue Punkte eines Malzugs, fertig zum Verschicken. */
  readonly malzug = output<Malzug>();

  private zuege: Malzug[] = [];
  private laufend: Malzug | null = null;
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

  /** Setzt die ganze Zeichnung neu -- beim Betreten, nach Leeren und Zurück. */
  setzen(zuege: Malzug[]): void {
    this.zuege = zuege.map((z) => ({ ...z, art: z.art ?? 'strich', punkte: [...z.punkte] }));
    this.gezeichnet.clear();
    this.neuZeichnen();
  }

  /**
   * Ergaenzt einen Strich um neue Punkte und malt nur diese nach, oder fuehrt
   * eine Fuellung aus. Kennt sie den Malzug noch nicht, legt sie ihn an.
   */
  ergaenzen(teil: Malzug): void {
    const art = teil.art ?? 'strich';

    if (art === 'fuellung') {
      this.zuege.push({ ...teil, art, punkte: [...teil.punkte] });
      this.fuellungAusfuehren(teil);
      return;
    }

    const vorhanden = this.zuege.find((z) => z.id === teil.id);
    if (vorhanden) vorhanden.punkte.push(...teil.punkte);
    else this.zuege.push({ ...teil, art, punkte: [...teil.punkte] });

    this.strichZeichnen(this.zuege.find((z) => z.id === teil.id)!);
  }

  leeren(): void {
    this.setzen([]);
  }

  /** Nimmt den zuletzt gezeichneten Malzug zurueck. */
  zurueck(): void {
    this.zuege.pop();
    this.gezeichnet.clear();
    this.neuZeichnen();
  }

  // ----- Zeichnen ----------------------------------------------------------

  private kontext(): CanvasRenderingContext2D | null {
    // willReadFrequently: Der Farbeimer liest die Leinwand aus. Ohne den
    // Hinweis haelt der Browser sie auf der Grafikkarte und muss sie fuer
    // jedes Fuellen zurueckholen -- das kostet spuerbar.
    return this.leinwand().nativeElement.getContext('2d', { willReadFrequently: true });
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
    if (rechteck.width === 0 || rechteck.height === 0) return;

    // Bei einer sehr grossen Flaeche auf einem Bildschirm mit hoher Dichte
    // wird das Fuellen sonst traege: Es laeuft ueber jedes einzelne Pixel.
    const dichte = Math.min(window.devicePixelRatio || 1, 2);
    element.width = Math.round(rechteck.width * dichte);
    element.height = Math.round(rechteck.height * dichte);

    this.gezeichnet.clear();
    this.neuZeichnen();
  }

  private neuZeichnen(): void {
    const ctx = this.kontext();
    const element = this.leinwand().nativeElement;
    if (!ctx) return;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, element.width, element.height);

    // In der Reihenfolge, in der gemalt wurde: Eine Fuellung deckt zu, was
    // vor ihr lag, und liegt unter allem, was danach kam.
    for (const zug of this.zuege) {
      if (zug.art === 'fuellung') this.fuellungAusfuehren(zug);
      else this.strichZeichnen(zug);
    }
  }

  private fuellungAusfuehren(zug: Malzug): void {
    const ctx = this.kontext();
    const element = this.leinwand().nativeElement;
    if (!ctx || zug.punkte.length < 2) return;

    fuellen(
      ctx,
      element.width,
      element.height,
      zug.punkte[0] * element.width,
      zug.punkte[1] * element.height,
      zug.farbe,
    );
  }

  /** Malt nur den Teil eines Strichs, der noch nicht auf der Leinwand steht. */
  private strichZeichnen(strich: Malzug): void {
    const ctx = this.kontext();
    const element = this.leinwand().nativeElement;
    if (!ctx) return;

    const punkte = strich.punkte;
    const fertig = this.gezeichnet.get(strich.id) ?? 0;
    if (punkte.length < 2 || fertig >= punkte.length) return;

    const dichte = Math.min(window.devicePixelRatio || 1, 2);
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

    const [x, y] = this.stelle(event);

    // Der Eimer ist ein einzelner Klick, kein Zug: Er wird sofort ausgefuehrt
    // und verschickt, und danach gibt es nichts mehr zu sammeln.
    if (this.werkzeug() === 'fuellung') {
      const zug: Malzug = {
        id: crypto.randomUUID(),
        art: 'fuellung',
        farbe: this.farbe(),
        breite: this.breite(),
        punkte: [x, y],
      };

      this.zuege.push(zug);
      this.fuellungAusfuehren(zug);
      this.malzug.emit(zug);
      return;
    }

    this.leinwand().nativeElement.setPointerCapture(event.pointerId);

    this.laufend = {
      id: crypto.randomUUID(),
      art: 'strich',
      farbe: this.farbe(),
      breite: this.breite(),
      punkte: [x, y],
    };

    this.zuege.push(this.laufend);
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

    this.malzug.emit({
      id: this.laufend.id,
      art: 'strich',
      farbe: this.laufend.farbe,
      breite: this.laufend.breite,
      punkte: this.ungesendet,
    });

    this.ungesendet = [];
  }
}
