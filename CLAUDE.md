# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project Overview

科研项目管理系统 (SciManage) — a research project management system built with Next.js 16, Prisma (SQLite), and NextAuth v4. Chinese-language UI.

## Commands

- `npm run dev` — local dev server
- `npm run build` — production build
- `npm run lint` — ESLint (flat config, no args needed)
- `npx prisma db push` — sync schema to database
- `npx prisma studio` — browse database
- `npx tsx prisma/seed.ts` — seed database

No test framework is configured. There are no project-level tests.

## Architecture

Next.js App Router with `output: "standalone"`. React 19, Tailwind CSS v4, shadcn/ui components.

### Auth

NextAuth v4 with JWT strategy (`src/lib/auth.ts`). Two credential providers:
- `credentials` — email/password login with brute-force lockout (5 attempts → 15 min lock)
- `representative` — magic-link token login for external representatives

Session carries `user.id` and `user.role`. Roles: `ADMIN`, `USER`, `REPRESENTATIVE`.

Middleware (`src/middleware.ts`) protects `/dashboard`, `/projects`, `/tickets`, `/profile`, `/admin` and their corresponding API routes. Unauthenticated requests redirect to `/login`.

### Data Model

Prisma with SQLite (`prisma/schema.prisma`). Core entities: User, Representative, Project, ProjectMember, Ticket, Comment, TicketReply, Attachment, ActivityLog, Notification.

- Projects have members (with OWNER/MEMBER roles) and an optional linked Representative
- Representatives are external contacts who log in via magic links, not passwords
- Soft-delete pattern: `deleted` + `deletedAt` + `deletedReason` on Project; `archived` flag on Representative

### State Management

- Server state: TanStack React Query v5
- Client state: Zustand
- No Redux

### API Pattern

All API routes are in `src/app/api/`. They use `getServerSession(authOptions)` for auth, then check permissions via `src/lib/permissions.ts` (project membership/ownership checks). ADMIN role bypasses most restrictions. REPRESENTATIVE role is scoped to their linked projects only.

### Key Libraries

- `src/lib/permissions.ts` — project membership/ownership guards, representative scoping
- `src/lib/mail.ts` — nodemailer SMTP integration
- `src/lib/types.ts` — shared TypeScript interfaces for API responses
- `src/lib/representative-link.ts` — magic link generation/validation
- `src/lib/prisma.ts` — singleton Prisma client

### UI Components

shadcn/ui in `src/components/ui/`. App-level components (sidebar, mobile-nav, representative-select) in `src/components/`.

## Environment Variables

Required in `.env`:
- `DATABASE_URL` — SQLite connection string (e.g. `file:./dev.db`)
- `NEXTAUTH_SECRET` — JWT signing secret
- `NEXTAUTH_URL` — canonical app URL
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — email delivery

## Database Environments

Three separate SQLite databases — never cross-use them:
- Dev: `prisma/dev.db` (local development)
- Demo: `/home/solarise/task-manager-data/demo/dev.db`
- Prod: `/home/solarise/task-manager-data/prod/dev.db`

## Deployment

Deploy scripts in `scripts/`:
- `./scripts/deploy-demo.sh` → `task-manager-demo.service` on `:31081`
- `./scripts/deploy-prod.sh` → `task-manager.service` on `:31080`

Both call `scripts/deploy-standalone.sh` which handles build, copy, `prisma db push`, and `.env` generation. The deploy preserves existing SMTP config and database files.
