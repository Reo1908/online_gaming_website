import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { burnTiming, verifyPassword } from '../lib/password.js';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  setSessionCookie,
} from '../lib/session.js';
import { loadUser, requireAuth } from '../lib/guards.js';

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

  // Erlaubt dem Frontend beim Start zu unterscheiden zwischen
  // "nicht eingeloggt" (null) und "Server nicht erreichbar" (Fehler).
  app.get('/api/auth/session', async (request) => {
    await loadUser(request);
    return { user: request.user };
  });
}
