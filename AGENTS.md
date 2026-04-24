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
