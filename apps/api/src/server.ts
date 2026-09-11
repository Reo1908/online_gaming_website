import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { env, isProduction } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { adminRoutes } from './routes/admin.js';

const app = Fastify({
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
  await app.register(adminRoutes);

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

async function start() {
  await build();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
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
