import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { env, isProduction } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { purgeExpiredSessions } from './lib/session.js';
import { realtimeStarten } from './lib/realtime.js';
import { spielartenSicherstellen } from './lib/spiele.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { adminRoutes } from './routes/admin.js';
import { supportRoutes } from './routes/support.js';
import { matchRoutes } from './routes/matches.js';

const app = Fastify({
  // Siehe TRUST_PROXY in lib/env.ts: entscheidet, welche Adresse als die des
  // Clients gilt -- und damit, worauf das Rate-Limit schluesselt.
  trustProxy: env.TRUST_PROXY,
  logger: isProduction
    ? true
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
});

async function build() {
  await app.register(cookie, { secret: env.SESSION_SECRET });

  // Im Dev laeuft Angular ueber einen Proxy und damit same-origin;
  // CORS greift nur, falls das Frontend das Backend direkt anspricht.
  await app.register(cors, {
    origin: env.APP_ORIGIN,
    credentials: true, // ohne das sendet der Browser das Session-Cookie nicht
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(leaderboardRoutes);
  await app.register(matchRoutes);
  await app.register(adminRoutes);
  await app.register(supportRoutes);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);
    const status = error.statusCode ?? 500;
    // Interne Fehlertexte koennen Query- oder Pfaddetails enthalten
    // und gehen deshalb nur ins Log, nicht an den Client.
    const message = status >= 500 ? 'Interner Serverfehler' : error.message;
    return reply.code(status).send({ error: message });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({ error: `Route ${request.method} ${request.url} existiert nicht` });
  });

  return app;
}

/** Alle sechs Stunden; beim Start einmal sofort. */
const PURGE_INTERVAL_MS = 1000 * 60 * 60 * 6;

async function purgeSessions() {
  try {
    const entfernt = await purgeExpiredSessions();
    if (entfernt > 0) app.log.info(`${entfernt} abgelaufene Sitzungen entfernt`);
  } catch (error) {
    // Aufraeumen ist Nebensache: ein Fehler darf den Betrieb nicht stoeren.
    app.log.warn({ err: error }, 'Aufraeumen der Sitzungen fehlgeschlagen');
  }
}

async function start() {
  await build();

  // Die Spielarten stehen im Quelltext; die Tabelle wird daraus abgeglichen,
  // damit auf einem frischen Server niemand Spiele von Hand anlegen muss.
  await spielartenSicherstellen();

  // Haengt sich an denselben HTTP-Server -- danach darf nichts mehr an den
  // Routen geaendert werden, deshalb erst nach build().
  realtimeStarten(app);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  await purgeSessions();
  // unref(): der Zeitgeber soll den Prozess beim Herunterfahren nicht
  // kuenstlich am Leben halten.
  setInterval(() => void purgeSessions(), PURGE_INTERVAL_MS).unref();
}

// Ohne sauberes Schliessen bleiben beim Neustart im Watch-Modus
// Datenbankverbindungen offen, bis der Pool erschoepft ist.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} empfangen, fahre herunter`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

start().catch(async (error) => {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
