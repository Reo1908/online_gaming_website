/**
 * Was die Oberflaeche ueber eine Spielart wissen muss, bevor die Partie laeuft.
 *
 * Die Felder stehen hier als Beschreibung statt als Formular: Aus derselben
 * Liste baut der Dialog "Lobby erstellen" seine Eingaben und die Lobby ihre
 * Uebersicht. Ohne das muesste jede neue Spielart an zwei Stellen von Hand
 * nachgetragen werden -- und die zweite vergisst man.
 *
 * Die Standardwerte stehen bewusst nicht hier, sondern kommen mit
 * `/api/games` aus dem Zod-Schema des Servers. So gibt es genau eine Quelle.
 */
export interface EinstellungsFeld {
  key: string;
  label: string;
  /** Erklaerung unter dem Feld. */
  hilfe?: string;
  typ: 'zahl' | 'schalter' | 'auswahl';
  min?: number;
  max?: number;
  /**
   * Nur bei `auswahl`: die Moeglichkeiten in der Reihenfolge der Anzeige.
   *
   * Als Knopfreihe statt als Klappliste gedacht -- bei zwei oder drei
   * Moeglichkeiten steht damit beides zugleich da, samt der Zeile darunter,
   * die sagt, was der Unterschied ist. Eine Klappliste zeigt immer nur eine.
   */
  optionen?: Array<{ wert: string; label: string; hilfe?: string }>;
  /** Wie der Wert in der Lobby-Uebersicht dasteht. */
  anzeige?: (wert: unknown) => string;
}

export interface SpielDefinition {
  slug: string;
  felder: EinstellungsFeld[];

  /**
   * Das Zeichen in der Spielauswahl (ein PrimeIcon ohne das `pi-` davor).
   *
   * Steht hier und nicht in der Datenbank: Es ist eine Frage der Darstellung,
   * keine des Spiels. Der Server wuesste damit nichts anzufangen.
   */
  icon: string;

  /**
   * Ob gegeneinander oder zusammen gespielt wird.
   *
   * Der wichtigste Unterschied zwischen zwei Spielen, sobald es mehr als eine
   * Handvoll gibt: Wer eine Runde sucht, sucht zuerst danach -- und beim
   * Ausbruch haengt daran sogar die Wertung.
   */
  art: 'gegeneinander' | 'zusammen';

  /**
   * Ab wie vielen Mitspielenden es losgeht.
   *
   * Dasselbe wie `minZumStart` im Spielmodul des Servers -- dort wird es
   * durchgesetzt, hier steht nur, wann der Startknopf aufwacht. Es haengt
   * bewusst nicht an `Game.minPlayers` aus der Datenbank: Der Buzzer laesst
   * sich zum Ausprobieren mit einer Person starten, obwohl er zu zweit
   * gedacht ist.
   */
  minSpieler: number;

  /**
   * Ob die Spielleitung die Partie von Hand abpfeift.
   *
   * Der Buzzer laeuft, bis jemand "Schluss" sagt; Scribble kommt nach der
   * letzten Runde von selbst ans Ende. Danach richtet sich, ob die Lobby
   * einen Knopf "Partie beenden" zeigt -- einer, der nichts tut, waere
   * schlimmer als keiner.
   */
  manuellesEnde: boolean;

  /**
   * Ob die Spielart mit Themen arbeitet.
   *
   * Nur Scribble zieht Woerter daraus. Am Buzzer waeren Themen ein Etikett
   * ohne Wirkung -- und ein Schalter, der nichts tut, ist schlimmer als
   * keiner. Der Server lehnt sie fuer solche Spiele ohnehin ab; hier steht,
   * ob die Auswahl ueberhaupt erscheint.
   */
  nutztThemen: boolean;

  /**
   * Ob die Spielart die ganze Seitenbreite nimmt und ihren eigenen Kopf
   * mitbringt.
   *
   * Scribble baut sich eine Buehne, die aus der 960-px-Spalte ausbricht und
   * Runde, Wort und Restzeit selbst anzeigt. Der Seitenkopf darueber stuende
   * dann eingerueckt daneben und wiederholte nur, was die Buehne schon sagt --
   * also bleibt er waehrend des Spiels weg.
   */
  volleBreite: boolean;
}

const janein = (wert: unknown) => (wert === true ? 'ja' : 'nein');

