import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (_request, reply) => {
    try {
      // Ohne diesen Roundtrip meldet /health auch dann "ok",
      // wenn die Datenbank gar nicht erreichbar ist.
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      return reply.code(503).send({ status: 'degraded', database: 'down' });
    }
  });
}
