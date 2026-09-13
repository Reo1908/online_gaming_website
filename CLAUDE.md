# Friend Games — notes for Claude

Private mini-games site for one friend group. Accounts are created by admins;
there is no public registration. Architecture, data model and endpoints are
documented in README.md — read that instead of re-deriving them.

## Scope
- Small hobby project. Keep recommendations proportionate.
- Do not introduce Kubernetes, microservices, Redis, OAuth, queues or other
  major infrastructure unless explicitly asked.
- Prefer the smallest safe change; no unrelated refactors.

## The server is authoritative
The browser may *request* an action; the API decides whether it is allowed.
- Never trust client-provided winner, score, role, user ID, game slug, game
  state or match status.
- Authorization lives in Fastify route handlers and Socket.IO handlers.
  Angular guards and hidden UI are convenience only.
- Never move game-rule logic into Angular.

## Where things belong
- `apps/api/src/games/<game>/` — game-specific rules only.
- `apps/api/src/lib/` — shared lifecycle: lobby, match completion, scoring
  write-out, stats, sessions, Socket.IO wiring. `lib/realtime.ts` must not
  know any individual game.
- New game: see "Ein neues Spiel dazubauen" in README.md.

## Don't touch without explicit approval
Prisma schema/migrations, Docker/Compose files, `.github/workflows/`,
authentication, sessions, scoring (`lib/partie.ts`), deployment config.
Never read or modify `.env` files or other secrets.

## Git
- Work on a feature branch; never commit directly to `main`, never force-push.
- One focused change per PR; merge only after CI is green.

## Validation
- API typecheck: `cd apps/api && npm run typecheck` (needs `npx prisma generate` first on a fresh checkout)
- Web build: `cd apps/web && npm run build`
- There are currently no automated tests and no lint config.