export const SPIELE: Record<string, SpielDefinition> = {
  buzzer: {
    slug: 'buzzer',
    icon: 'bolt',
    art: 'gegeneinander',
    minSpieler: 1,
    manuellesEnde: true,
    nutztThemen: false,
    volleBreite: false,
    felder: [
      {
        key: 'punkteProTreffer',
        label: 'Punkte pro Treffer',
        hilfe: 'So viel vergibt ein Klick auf „+" im Spiel',
        typ: 'zahl',
        min: 1,
        max: 100,
      },
      {
        key: 'nurEinmalBuzzern',
        label: 'Nur einmal buzzern je Runde',
        hilfe: 'Wer gedrückt hat, ist bis zur nächsten Frage raus',
        typ: 'schalter',
        anzeige: (wert) => (wert === false ? 'beliebig oft' : 'einmal je Runde'),
      },
      {
        key: 'antwortenOeffentlich',
        label: 'Antworten für alle sichtbar',
        hilfe: 'Ohne Haken sieht nur die Spielleitung, was getippt wird',
        typ: 'schalter',
        anzeige: (wert) => (wert === true ? 'für alle sichtbar' : 'nur für die Leitung'),
      },
    ],
  },

  scribble: {
    slug: 'scribble',
    icon: 'pencil',
    art: 'gegeneinander',
    minSpieler: 2,
    manuellesEnde: false,
    nutztThemen: true,
    volleBreite: true,
    felder: [
      {
        key: 'runden',
        label: 'Runden',
        hilfe: 'Eine Runde ist durch, wenn jeder einmal gezeichnet hat',
        typ: 'zahl',
        min: 1,
        max: 6,
      },
      {
        key: 'zeitProZug',
        label: 'Sekunden pro Zug',
        hilfe: 'So lange hat der Zeichner Zeit',
        typ: 'zahl',
        min: 30,
        max: 180,
        anzeige: (wert) => `${wert} s`,
      },
      {
        key: 'punkteBasis',
        label: 'Punkte für den Ersten',
        hilfe: 'Wer später errät, bekommt gestaffelt weniger',
        typ: 'zahl',
        min: 10,
        max: 200,
      },
      {
        key: 'hinweise',
        label: 'Buchstaben aufdecken',
        hilfe: 'Deckt in der zweiten Hälfte eines Zuges einzelne Buchstaben auf',
        typ: 'schalter',
        anzeige: janein,
      },
    ],
  },

  ausbruch: {
    slug: 'ausbruch',
    icon: 'key',
    art: 'zusammen',
    minSpieler: 2,
    manuellesEnde: false,
    nutztThemen: false,
    volleBreite: true,
    felder: [
      {
        key: 'schwierigkeit',
        label: 'Schwierigkeit',
        typ: 'auswahl',
        optionen: [
          {
            wert: 'normal',
            label: 'Normal',
            hilfe: 'Zum Kennenlernen: Regeln zum Vorlesen, Zeichen zum Beschreiben.',
          },
          {
            wert: 'schwer',
            label: 'Schwer',
            hilfe:
              'Andere Rätsel, nicht nur mehr davon: Zeichen aus einer einzigen Familie, ' +
              'Sensoren im Schacht, eine unsichtbare Luke und Codestellen, die voneinander abhängen.',
          },
        ],
        anzeige: (wert) => (wert === 'schwer' ? 'schwer' : 'normal'),
      },
      {
        key: 'schleusen',
        label: 'Schleusen',
        hilfe: 'So viele Rätsel liegen zwischen euch und draußen',
        typ: 'zahl',
        min: 3,
        max: 8,
      },
      {
        key: 'zeitJeSchleuse',
        label: 'Sekunden je Schleuse',
        hilfe: 'Alle zusammen ergeben ein Zeitkonto — wer schnell ist, spart für später',
        typ: 'zahl',
        min: 45,
        max: 240,
        anzeige: (wert) => `${wert} s je Schleuse`,
      },
      {
        key: 'strafe',
        label: 'Strafe je Fehlalarm',
        hilfe: 'So viele Sekunden kostet ein falscher Griff',
        typ: 'zahl',
        min: 0,
        max: 60,
        anzeige: (wert) => `${wert} s`,
      },
      {
        key: 'rollentausch',
        label: 'Bedienung wechselt',
        hilfe: 'Nach jeder Schleuse steht jemand anderes am Pult',
        typ: 'schalter',
        anzeige: (wert) => (wert === false ? 'immer dieselbe Person' : 'nach jeder Schleuse'),
      },
      {
        key: 'funkSperre',
        label: 'Funkpause',
        hilfe: 'Sekunden zwischen zwei Funksprüchen. Haltet euch kurz — oder redet nebenbei',
        typ: 'zahl',
        min: 0,
        max: 10,
        anzeige: (wert) => (Number(wert) > 0 ? `${wert} s zwischen zwei Sprüchen` : 'ohne Pause'),
      },
    ],
  },
};

export function spielDefinition(slug: string): SpielDefinition | undefined {
  return SPIELE[slug];
}

export function nutztThemen(slug: string): boolean {
  return spielDefinition(slug)?.nutztThemen ?? false;
}

/** Ab wie vielen Mitspielenden eine Partie dieser Art startet. */
export function minSpieler(slug: string): number {
  return spielDefinition(slug)?.minSpieler ?? 1;
}

/** Die Einstellungen einer Partie als Liste fuer die Lobby-Uebersicht. */
export function einstellungenLesbar(
  slug: string,
  werte: Record<string, unknown>,
): Array<{ label: string; wert: string }> {
  return (spielDefinition(slug)?.felder ?? []).map((feld) => ({
    label: feld.label,
    wert: feld.anzeige ? feld.anzeige(werte[feld.key]) : String(werte[feld.key] ?? '—'),
  }));
}
