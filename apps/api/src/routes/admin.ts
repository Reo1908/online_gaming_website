import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { requireAdmin } from '../lib/guards.js';
import { protokolliere, protokolliereMehrere } from '../lib/audit.js';

/**
 * Feldauswahl fuer jede Antwort dieser Datei.
 * `passwordHash` fehlt hier absichtlich -- so kann er auch dann nicht
 * nach aussen gelangen, wenn spaeter eine Route dazukommt.
 */
const PUBLIC_USER_FIELDS = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  isActive: true,
  isVisible: true,
  createdAt: true,
} as const;

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Benutzername muss mindestens 3 Zeichen haben')
    .max(32, 'Benutzername darf höchstens 32 Zeichen haben')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Erlaubt sind Buchstaben, Ziffern, _ und -'),
  displayName: z.string().trim().min(1).max(64),
  password: z.string().min(12, 'Passwort muss mindestens 12 Zeichen haben').max(256),
  role: z.enum(['ADMIN', 'PLAYER']).default('PLAYER'),
  // Standard ist sichtbar: ein neues Konto soll in der Rangliste auftauchen,
  // ohne dass daran gedacht werden muss.
  isVisible: z.boolean().default(true),
});

const usernameField = z
  .string()
  .trim()
  .min(3, 'Benutzername muss mindestens 3 Zeichen haben')
  .max(32, 'Benutzername darf höchstens 32 Zeichen haben')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Erlaubt sind Buchstaben, Ziffern, _ und -');

const idParamSchema = z.object({ id: z.string().uuid('Ungültige Benutzer-ID') });

/**
 * Alle Felder optional: das Formular schickt nur, was sich geaendert hat.
 * `password` leer zu lassen bedeutet "Passwort unveraendert" --
 * deshalb ist es optional und nicht etwa ein leerer String.
 */
const updateUserSchema = z
  .object({
    username: usernameField.optional(),
    displayName: z.string().trim().min(1).max(64).optional(),
    role: z.enum(['ADMIN', 'PLAYER']).optional(),
    isActive: z.boolean().optional(),
    isVisible: z.boolean().optional(),
    password: z.string().min(12, 'Passwort muss mindestens 12 Zeichen haben').max(256).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Es wurde keine Änderung übermittelt',
  });

/** Fehler mit vorgegebenem HTTP-Status, damit Regelverstoesse keine 500er werden. */
class AdminActionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Verhindert, dass der letzte handlungsfaehige Administrator verschwindet.
 * Ohne diese Pruefung koennte sich das System in einen Zustand bringen,
 * aus dem heraus niemand mehr Benutzer verwalten kann.
 */
