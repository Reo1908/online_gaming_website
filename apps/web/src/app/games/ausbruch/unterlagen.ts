import { Component, computed, input } from '@angular/core';
import type {
  KabelUnterlage,
  SchachtUnterlage,
  SymboleUnterlage,
  Unterlage,
  ZahlenUnterlage,
} from './typen';

/**
 * Die Unterlagen -- was die sehen, die nicht am Pult stehen.
 *
 * Jeder bekommt nur ein Stueck: ein paar Regeln, ein paar Spalten, einen
 * Streifen der Karte, eine Stelle des Codes. Die Aufteilung macht der Server,
 * hier steht nur, wie ein solches Stueck aussieht.
 *
 * Bewusst ohne einen einzigen Knopf: Wer die Unterlagen hat, redet -- er
 * bedient nicht. Ein „Passt"-Haken waere schneller als ein Satz und wuerde
 * genau das Gespraech ersetzen, um das es geht.
 */
@Component({
  selector: 'app-unterlagen',
  templateUrl: './unterlagen.html',
  styleUrl: './unterlagen.scss',
})
export class Unterlagen {
  readonly unterlage = input.required<Unterlage>();

  protected readonly kabel = computed<KabelUnterlage | null>(() => {
    const u = this.unterlage();
    return u.art === 'kabel' ? u : null;
  });

  protected readonly symbole = computed<SymboleUnterlage | null>(() => {
    const u = this.unterlage();
    return u.art === 'symbole' ? u : null;
  });

  protected readonly schacht = computed<SchachtUnterlage | null>(() => {
    const u = this.unterlage();
    return u.art === 'schacht' ? u : null;
  });

  protected readonly zahlen = computed<ZahlenUnterlage | null>(() => {
    const u = this.unterlage();
    return u.art === 'zahlen' ? u : null;
  });

  /**
   * Die Karte als flache Liste von Feldern.
   *
   * Auch die fremden Zeilen stehen darin, nur ohne Waende: Sonst waere der
   * eigene Streifen ein Bild ohne Zusammenhang, und niemand wuesste, wann der
   * Melder ueberhaupt bei ihm ankommt.
   */
  protected readonly felder = computed(() => {
    const u = this.schacht();
    if (!u) return [];

    const liste: Array<{
      x: number;
      y: number;
      meins: boolean;
      rechts: boolean;
      unten: boolean;
      hier: boolean;
      ziel: boolean;
      sensor: boolean;
      alarm: boolean;
    }> = [];

    for (let y = 0; y < u.groesse; y++) {
      const meins = y >= u.vonZeile && y <= u.bisZeile;

      for (let x = 0; x < u.groesse; x++) {
        liste.push({
          x,
          y,
          meins,
          rechts: meins && u.rechts[y - u.vonZeile][x],
          unten: meins && u.unten[y - u.vonZeile][x],
          hier: u.pos.x === x && u.pos.y === y,
          ziel: u.ziel.x === x && u.ziel.y === y,
          // Sensoren stehen nur im eigenen Abschnitt -- wer warnt, ist dafuer
          // zustaendig, und sonst warnen alle durcheinander.
          sensor: u.sensoren.includes(`${x},${y}`),
          alarm: u.ausgeloest.includes(`${x},${y}`),
        });
      }
    }

    return liste;
  });

  /** Ob der Melder gerade im eigenen Abschnitt steht -- dann bist du dran. */
  protected readonly melderBeiMir = computed(() => {
    const u = this.schacht();
    return u !== null && u.pos.y >= u.vonZeile && u.pos.y <= u.bisZeile;
  });
}
