import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/guards.js';

export async function leaderboardRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Rangliste ueber alle Spiele. Jeder Angemeldete darf sie sehen.
   *
   * Aufgefuehrt werden auch Spieler ohne Partie -- sonst taucht ein neues
   * Konto erst nach dem ersten Spiel auf und wirkt, als fehle es.
   */
  app.get('/api/leaderboard', { preHandler: requireAuth }, async () => {
    const benutzer = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        username: true,
        displayName: true,
        overallStat: {
          select: { matchesPlayed: true, wins: true, losses: true, draws: true, updatedAt: true },
        },
      },
    });

    const eintraege = benutzer.map((u) => {
      const s = u.overallStat;
      const partien = s?.matchesPlayed ?? 0;
      const siege = s?.wins ?? 0;

      return {
        userId: u.id,
        username: u.username,
        displayName: u.displayName,
        matchesPlayed: partien,
        wins: siege,
        losses: s?.losses ?? 0,
        draws: s?.draws ?? 0,
        // Anteil von 0 bis 1; ohne Partie bleibt er 0 statt undefiniert.
        winRate: partien > 0 ? siege / partien : 0,
        updatedAt: s?.updatedAt ?? null,
      };
    });

    // In JavaScript sortiert, weil Spieler ohne Statistik-Zeile mitkommen
    // sollen und die Siegquote nicht als Spalte in der Datenbank steht.
    eintraege.sort(
      (a, b) =>
        b.wins - a.wins ||
        b.winRate - a.winRate ||
        a.matchesPlayed - b.matchesPlayed ||
        a.displayName.localeCompare(b.displayName, 'de'),
    );

    // Gleiche Bilanz, gleicher Platz -- sonst entscheidet die Sortierung
    // willkuerlich, wer von zwei Gleichstehenden vorn liegt.
    let letzterPlatz = 0;
    let vorheriger: (typeof eintraege)[number] | null = null;

    return eintraege.map((e, i) => {
      const gleichwie =
        vorheriger !== null &&
        vorheriger.wins === e.wins &&
        vorheriger.winRate === e.winRate &&
        vorheriger.matchesPlayed === e.matchesPlayed;

      letzterPlatz = gleichwie ? letzterPlatz : i + 1;
      vorheriger = e;

      return { rank: letzterPlatz, ...e };
    });
  });
}