export async function assertNotLastAdmin(
  tx: Prisma.TransactionClient,
  userId: string,
  message: string,
): Promise<void> {
  const remaining = await tx.user.count({
    where: { role: 'ADMIN', isActive: true, id: { not: userId } },
  });

  if (remaining === 0) throw new AdminActionError(409, message);
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Gilt fuer jede Route in diesem Plugin-Scope, auch fuer spaeter ergaenzte.
  app.addHook('preHandler', requireAdmin);

  /**
   * Ausfuehrlicher Systemzustand, nur fuer Administratoren.
   *
   * /api/health bleibt bewusst offen und schlank: den Endpunkt fragt der
   * Healthcheck des Containers ab, der sich nicht anmelden kann. Alles, was
   * darueber hinaus Auskunft gibt, steht hier hinter der Rollenpruefung.
   */
  app.get('/api/admin/status', async () => {
    const start = Date.now();
    let datenbankOnline = true;

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      datenbankOnline = false;
    }

    const antwortzeitMs = Date.now() - start;

    const [benutzer, aktiveSitzungen] = datenbankOnline
      ? await Promise.all([
          prisma.user.count(),
          prisma.session.count({ where: { expiresAt: { gt: new Date() } } }),
        ])
      : [null, null];

    return {
      api: {
        status: 'online' as const,
        laufzeitSekunden: Math.floor(process.uptime()),
        umgebung: process.env.NODE_ENV ?? 'development',
        nodeVersion: process.version,
      },
      datenbank: {
        status: datenbankOnline ? ('online' as const) : ('offline' as const),
        antwortzeitMs,
        benutzer,
        aktiveSitzungen,
      },
      zeitpunkt: new Date().toISOString(),
    };
  });

  app.get('/api/admin/users', async () => {
    return prisma.user.findMany({
      select: PUBLIC_USER_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
  });

  app.post('/api/admin/users', async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Ungültige Eingabe',
        details: z.flattenError(parsed.error).fieldErrors,
      });
    }

    const { username, displayName, password, role, isVisible } = parsed.data;

    try {
      const actor = request.user!;
      const user = await prisma.$transaction(async (tx) => {
        const angelegt = await tx.user.create({
          data: {
            username,
            displayName,
            passwordHash: await hashPassword(password),
            role,
            isVisible,
          },
          select: PUBLIC_USER_FIELDS,
        });

        await protokolliere(
          {
            action: 'USER_CREATED',
            actor: { id: actor.id, username: actor.username },
            target: { id: angelegt.id, username: angelegt.username },
            field: 'role',
            newValue: angelegt.role,
          },
          tx,
        );

        return angelegt;
      });

      return reply.code(201).send(user);
    } catch (error) {
      // P2002 = Unique-Verletzung. Auf die Pruefung per findUnique davor wird
      // verzichtet, weil zwischen Pruefung und Insert ein Rennen entstehen kann.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.code(409).send({ error: 'Benutzername ist bereits vergeben' });
      }
      throw error;
    }
  });

  app.patch('/api/admin/users/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Ungültige Benutzer-ID' });
    }

    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      return reply.code(400).send({
        // formErrors faengt Regeln ab, die kein einzelnes Feld betreffen
        // (etwa "gar keine Aenderung uebermittelt").
        error: flat.formErrors[0] ?? 'Ungültige Eingabe',
        details: flat.fieldErrors,
      });
    }

    const { id } = params.data;
    const { password, ...fields } = parsed.data;
    const actor = request.user!;

    // Selbstsperre abfangen, bevor ueberhaupt die Datenbank angefasst wird.
    if (id === actor.id) {
      if (fields.role === 'PLAYER') {
        return reply.code(409).send({ error: 'Du kannst dir nicht selbst die Adminrechte entziehen' });
      }
      if (fields.isActive === false) {
        return reply.code(409).send({ error: 'Du kannst dein eigenes Konto nicht deaktivieren' });
      }
    }

    try {
      const user = await prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({ where: { id }, select: { id: true, role: true } });
        if (!target) throw new AdminActionError(404, 'Benutzer nicht gefunden');

        const verliertAdminrechte =
          target.role === 'ADMIN' && (fields.role === 'PLAYER' || fields.isActive === false);

        if (verliertAdminrechte) {
          await assertNotLastAdmin(tx, id, 'Der letzte aktive Administrator kann nicht herabgestuft werden');
        }

        const vorher = await tx.user.findUniqueOrThrow({
          where: { id },
          select: PUBLIC_USER_FIELDS,
        });

        const updated = await tx.user.update({
          where: { id },
          data: {
            ...fields,
            ...(password ? { passwordHash: await hashPassword(password) } : {}),
          },
          select: PUBLIC_USER_FIELDS,
        });

        // Je geaendertem Feld ein Eintrag, damit sich der Verlauf einer
        // einzelnen Eigenschaft spaeter herausfiltern laesst.
        const geaendert = (
          ['username', 'displayName', 'role', 'isActive', 'isVisible'] as const
        ).filter((feld) => vorher[feld] !== updated[feld]);

        await protokolliereMehrere(
          geaendert.map((feld) => ({
            action: 'USER_UPDATED' as const,
            actor: { id: actor.id, username: actor.username },
            target: { id: updated.id, username: updated.username },
            field: feld,
            oldValue: vorher[feld],
            newValue: updated[feld],
          })),
          tx,
        );

        if (password) {
          // Das Passwort selbst wird niemals protokolliert -- nur, dass es
          // zurueckgesetzt wurde und von wem.
          await protokolliere(
            {
              action: 'USER_PASSWORD_RESET',
              actor: { id: actor.id, username: actor.username },
              target: { id: updated.id, username: updated.username },
            },
            tx,
          );
        }

        // Neues Passwort oder Deaktivierung muss laufende Sitzungen beenden,
        // sonst bleibt der Betroffene mit dem alten Cookie weiter angemeldet.
        if (password || fields.isActive === false) {
          await tx.session.deleteMany({ where: { userId: id } });
        }

        return updated;
      });

      return user;
    } catch (error) {
      if (error instanceof AdminActionError) {
        return reply.code(error.status).send({ error: error.message });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.code(409).send({ error: 'Benutzername ist bereits vergeben' });
      }
      throw error;
    }
  });

  app.delete('/api/admin/users/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Ungültige Benutzer-ID' });
    }

    const { id } = params.data;

    if (id === request.user!.id) {
      return reply.code(409).send({ error: 'Du kannst dein eigenes Konto nicht löschen' });
    }

    try {
      await prisma.$transaction(async (tx) => {
        const ziel = await tx.user.findUnique({
          where: { id },
          select: { id: true, role: true, username: true },
        });
        if (!ziel) throw new AdminActionError(404, 'Benutzer nicht gefunden');

        if (ziel.role === 'ADMIN') {
          await assertNotLastAdmin(tx, id, 'Der letzte aktive Administrator kann nicht gelöscht werden');
        }

        // Vor dem Loeschen schreiben: danach gibt es den Benutzer nicht mehr.
        // Der Verweis wird dabei auf leer gesetzt, der Name bleibt als
        // Momentaufnahme im Eintrag stehen.
        await protokolliere(
          {
            action: 'USER_DELETED',
            actor: { id: request.user!.id, username: request.user!.username },
            target: { id: ziel.id, username: ziel.username },
          },
          tx,
        );

        // Sessions verschwinden ueber onDelete: Cascade automatisch mit.
        await tx.user.delete({ where: { id } });
      });

      return reply.code(204).send();
    } catch (error) {
      if (error instanceof AdminActionError) {
        return reply.code(error.status).send({ error: error.message });
      }
      // P2003 = Fremdschluessel verletzt. Tritt auf, sobald der Benutzer an
      // einer Partie teilgenommen hat: MatchPlayer haengt mit Restrict daran,
      // damit abgeschlossene Partien nicht ploetzlich einen Spieler vermissen.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        return reply.code(409).send({
          error:
            'Benutzer hat an Partien teilgenommen und kann nicht gelöscht werden. ' +
            'Konto stattdessen deaktivieren.',
        });
      }
      throw error;
    }
  });
}
