import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { prisma } from './prisma.js';
import { cookiesBrauchenHttps } from './env.js';

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 Tage

/** Verlaengert die Session, sobald weniger als ein Tag Restlaufzeit bleibt. */
const RENEW_THRESHOLD_MS = 1000 * 60 * 60 * 24;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');

  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  return token;
}

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'PLAYER';
};

export async function resolveSession(token: string): Promise<SessionUser | null> {
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;

  // Abgelaufene Session sofort entfernen statt nur abzulehnen.
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  // Deaktivierter Benutzer verliert den Zugriff sofort, auch mit gueltigem Cookie.
  if (!session.user.isActive) {
    await prisma.session.deleteMany({ where: { userId: session.userId } });
    return null;
  }

  if (session.expiresAt.getTime() - Date.now() < SESSION_TTL_MS - RENEW_THRESHOLD_MS) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      })
      .catch(() => undefined);
  }

  return {
    id: session.user.id,
    username: session.user.username,
    displayName: session.user.displayName,
    role: session.user.role,
  };
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, // kein Zugriff aus JavaScript -> entschaerft XSS-Diebstahl
    sameSite: 'lax', // blockt CSRF aus fremden Origins bei POST
    // Aus APP_ORIGIN abgeleitet, nicht aus NODE_ENV: haette die Anwendung
    // Secure gesetzt und liefe dann doch ueber http://, wuerde der Browser
    // das Cookie kommentarlos verwerfen -- der Login scheitert dann ohne
    // jede Fehlermeldung.
    secure: cookiesBrauchenHttps,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
