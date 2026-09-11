import type { AuditAction, Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

type Akteur = { id: string; username: string } | null;
type Betroffener = { id: string; username: string };

interface Eintrag {
  action: AuditAction;
  actor: Akteur;
  target: Betroffener;
  field?: string;
  oldValue?: string | number | boolean | null;
  newValue?: string | number | boolean | null;
  reason?: string;
}

function alsText(wert: string | number | boolean | null | undefined): string | null {
  return wert === null || wert === undefined ? null : String(wert);
}

/**
 * Schreibt einen Protokolleintrag.
 *
 * `tx` mitgeben, wenn die protokollierte Aenderung selbst in einer
 * Transaktion laeuft -- sonst bliebe der Eintrag stehen, obwohl die
 * Aenderung zurueckgerollt wurde.
 */
export async function protokolliere(
  eintrag: Eintrag,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      action: eintrag.action,
      actorId: eintrag.actor?.id ?? null,
      actorUsername: eintrag.actor?.username ?? null,
      targetId: eintrag.target.id,
      targetUsername: eintrag.target.username,
      field: eintrag.field ?? null,
      oldValue: alsText(eintrag.oldValue),
      newValue: alsText(eintrag.newValue),
      reason: eintrag.reason ?? null,
    },
  });
}

/**
 * Schreibt mehrere Eintraege auf einmal -- etwa wenn eine Korrektur
 * gleichzeitig Siege und Niederlagen aendert. Je Feld ein Eintrag, damit
 * sich der Verlauf einer einzelnen Zahl spaeter herausfiltern laesst.
 */
export async function protokolliereMehrere(
  eintraege: Eintrag[],
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  for (const eintrag of eintraege) {
    await protokolliere(eintrag, tx);
  }
}
