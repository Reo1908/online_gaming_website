import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/password.js';

async function main() {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!username || !password) {
    throw new Error('ADMIN_BOOTSTRAP_USERNAME oder ADMIN_BOOTSTRAP_PASSWORD fehlt');
  }

  if (password.length < 12) {
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD muss mindestens 12 Zeichen haben');
  }

  const passwordHash = await hashPassword(password);

  await prisma.user.upsert({
    where: { username },
    // Bestehendes Admin-Passwort wird nicht ueberschrieben: sonst wuerde
    // jeder erneute Seed-Lauf ein geaendertes Passwort zuruecksetzen.
    update: { role: 'ADMIN', isActive: true },
    create: {
      username,
      displayName: 'Admin',
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log(`Admin-Benutzer bereit: ${username}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
