# Contract Hub

A contract lifecycle management platform: draft contracts, route them through
configurable multi-step approval chains, collect e-signatures, and track
renewals and expirations, with a complete, tamper-proof audit trail.

> 🚧 Work in progress. Built incrementally; see the roadmap below.

<!-- Screenshot placeholders: replace once the UI is built -->
<!-- ![Dashboard](docs/screenshots/dashboard.png) -->
<!-- ![Approval flow](docs/screenshots/approval.png) -->

## Tech stack

| Layer    | Choice |
| -------- | ------ |
| API      | Node.js, Express 5, TypeScript, Zod |
| Database | PostgreSQL + Prisma 7 |
| Web      | Angular 22 (standalone components, signals), Angular Material 3, Tailwind CSS 4 |
| Auth     | JWT access tokens + rotating refresh tokens (httpOnly cookie), RBAC |
| Jobs     | Postgres-backed queue (`FOR UPDATE SKIP LOCKED`), no Redis |
| Email    | Nodemailer → Mailpit in development |

## Repository layout

```
apps/api        Express API (controllers → services → repositories)
apps/web        Angular front-end (feature folders, lazy routes)
packages/shared Domain enums + contract state-transition table, shared by both apps
docs/           Architecture & design decisions
```

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the data model, the
workflow engine design, and the reasoning behind each decision.

## Getting started

Prerequisites: Node 22+, and either Docker or a local PostgreSQL 14+.

```bash
npm install
cp apps/api/.env.example apps/api/.env   # adjust DATABASE_URL if not using Docker
npm run db:up                            # Postgres + Mailpit (skip if using local Postgres)
npm run db:migrate                       # apply migrations + generate Prisma client
npm run db:seed                          # demo departments & users
npm run dev:api                          # http://localhost:3000/api/health
npm run dev:web                          # http://localhost:4200 (proxies /api → :3000)
```

Emails sent in development appear in Mailpit at http://localhost:8025.

### Demo accounts

All demo accounts use the password **`Demo1234!`**.

| Email | Role | Department |
| ----- | ---- | ---------- |
| admin@contracthub.dev | Admin | Operations |
| legal@contracthub.dev | Legal (dept. head) | Legal |
| finance@contracthub.dev | Finance (dept. head) | Finance |
| sales.manager@contracthub.dev | Manager | Sales |
| sales@contracthub.dev | Employee | Sales |
| procurement.manager@contracthub.dev | Manager | Procurement |
| procurement@contracthub.dev | Employee | Procurement |

### Tests

```bash
npm test                                  # unit + integration
npm test -w @cms/api -- --project unit    # unit only, no database needed
```

Integration tests run against `TEST_DATABASE_URL` (a separate database, created
automatically by Docker; with a local Postgres run `createdb contract_mgmt_test`).
They are migrated before each run and never wipe data: every test creates its own
uniquely named records.

### Useful scripts

| Command | What it does |
| ------- | ------------ |
| `npm test` | Unit tests for all workspaces |
| `npm run typecheck` | Type-check all workspaces |
| `npm run db:seed` | Load demo departments & users (contracts come later) |
| `npm run db:studio -w @cms/api` | Browse the database in Prisma Studio |

## Roadmap

- [x] Monorepo, database schema, migrations with DB-level guarantees
- [x] Auth (JWT + refresh-token rotation with reuse detection) and RBAC
- [ ] Contracts CRUD with version history and file storage
- [ ] Approval workflow engine (state machine, conditional steps, escalation)
- [ ] Notifications (email job queue + in-app bell) and audit logging
- [ ] Angular UI: login, dashboard, contract detail, approvals, e-signature
- [ ] Seed data and demo walkthrough
