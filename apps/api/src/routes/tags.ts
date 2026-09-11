import type { FastifyInstance, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../lib/guards.js';
import { slugAus } from '../lib/etiketten.js';

/**
 * Die Themengebiete in der Verwaltung.
 *
 * Sie sind der Wortvorrat von Scribble und zugleich das Etikett, an dem man
 * in der Lobbyliste erkennt, worum es geht. Wer sie anlegen darf, legt damit
 * fest, was gespielt wird -- deshalb nur Administratoren.
 */

const MAX_WOERTER = 500;

const woerterFeld = z
  .array(z.string().trim().min(1, 'Leere Wörter gehen nicht').max(64))
  .max(MAX_WOERTER, `Höchstens ${MAX_WOERTER} Wörter je Thema`);

const farbeFeld = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Farbe muss ein Hex-Wert wie #4f8ef7 sein')
  .nullish();

const anlegenSchema = z.object({
  name: z.string().trim().min(2, 'Name muss mindestens 2 Zeichen haben').max(48),
  color: farbeFeld,
  woerter: woerterFeld.default([]),
});

const aendernSchema = z
  .object({
    name: z.string().trim().min(2).max(48).optional(),
    color: farbeFeld,
    isActive: z.boolean().optional(),
    woerter: woerterFeld.optional(),
  })
  .refine((daten) => Object.keys(daten).length > 0, {
    message: 'Es wurde keine Änderung übermittelt',
  });

const idParamSchema = z.object({ id: z.string().uuid('Ungültige Themen-ID') });

class EtikettFehler extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function alsAntwort(error: unknown, reply: FastifyReply) {
  if (error instanceof EtikettFehler) {
    return reply.code(error.status).send({ error: error.message });
  }

  // P2002 = eindeutiger Schluessel verletzt. Zwei Themen mit demselben Namen
  // ergaeben dieselbe Kurzform und waeren in der Lobby nicht zu unterscheiden.
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return reply.code(409).send({ error: 'Ein Thema mit diesem Namen gibt es schon' });
  }

  throw error;
}

/**
 * Doppelte Woerter fallen weg, die Reihenfolge bleibt.
 * Verglichen wird ohne Ruecksicht auf Gross- und Kleinschreibung: "Pikachu"
 * und "pikachu" sind im Spiel dasselbe Wort.
 */
function woerterOrdnen(woerter: string[]): string[] {
  const gesehen = new Set<string>();
  const ergebnis: string[] = [];

  for (const wort of woerter) {
    const schluessel = wort.toLowerCase();
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    ergebnis.push(wort);
  }

  return ergebnis;
}

const ETIKETT_AUSWAHL = {
  id: true,
  slug: true,
  name: true,
  color: true,
  isActive: true,
  createdAt: true,
  words: { select: { text: true }, orderBy: { text: 'asc' } },
} satisfies Prisma.TagSelect;

type EtikettRoh = Prisma.TagGetPayload<{ select: typeof ETIKETT_AUSWAHL }>;

function nachAussen(etikett: EtikettRoh) {
  return {
    id: etikett.id,
    slug: etikett.slug,
    name: etikett.name,
    farbe: etikett.color,
    isActive: etikett.isActive,
    createdAt: etikett.createdAt,
    woerter: etikett.words.map((w) => w.text),
  };
}

export async function tagRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  app.get('/api/admin/tags', async () => {
    const etiketten = await prisma.tag.findMany({
      select: ETIKETT_AUSWAHL,
      orderBy: { name: 'asc' },
    });

    return etiketten.map(nachAussen);
  });

  app.post('/api/admin/tags', async (request, reply) => {
    const parsed = anlegenSchema.safeParse(request.body);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      return reply.code(400).send({
        error:
          flat.formErrors[0] ?? Object.values(flat.fieldErrors).flat()[0] ?? 'Ungültige Eingabe',
      });
    }

    const { name, color, woerter } = parsed.data;
    const slug = slugAus(name);
    if (!slug) return reply.code(400).send({ error: 'Aus diesem Namen lässt sich keine Kurzform bilden' });

    try {
      const angelegt = await prisma.tag.create({
        data: {
          slug,
          name,
          color: color ?? null,
          words: { create: woerterOrdnen(woerter).map((text) => ({ text })) },
        },
        select: ETIKETT_AUSWAHL,
      });

      return reply.code(201).send(nachAussen(angelegt));
    } catch (error) {
      return alsAntwort(error, reply);
    }
  });

  app.patch('/api/admin/tags/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Ungültige Themen-ID' });

    const parsed = aendernSchema.safeParse(request.body);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      return reply.code(400).send({
        error:
          flat.formErrors[0] ?? Object.values(flat.fieldErrors).flat()[0] ?? 'Ungültige Eingabe',
      });
    }

    const { name, color, isActive, woerter } = parsed.data;

    try {
      const geaendert = await prisma.$transaction(async (tx) => {
        const vorhanden = await tx.tag.findUnique({ where: { id: params.data.id } });
        if (!vorhanden) throw new EtikettFehler(404, 'Thema nicht gefunden');

        if (woerter) {
          // Ersetzen statt abgleichen: Die Liste kommt als Ganzes aus dem
          // Textfeld, und was nicht mehr drinsteht, soll auch weg sein.
          await tx.tagWord.deleteMany({ where: { tagId: vorhanden.id } });
          await tx.tagWord.createMany({
            data: woerterOrdnen(woerter).map((text) => ({ tagId: vorhanden.id, text })),
          });
        }

        return tx.tag.update({
          where: { id: vorhanden.id },
          data: {
            ...(name !== undefined ? { name, slug: slugAus(name) } : {}),
            ...(color !== undefined ? { color: color ?? null } : {}),
            ...(isActive !== undefined ? { isActive } : {}),
          },
          select: ETIKETT_AUSWAHL,
        });
      });

      return nachAussen(geaendert);
    } catch (error) {
      return alsAntwort(error, reply);
    }
  });

  app.delete('/api/admin/tags/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Ungültige Themen-ID' });

    try {
      const benutzt = await prisma.matchTag.count({ where: { tagId: params.data.id } });
      if (benutzt > 0) {
        // Dieselbe Ueberlegung wie beim Benutzer, der schon gespielt hat:
        // Loeschen liesse in der Historie ein Thema ohne Namen zurueck.
        throw new EtikettFehler(
          409,
          'Dieses Thema hängt an bestehenden Partien und kann nicht gelöscht werden. ' +
            'Stattdessen deaktivieren.',
        );
      }

      await prisma.tag.delete({ where: { id: params.data.id } });
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.code(404).send({ error: 'Thema nicht gefunden' });
      }
      return alsAntwort(error, reply);
    }
  });
}
