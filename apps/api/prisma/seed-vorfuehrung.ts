import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/password.js';

/** Zwei Mitspieler zum Vorfuehren. Nicht in der Rangliste sichtbar. */
async function main() {
  const passwordHash = await hashPassword('nur-zum-vorfuehren-123');

  for (const [username, displayName] of [
    ['probe_mira', 'Mira'],
    ['probe_tom', 'Tom'],
  ]) {
    await prisma.user.upsert({
      where: { username },
      update: {},
      create: { username, displayName, passwordHash, role: 'PLAYER', isVisible: false },
    });
  }

  console.log('bereit');
}

main().finally(() => prisma.$disconnect());
