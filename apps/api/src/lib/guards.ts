import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, resolveSession, type SessionUser } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

/**
 * Haengt den eingeloggten Benutzer an den Request, lehnt aber nichts ab.
 * Fuer Routen wie /api/auth/me, die auch "nicht eingeloggt" beantworten.
 */
export async function loadUser(request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  request.user = token ? await resolveSession(token) : null;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await loadUser(request);

  if (!request.user) {
    return reply.code(401).send({ error: 'Nicht angemeldet' });
  }
}

/**
 * Die eigentliche Zugriffskontrolle. Angular-Guards verstecken nur die UI --
 * verbindlich ist ausschliesslich diese Pruefung auf dem Server.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await loadUser(request);

  if (!request.user) {
    return reply.code(401).send({ error: 'Nicht angemeldet' });
  }

  if (request.user.role !== 'ADMIN') {
    // 403 statt 404: der Client ist authentifiziert, nur nicht berechtigt.
    return reply.code(403).send({ error: 'Keine Berechtigung' });
  }
}
