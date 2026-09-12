import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import type { SpielModul } from './typen.js';
import { buzzer } from './buzzer/index.js';
import { scribble } from './scribble/index.js';
import { ausbruch } from './ausbruch/index.js';

export type { PartieInfo, SpielKontext, SpielModul, Zuschauer } from './typen.js';

/**
 * Die Spielarten, die es gibt.
 *
 * Ein neues Spiel kommt als eigener Ordner daneben und wird hier eingetragen.
 * Mehr braucht es auf der Serverseite nicht: Die Tabelle `Game` wird beim
 * Start daraus abgeglichen, die Einstellungen pruefen sich ueber das Zod-Schema
 * des Moduls, und die Socket-Schicht reicht ihm die Ereignisse durch.
 */
export const SPIELE: SpielModul[] = [buzzer, scribble, ausbruch];

export function spielart(slug: string): SpielModul | undefined {
  return SPIELE.find((s) => s.slug === slug);
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

  return { ok: true, werte: ergebnis.data as Record<string, unknown> };
}

/** Die Standardwerte einer Spielart -- die Vorgaben des Formulars. */
export function standardEinstellungen(slug: string): Record<string, unknown> {
  const art = spielart(slug);
  if (!art) return {};
  return art.einstellungen.parse({}) as Record<string, unknown>;
}

/** Raeumt den Live-Teil einer Partie in allen Spielen weg. */
export function liveVerwerfen(code: string): void {
  for (const spiel of SPIELE) spiel.verwerfen(code);
}

/**
 * Legt fehlende Spielarten an und haelt Name und Spielerzahlen aktuell.
 *
 * Bewusst keine Migration: Migrationen beschreiben die Struktur, nicht den
 * Inhalt. Als Abgleich beim Start ist es ausserdem wiederholbar und kommt
 * ohne einen zusaetzlichen Handgriff auf dem Server aus.
 */
export async function spielartenSicherstellen(): Promise<void> {
  for (const art of SPIELE) {
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
