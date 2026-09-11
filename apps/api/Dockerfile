# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Basis: schlankes Debian statt Alpine. Prisma und argon2 sind native Module,
# fuer die es fertige Builds gegen glibc gibt -- unter Alpine (musl) muessten
# sie jedes Mal aus dem Quelltext uebersetzt werden.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
WORKDIR /app
# openssl wird von der Prisma Query Engine zur Laufzeit gebraucht
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*


# ---------------------------------------------------------------------------
# Build: uebersetzt TypeScript und erzeugt den Prisma Client.
# ---------------------------------------------------------------------------
FROM base AS build

# Werkzeugkette nur hier -- falls fuer argon2 kein passendes Fertigpaket
# existiert, kann es an dieser Stelle noch uebersetzt werden.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Zuerst nur die Manifeste kopieren: solange sich diese beiden Dateien nicht
# aendern, wird der teure npm-ci-Layer aus dem Cache wiederverwendet.
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
# prisma.config.ts wird bewusst NICHT mitkopiert: die Datei laedt eine .env
# und verlangt DATABASE_URL bereits beim Einlesen, die es zur Bauzeit nicht
# gibt. Ohne sie findet Prisma prisma/schema.prisma auf dem Standardweg und
# liest die Variable erst zur Laufzeit aus der Umgebung.
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Dev-Abhaengigkeiten entfernen. `prune` statt einer zweiten Installation,
# damit die bereits uebersetzten nativen Module erhalten bleiben.
RUN npm prune --omit=dev


# ---------------------------------------------------------------------------
# Laufzeit: enthaelt weder Quelltext noch Compiler.
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

# Nicht als root laufen. Das Image bringt den Benutzer `node` bereits mit.
USER node

EXPOSE 3000

# Ohne curl im Image: der Healthcheck spricht direkt ueber Node.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrationen laufen bei jedem Start. `migrate deploy` spielt nur aus, was
# noch fehlt, und ist damit gefahrlos wiederholbar -- anders als `migrate dev`,
# das ein Schema notfalls zuruecksetzt und deshalb nie in Produktion gehoert.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server.js"]
