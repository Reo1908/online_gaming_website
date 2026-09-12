import { Component, computed, effect, input, output, signal } from '@angular/core';
import type {
  KabelPult,
  Kabelfarbe,
  Pult,
  SchachtPult,
  SymbolePult,
  ZahlenPult,
} from './typen';

/**
 * Das Pult -- die Anlage, die nur einer sieht.
 *
 * Vier Raetsel, eine Komponente: Alle vier haben dieselbe Aufgabe, naemlich
 * etwas zu zeigen, das sich nicht abschreiben laesst, und genau eine Eingabe
 * anzunehmen. Eine eigene Komponente je Raetsel haette viermal denselben
 * Rahmen gebraucht.
 *
 * Die Zweige greifen ueber schmale `computed`-Sichten statt ueber `@switch`
 * auf den Zustand zu: So weiss die Vorlage, welche Form vor ihr liegt, und
 * `strictTemplates` prueft jedes Feld mit.
 */

const FARBWERTE: Record<Kabelfarbe, string> = {
  rot: '#ef4444',
  blau: '#3b82f6',
  gruen: '#22c55e',
  gelb: '#facc15',
  weiss: '#f8fafc',
  schwarz: '#1f2937',
};

const FARBNAMEN: Record<Kabelfarbe, string> = {
  rot: 'rot',
  blau: 'blau',
  gruen: 'grün',
  gelb: 'gelb',
  weiss: 'weiß',
  schwarz: 'schwarz',
};

type Richtung = 'hoch' | 'runter' | 'links' | 'rechts';

const TASTEN: Record<string, Richtung> = {
  ArrowUp: 'hoch',
  ArrowDown: 'runter',
  ArrowLeft: 'links',
  ArrowRight: 'rechts',
  w: 'hoch',
  s: 'runter',
  a: 'links',
  d: 'rechts',
};

@Component({
  selector: 'app-pult',
  templateUrl: './pult.html',
  styleUrl: './pult.scss',
})
export class PultAnsicht {
  readonly pult = input.required<Pult>();
  /** Ausserhalb der laufenden Schleuse ist das Pult nur noch ein Bild. */
  readonly aktiv = input.required<boolean>();

  readonly eingabe = output<unknown>();

  protected readonly ziffern = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

  /** Das angetippte Kabel. Durchtrennt wird erst mit dem zweiten Klick. */
  protected readonly gewaehlt = signal<number | null>(null);
  protected readonly code = signal('');

  /**
   * Womit die Anlage gerade dasteht.
   *
   * Nach einem Fehlalarm bestueckt sich der Kasten neu und das Zahlenschloss
   * wechselt die Seriennummer. Was vorher angetippt oder getippt war, gilt
   * dann nicht mehr -- und darf nicht stehen bleiben, sonst schickt der
   * naechste Klick eine Antwort auf die vorige Frage.
   */
  private letzterStand = '';

  constructor() {
    effect(() => {
      const stand = this.stand(this.pult());
      if (stand === this.letzterStand) return;

      this.letzterStand = stand;
      this.gewaehlt.set(null);
      this.code.set('');
    });
  }

  private stand(pult: Pult): string {
    switch (pult.art) {
      case 'kabel':
        return `${pult.modul ?? ''}${pult.kabel.map((k) => `${k.farbe}${k.markiert ? '*' : ''}`).join('-')}`;
      case 'symbole':
        return pult.tasten.join('');
      case 'schacht':
        return `${pult.pos.x},${pult.pos.y}`;
      case 'zahlen':
        return `${pult.seriennummer}${pult.lampen.map((l) => (l ? 1 : 0)).join('')}`;
    }
  }

  // ----- Die vier Zweige, je als eigene Sicht ------------------------------

  protected readonly kabelPult = computed<KabelPult | null>(() => {
    const p = this.pult();
    return p.art === 'kabel' ? p : null;
  });

  protected readonly symbolePult = computed<SymbolePult | null>(() => {
    const p = this.pult();
    return p.art === 'symbole' ? p : null;
  });

  protected readonly schachtPult = computed<SchachtPult | null>(() => {
    const p = this.pult();
    return p.art === 'schacht' ? p : null;
  });

