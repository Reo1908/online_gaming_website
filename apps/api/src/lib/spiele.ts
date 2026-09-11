import { z } from 'zod';
import { prisma } from './prisma.js';

/**
 * Einstellungen des Buzzer-Spiels.
 *
 * Jede Spielart bringt eigene Schalter mit; sie landen als JSON an der Partie.
 * Der Zod-Schema-Eintrag ist zugleich die Vorlage fuer die Oberflaeche --
 * deshalb hat jedes Feld einen Standardwert.
 */
const buzzerEinstellungen = z.object({
  /// Was die Spielleitung mit einem Klick vergibt.
  punkteProTreffer: z.coerce.number().int().min(1).max(100).default(10),
  /// Wer einmal gebuzzert hat, ist in dieser Runde raus. Aus ohne Sperre
  /// koennen mehrere nacheinander drankommen.
  nurEinmalBuzzern: z.boolean().default(true),
  /// Sonst sieht nur die Spielleitung, was getippt wird. Oeffentlich ist es
  /// fuer gemeinsames Raten gedacht, nicht fuer ein Quiz.
  antwortenOeffentlich: z.boolean().default(false),
});

export type BuzzerEinstellungen = z.infer<typeof buzzerEinstellungen>;

/**
 * Die Spielarten, die es gibt. Beim Start der Anwendung werden die Zeilen in
 * der Datenbank daraus abgeglichen -- so muss auf einem frischen Server
 * niemand von Hand Spiele anlegen.
 */
export const SPIELARTEN = [
  {
    slug: 'buzzer',
    name: 'Buzzer',
    description:
      'Die Spielleitung stellt Fragen, alle anderen tippen ihre Antwort und buzzern. ' +
      'Punkte vergibt die Spielleitung.',
    minPlayers: 2,
    maxPlayers: 12,
    einstellungen: buzzerEinstellungen,
  },
] as const;

export type SpielSlug = (typeof SPIELARTEN)[number]['slug'];

export function spielart(slug: string) {
  return SPIELARTEN.find((s) => s.slug === slug);
}

/**
 * Prueft die vom Formular geschickten Einstellungen gegen die Spielart.
 * Fehlende Felder werden mit ihrem Standard aufgefuellt, unbekannte fallen
 * weg -- so kann ein veraltetes Formular keine Altlasten in die Partie tragen.
 */
export function einstellungenPruefen(
  slug: string,
  roh: unknown,
): { ok: true; werte: Record<string, unknown> } | { ok: false; fehler: string } {
  const art = spielart(slug);
  if (!art) return { ok: false, fehler: 'Unbekannte Spielart' };

  const ergebnis = art.einstellungen.safeParse(roh ?? {});
  if (!ergebnis.success) {
    return { ok: false, fehler: z.prettifyError(ergebnis.error) };
  }

  return { ok: true, werte: ergebnis.data };
}

/**
 * Legt fehlende Spielarten an und haelt Name und Spielerzahlen aktuell.
 *
 * Bewusst keine Migration: Migrationen beschreiben die Struktur, nicht den
 * Inhalt. Als Abgleich beim Start ist es ausserdem wiederholbar und kommt
 * ohne einen zusaetzlichen Handgriff auf dem Server aus.
 */
export async function spielartenSicherstellen(): Promise<void> {
  for (const art of SPIELARTEN) {
    await prisma.game.upsert({
      where: { slug: art.slug },
      update: {
        name: art.name,
        description: art.description,
        minPlayers: art.minPlayers,
        maxPlayers: art.maxPlayers,
      },
      create: {
        slug: art.slug,
        name: art.name,
        description: art.description,
        minPlayers: art.minPlayers,
        maxPlayers: art.maxPlayers,
      },
    });
  }
}
