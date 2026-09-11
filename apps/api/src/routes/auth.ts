import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { burnTiming, hashPassword, verifyPassword } from '../lib/password.js';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroyOtherSessions,
  destroySession,
  setSessionCookie,
} from '../lib/session.js';
import { loadUser, requireAuth } from '../lib/guards.js';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Aktuelles Passwort erforderlich').max(256),
    newPassword: z
      .string()
      .min(12, 'Das neue Passwort muss mindestens 12 Zeichen haben')
      .max(256),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'Das neue Passwort muss sich vom bisherigen unterscheiden',
    path: ['newPassword'],
  });

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/auth/login',
    {
      config: {
        // Deutlich strenger als global: bremst Passwort-Raten pro IP aus.
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Benutzername und Passwort erforderlich' });
      }

      const { username, password } = parsed.data;
      const user = await prisma.user.findUnique({ where: { username } });

      if (!user || !user.isActive) {
        await burnTiming();
        // Bewusst dieselbe Meldung wie bei falschem Passwort:
        // sonst verraet die Antwort, welche Benutzernamen existieren.
        return reply.code(401).send({ error: 'Benutzername oder Passwort falsch' });
      }

      if (!(await verifyPassword(user.passwordHash, password))) {
        return reply.code(401).send({ error: 'Benutzername oder Passwort falsch' });
      }

      // Alte Session verwerfen, damit ein vor dem Login untergeschobenes
      // Cookie nach dem Login nicht weitergilt (Session Fixation).
      const previous = request.cookies[SESSION_COOKIE];
      if (previous) await destroySession(previous);

      const token = await createSession(user.id);
      setSessionCookie(reply, token);

      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await destroySession(token);

    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    return request.user;
  });

  app.post(
    '/api/auth/change-password',
    {
      preHandler: requireAuth,
      config: {
        // Das aktuelle Passwort wird hier geprueft -- ohne Begrenzung waere
        // das eine bequeme Stelle, um es zu erraten.
        rateLimit: { max: 10, timeWindow: '15 minutes' },
      },
    },
    async (request, reply) => {
      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        const flat = z.flattenError(parsed.error);
        return reply.code(400).send({
          error: flat.formErrors[0] ?? 'Ungültige Eingabe',
          details: flat.fieldErrors,
        });
      }

      const { currentPassword, newPassword } = parsed.data;
      const user = request.user!;

      const record = await prisma.user.findUnique({
        where: { id: user.id },
        select: { passwordHash: true },
      });

      if (!record) {
        return reply.code(401).send({ error: 'Nicht angemeldet' });
      }

      // Das aktuelle Passwort ist Pflicht: sonst koennte jemand, der eine
      // offene Sitzung uebernimmt, den rechtmaessigen Besitzer aussperren.
      if (!(await verifyPassword(record.passwordHash, currentPassword))) {
        return reply.code(401).send({ error: 'Aktuelles Passwort ist falsch' });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(newPassword) },
      });

      // Eigene Sitzung bleibt bestehen, alle anderen Geraete fliegen raus.
      const token = request.cookies[SESSION_COOKIE]!;
      const beendet = await destroyOtherSessions(user.id, token);

      return { abgemeldeteGeraete: beendet };
    },
  );

  // Erlaubt dem Frontend beim Start zu unterscheiden zwischen
  // "nicht eingeloggt" (null) und "Server nicht erreichbar" (Fehler).
  app.get('/api/auth/session', async (request) => {
    await loadUser(request);
    return { user: request.user };
  });
}
