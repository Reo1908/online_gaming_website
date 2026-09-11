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
  typ: 'zahl' | 'schalter';
  min?: number;
  max?: number;
  /** Wie der Wert in der Lobby-Uebersicht dasteht. */
  anzeige?: (wert: unknown) => string;
}

export interface SpielDefinition {
  slug: string;
  felder: EinstellungsFeld[];
  /**
   * Ob die Spielleitung die Partie von Hand abpfeift.
   *
   * Der Buzzer laeuft, bis jemand "Schluss" sagt; Scribble kommt nach der
   * letzten Runde von selbst ans Ende. Danach richtet sich, ob die Lobby
   * einen Knopf "Partie beenden" zeigt -- einer, der nichts tut, waere
   * schlimmer als keiner.
   */
  manuellesEnde: boolean;
}

const janein = (wert: unknown) => (wert === true ? 'ja' : 'nein');

export const SPIELE: Record<string, SpielDefinition> = {
  buzzer: {
    slug: 'buzzer',
    manuellesEnde: true,
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
    manuellesEnde: false,
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
};

export function spielDefinition(slug: string): SpielDefinition | undefined {
  return SPIELE[slug];
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
