import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../lib/guards.js';
import { protokolliereMehrere } from '../lib/audit.js';

const idParamSchema = z.object({ id: z.string().uuid('Ungültige Benutzer-ID') });

/** Die Zaehler, die sich von Hand korrigieren lassen. */
const ZAEHLER = ['matchesPlayed', 'wins', 'losses', 'draws'] as const;
type Zaehler = (typeof ZAEHLER)[number];

const korrekturSchema = z
  .object({
    matchesPlayed: z.number().int().min(0).max(1_000_000).optional(),
    wins: z.number().int().min(0).max(1_000_000).optional(),
    losses: z.number().int().min(0).max(1_000_000).optional(),
    draws: z.number().int().min(0).max(1_000_000).optional(),
    reason: z
      // Ohne eigene Meldung zeigt Zod hier seinen englischen Standardtext,
      // wenn das Feld ganz fehlt.
      .string({ error: 'Bitte eine Begründung angeben' })
      .trim()
      .min(3, 'Bitte eine Begründung angeben')
      .max(500, 'Begründung ist zu lang'),
  })
  .refine((d) => ZAEHLER.some((k) => d[k] !== undefined), {
    message: 'Es wurde kein Wert zum Ändern übermittelt',
  });

const NULL_BILANZ = { matchesPlayed: 0, wins: 0, losses: 0, draws: 0 };

export async function supportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  /**
   * Alles, was zur Unterstuetzung eines Benutzers gebraucht wird:
   * Konto, aktuelle Bilanz und der Verlauf der Aenderungen.
   */
  app.get('/api/admin/users/:id/support', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Ungültige Benutzer-ID' });
    }

    const user = await prisma.user.findUnique({
      where: { id: params.data.id },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        isActive: true,
        isVisible: true,
        createdAt: true,
        overallStat: {
          select: {
            matchesPlayed: true,
            wins: true,
            losses: true,
            draws: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) {
      return reply.code(404).send({ error: 'Benutzer nicht gefunden' });
    }

    const verlauf = await prisma.auditLog.findMany({
      where: { targetId: user.id },
      orderBy: { createdAt: 'desc' },
      // Begrenzt, damit ein langes Protokoll die Seite nicht lahmlegt.
      take: 100,
      select: {
        id: true,
        action: true,
        actorUsername: true,
        field: true,
        oldValue: true,
        newValue: true,
        reason: true,
        createdAt: true,
      },
    });

    const { overallStat, ...konto } = user;

    return {
      user: konto,
      // Ohne gespielte Partie gibt es keine Statistik-Zeile. Nullen sind
      // hier ehrlicher als null, weil die Bilanz sachlich bei null steht.
      stats: overallStat ?? { ...NULL_BILANZ, updatedAt: null },
      history: verlauf,
    };
  });

  /**
   * Korrigiert die Bilanz von Hand. Jede geaenderte Zahl wird einzeln
   * protokolliert, damit sich spaeter nachvollziehen laesst, wie ein Wert
   * zustande kam.
   */
  app.patch('/api/admin/users/:id/stats', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Ungültige Benutzer-ID' });
    }

    const parsed = korrekturSchema.safeParse(request.body);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      return reply.code(400).send({
        error: flat.formErrors[0] ?? 'Ungültige Eingabe',
        details: flat.fieldErrors,
      });
    }

    const { id } = params.data;
    const { reason, ...neueWerte } = parsed.data;
    const actor = request.user!;

    const ziel = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true },
    });
    if (!ziel) {
      return reply.code(404).send({ error: 'Benutzer nicht gefunden' });
    }

    const ergebnis = await prisma.$transaction(async (tx) => {
      const vorher = (await tx.overallStat.findUnique({ where: { userId: id } })) ?? NULL_BILANZ;

      const nachher = { ...NULL_BILANZ };
      for (const feld of ZAEHLER) {
        nachher[feld] = neueWerte[feld] ?? vorher[feld];
      }

      const geaendert = ZAEHLER.filter((feld) => nachher[feld] !== vorher[feld]);
      if (geaendert.length === 0) {
        // Nichts veraendert: kein Protokolleintrag, sonst fuellt sich der
        // Verlauf mit Zeilen, in denen nichts passiert ist.
        return { stats: vorher, geaendert: [] as Zaehler[] };
      }

      const stats = await tx.overallStat.upsert({
        where: { userId: id },
        update: nachher,
        // Ein Benutzer ohne gespielte Partie hat noch keine Zeile.
        create: { userId: id, ...nachher },
      });

      await protokolliereMehrere(
        geaendert.map((feld) => ({
          action: 'STAT_ADJUSTED' as const,
          actor: { id: actor.id, username: actor.username },
          target: ziel,
          field: feld,
          oldValue: vorher[feld],
          newValue: nachher[feld],
          reason,
        })),
        tx,
      );

      return { stats, geaendert };
    });

    return {
      stats: ergebnis.stats,
      geaenderteFelder: ergebnis.geaendert,
    };
  });
}