  protected readonly zahlenPult = computed<ZahlenPult | null>(() => {
    const p = this.pult();
    return p.art === 'zahlen' ? p : null;
  });

  protected farbwert(farbe: Kabelfarbe): string {
    return FARBWERTE[farbe];
  }

  protected farbname(farbe: Kabelfarbe): string {
    return FARBNAMEN[farbe];
  }

  /** Die Felder des Schachts als flache Liste -- ein Raster zeichnet sich so leichter. */
  protected readonly felder = computed(() => {
    const p = this.schachtPult();
    if (!p) return [];

    const liste: Array<{
      x: number;
      y: number;
      hier: boolean;
      ziel: boolean;
      besucht: boolean;
      alarm: boolean;
    }> = [];

    for (let y = 0; y < p.groesse; y++) {
      for (let x = 0; x < p.groesse; x++) {
        liste.push({
          x,
          y,
          hier: p.pos.x === x && p.pos.y === y,
          // Im schweren Modus fehlt die Luke ganz -- sie steht nur in den
          // Unterlagen, und der Bediener laeuft auf ein Wort zu.
          ziel: p.ziel !== null && p.ziel.x === x && p.ziel.y === y,
          besucht: p.besucht.includes(`${x},${y}`),
          // Ein Sensor, der schon angesprochen hat, ist kein Geheimnis mehr.
          alarm: p.ausgeloest.includes(`${x},${y}`),
        });
      }
    }

    return liste;
  });

  /** Die Stellen der Symbolfolge -- gedrueckte gefuellt, offene als Strich. */
  protected readonly symbolfelder = computed(() => {
    const p = this.symbolePult();
    if (!p) return [];

    return Array.from({ length: p.gesamt }, (_, i) => p.gedrueckt[i] ?? '');
  });

  /** Die Stellen des Codes als Kaestchen -- leere bleiben als Strich stehen. */
  protected readonly codefelder = computed(() => {
    const p = this.zahlenPult();
    if (!p) return [];

    return Array.from({ length: p.stellen }, (_, i) => this.code()[i] ?? '');
  });

  protected readonly codeVoll = computed(() => {
    const p = this.zahlenPult();
    return p !== null && this.code().length === p.stellen;
  });

  // ----- Handlungen --------------------------------------------------------

  protected kabelWaehlen(nr: number): void {
    if (!this.aktiv()) return;
    this.gewaehlt.update((alt) => (alt === nr ? null : nr));
  }

  protected durchtrennen(): void {
    const nr = this.gewaehlt();
    if (!this.aktiv() || nr === null) return;

    this.eingabe.emit({ kabel: nr });
    this.gewaehlt.set(null);
  }

  protected symbolDruecken(symbol: string): void {
    if (!this.aktiv()) return;
    this.eingabe.emit({ symbol });
  }

  protected schritt(richtung: Richtung): void {
    if (!this.aktiv()) return;
    this.eingabe.emit({ richtung });
  }

  /**
   * Pfeiltasten im Schacht.
   *
   * Nur auf dem Raster selbst, nicht auf der ganzen Seite: Sonst liefe der
   * Melder los, waehrend jemand einen Funkspruch tippt.
   *
   * Eine **gehaltene** Taste zaehlt als ein Schritt. Das ist nicht nur
   * schonend fuer den Server -- blind durch einen Schacht zu rennen, waehrend
   * jemand anders noch die Wand vorliest, ist genau der Fehler, den das Spiel
   * bestrafen soll.
   */
  protected taste(ereignis: KeyboardEvent): void {
    if (ereignis.repeat) return;

    const richtung = TASTEN[ereignis.key];
    if (!richtung) return;

    ereignis.preventDefault();
    this.schritt(richtung);
  }

  protected zifferTippen(ziffer: string): void {
    const p = this.zahlenPult();
    if (!this.aktiv() || !p || this.code().length >= p.stellen) return;

    this.code.update((alt) => alt + ziffer);
  }

  protected zurueck(): void {
    this.code.update((alt) => alt.slice(0, -1));
  }

  protected codePruefen(): void {
    if (!this.aktiv() || !this.codeVoll()) return;

    this.eingabe.emit({ code: this.code() });
    this.code.set('');
  }
}
