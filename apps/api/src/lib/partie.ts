import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { spielart } from '../games/index.js';
import type { PartieInfo } from '../games/index.js';

/**
 * Alles, was die Oberflaeche ueber eine Partie wissen muss. Der Live-Teil
 * (Zeichnung, Buzzer-Reihenfolge, getippter Text) kommt ueber die
 * Socket-Verbindung -- hier steht nur, was die Datenbank haelt.
 */
export const PARTIE_AUSWAHL = {
  id: true,
  code: true,
  name: true,
  status: true,
  settings: true,
  visibility: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  game: { select: { slug: true, name: true, minPlayers: true, maxPlayers: true } },
  tags: {
    select: { tag: { select: { slug: true, name: true, color: true } } },
  },
  players: {
    select: {
      userId: true,
      isGamemaster: true,
      isPlaying: true,
      score: true,
      result: true,
      placement: true,
      joinedAt: true,
      user: { select: { displayName: true, username: true } },
    },
    orderBy: { joinedAt: 'asc' },
  },
} satisfies Prisma.MatchSelect;

export type PartieRoh = Prisma.MatchGetPayload<{ select: typeof PARTIE_AUSWAHL }>;

export function partieNachAussen(partie: PartieRoh) {
  return {
    id: partie.id,
    code: partie.code,
    name: partie.name,
    status: partie.status,
    settings: (partie.settings ?? {}) as Record<string, unknown>,
    oeffentlich: partie.visibility === 'PUBLIC',
    spiel: partie.game,
    etiketten: partie.tags.map((t) => ({
      slug: t.tag.slug,
      name: t.tag.name,
      farbe: t.tag.color,
    })),
    createdAt: partie.createdAt,
    startedAt: partie.startedAt,
    finishedAt: partie.finishedAt,
    teilnehmer: partie.players.map((p) => ({
      userId: p.userId,
      displayName: p.user.displayName,
      username: p.user.username,
      istLeitung: p.isGamemaster,
      spieltMit: p.isPlaying,
      punkte: p.score ?? 0,
      ergebnis: p.result,
      platz: p.placement,
    })),
  };
}

/**
 * Die Partie, wie ein Spielmodul sie sieht.
 *
 * `verbunden` kommt von aussen: Wer gerade online ist, weiss nur die
 * Socket-Schicht -- in der Datenbank steht das nicht und soll es auch nicht.
 */
export async function partieInfoLaden(
  code: string,
  verbunden: (userId: string) => boolean,
): Promise<PartieInfo | null> {
  const partie = await prisma.match.findUnique({ where: { code }, select: PARTIE_AUSWAHL });
  if (!partie) return null;

  const teilnehmer = partie.players.map((p) => ({
    userId: p.userId,
    displayName: p.user.displayName,
    istLeitung: p.isGamemaster,
    spieltMit: p.isPlaying,
    punkte: p.score ?? 0,
    verbunden: verbunden(p.userId),
  }));

  return {
    id: partie.id,
    code: partie.code,
    name: partie.name,
    status: partie.status,
    oeffentlich: partie.visibility === 'PUBLIC',
    spiel: { slug: partie.game.slug, name: partie.game.name },
    einstellungen: (partie.settings ?? {}) as Record<string, unknown>,
    etiketten: partie.tags.map((t) => ({
      slug: t.tag.slug,
      name: t.tag.name,
      farbe: t.tag.color,
    })),
    teilnehmer,
    spieler: teilnehmer.filter((t) => t.spieltMit),
  };
}

/**
 * Die Woerter aus den Themengebieten einer Partie, gemischt.
 *
 * Ohne Auswahl zaehlt alles, was aktiv ist: Eine Lobby ohne Etikett soll
 * spielbar sein, nicht wortlos.
 */
export async function woerterZurPartie(code: string): Promise<string[]> {
  const partie = await prisma.match.findUnique({
    where: { code },
    select: { tags: { select: { tagId: true } } },
  });
  if (!partie) return [];

  const tagIds = partie.tags.map((t) => t.tagId);

  const woerter = await prisma.tagWord.findMany({
    where:
      tagIds.length > 0
        ? { tagId: { in: tagIds }, tag: { isActive: true } }
        : { tag: { isActive: true } },
    select: { text: true },
  });

  // Doppelte fallen weg: dasselbe Wort kann in zwei Gebieten stehen, und dann
  // zoege Scribble es doppelt so haeufig.
  return [...new Set(woerter.map((w) => w.text))];
}

