<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Standalone Build Rule

This project uses `output: "standalone"` in `next.config.ts`.

When validating a production build, do **not** use `next start`. That startup mode can break runtime module resolution here and cause false-negative auth/API failures.

Use the standalone server instead:

- Local verification after `next build`: `node .next/standalone/server.js`
- Runtime/deployed copy: `node server.js`
- If a specific host/port is needed: `HOSTNAME=127.0.0.1 PORT=31081 node .next/standalone/server.js`

If you are testing a deployed runtime, prefer the existing deployment scripts in `scripts/` so `.next/standalone`, `.next/static`, `public`, `.env`, and `server.js` stay in sync.

If the login page renders but `/api/auth/*` returns `500` after a build/deploy, first check whether someone started the app with `next start` instead of the standalone `server.js`.
<!-- END:nextjs-agent-rules -->

# Commands

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run lint` — ESLint flat config (`eslint.config.mjs`), no args needed
- `npx prisma db push` — sync schema to SQLite (prefer over migrate for quick iteration)
- `npx prisma migrate dev --name <name>` — create migration
- `npx tsx prisma/seed.ts` — **destructive**: truncates all data, re-seeds

No test framework configured. No project-level tests.

# Database

Three isolated SQLite databases, never cross-use:
- Dev: `prisma/dev.db`
- Demo: `/home/solarise/task-manager-data/demo/dev.db`
- Prod: `/home/solarise/task-manager-data/prod/dev.db`

Root `/home/solarise/project-manage/dev.db` is NOT a valid path — likely debug residue.

SMTP auto-falls back to Ethereal test accounts when unconfigured (logs preview URL in console).

# Auth

- `src/lib/auth.ts` — NextAuth v4, JWT strategy. Two providers: `credentials` (email+password) and `representative` (magic link)
- Brute-force lockout: 5 failed attempts → 15 min lock (tracks via `FailedLoginAttempt` model)
- Magic links: 24h expiry, single-use (token cleared after use)
- `src/middleware.ts` protects `/dashboard`, `/projects`, `/tickets`, `/customers`, `/profile`, `/admin` + their API routes
- `src/lib/permissions.ts` guards: ADMIN bypasses all membership checks; REPRESENTATIVE is scoped to linked projects only

# Build & Deploy

- Never use `next start` for verification — always `node .next/standalone/server.js`
- Use `./scripts/deploy-demo.sh` or `./scripts/deploy-prod.sh` for deployments
- Both call `scripts/deploy-standalone.sh` (full build from source + rsync + prisma db push + .env generation)

# Conventions

- Tailwind CSS v4: no `tailwind.config.ts`, CSS via `@import "tailwindcss"` in `src/app/globals.css`
- shadcn/ui style `"base-nova"` (non-default), components in `src/components/ui/`
- ESLint at `eslint.config.mjs`, flat config, extends `eslint-config-next/core-web-vitals` + `typescript`
- API routes in `src/app/api/{resource}/route.ts`, use `getServerSession(authOptions)`
- State: TanStack React Query v5 (server) + Zustand (client)
- Roles (ascending): REPRESENTATIVE < USER < ADMIN