/**
 * Schreibt die Ergebnisse fest und zaehlt die Bilanzen hoch.
 *
 * Gewertet wird, wer mitspielt -- die Buzzer-Spielleitung also nicht. Und
 * gewertet wird erst ab zwei Mitspielenden: sonst gewaenne ein einzelner
 * Spieler jede Partie gegen sich selbst und die Rangliste waere nichts wert.
 *
 * Zwei Wertungen, je nach Spielart: Im Wettkampf gewinnt die hoechste
 * Punktzahl. Bei einer Spielart mit `gemeinsameWertung` bekommen alle
 * dasselbe -- dort haben ohnehin alle dieselben Punkte, und die Frage ist
 * nicht, wer vorn liegt, sondern ob die Runde es geschafft hat. Ohne Angabe
 * (die Leitung pfeift von Hand ab) steht es fuer alle unentschieden.
 */
export async function ergebnisseFestschreiben(
  tx: Prisma.TransactionClient,
  partieId: string,
  gemeinsam?: { erfolg: boolean | undefined },
): Promise<{ gewertet: boolean }> {
  const spieler = await tx.matchPlayer.findMany({
    where: { matchId: partieId, isPlaying: true },
    select: { id: true, userId: true, score: true },
  });

  if (spieler.length < 2) return { gewertet: false };

  const sortiert = [...spieler].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const hoechste = sortiert[0].score ?? 0;
  // Gleichstand an der Spitze ist ein Unentschieden fuer alle Beteiligten.
  const anDerSpitze = sortiert.filter((s) => (s.score ?? 0) === hoechste).length;

  const zusammen = gemeinsam
    ? gemeinsam.erfolg === undefined
      ? ('DRAW' as const)
      : gemeinsam.erfolg
        ? ('WIN' as const)
        : ('LOSS' as const)
    : null;

  for (const eintrag of sortiert) {
    const punkte = eintrag.score ?? 0;
    const ergebnis =
      zusammen ?? (punkte === hoechste ? (anDerSpitze > 1 ? 'DRAW' : 'WIN') : 'LOSS');

    // Gleiche Punktzahl, gleicher Platz -- sonst entscheidet die Sortierung
    // willkuerlich, wer von zwei Gleichstehenden vorn liegt.
    const platz = sortiert.findIndex((s) => (s.score ?? 0) === punkte) + 1;

    await tx.matchPlayer.update({
      where: { id: eintrag.id },
      data: { result: ergebnis, placement: platz },
    });

    const zaehler = {
      wins: ergebnis === 'WIN' ? 1 : 0,
      losses: ergebnis === 'LOSS' ? 1 : 0,
      draws: ergebnis === 'DRAW' ? 1 : 0,
    };

    await tx.overallStat.upsert({
      where: { userId: eintrag.userId },
      update: {
        matchesPlayed: { increment: 1 },
        wins: { increment: zaehler.wins },
        losses: { increment: zaehler.losses },
        draws: { increment: zaehler.draws },
      },
      create: { userId: eintrag.userId, matchesPlayed: 1, ...zaehler },
    });
  }

  return { gewertet: true };
}

/**
 * Beendet eine laufende Partie regulaer.
 *
 * Drei Wege fuehren hierher: die Spielleitung beim Buzzer, die von Hand
 * abpfeift, Scribble, das nach der letzten Runde von selbst ankommt, und der
 * Ausbruch, der am Ende sagt, ob die Runde draussen ist. Deshalb liegt der
 * Ablauf hier und nicht in der Route.
 *
 * Absichtlich ohne Socket-Aufruf: Wer die Partie schliesst, schickt danach
 * selbst. Sonst muessten sich diese Datei und die Socket-Schicht gegenseitig
 * einbinden.
 */
export async function partieAbschliessen(
  code: string,
  erfolg?: boolean,
): Promise<{ partie: PartieRoh; gewertet: boolean } | null> {
  return prisma.$transaction(async (tx) => {
    const aktuell = await tx.match.findUnique({
      where: { code },
      select: { id: true, status: true, game: { select: { slug: true } } },
    });
    // Schon vorbei -- etwa weil die Leitung eine Sekunde vor der letzten Runde
    // abgebrochen hat. Kein Fehler, nur nichts mehr zu tun.
    if (!aktuell || aktuell.status !== 'RUNNING') return null;

    // Ob gemeinsam gewertet wird, sagt die Spielart -- nicht der Aufrufer.
    // Sonst haenge es davon ab, ueber welchen der drei Wege die Partie endet.
    const zusammen = spielart(aktuell.game.slug)?.gemeinsameWertung === true;

    const { gewertet } = await ergebnisseFestschreiben(
      tx,
      aktuell.id,
      zusammen ? { erfolg } : undefined,
    );

    await tx.match.update({
      where: { id: aktuell.id },
      data: { status: 'FINISHED', finishedAt: new Date() },
    });

    const fertig = await tx.match.findUniqueOrThrow({
      where: { id: aktuell.id },
      select: PARTIE_AUSWAHL,
    });

    return { partie: fertig, gewertet };
  });
}
