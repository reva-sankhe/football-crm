# Football CRM

A team management CRM for Bombay Gymkhana Women's Football — tracks players, sessions, attendance, fitness tests, and analytics, backed by Supabase.

## Run & Operate

- `pnpm --filter @workspace/football-crm run dev` — run the CRM frontend (uses PORT env var)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (for api-server)
- Required env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — Supabase credentials (for football-crm)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite 7 + Tailwind CSS v4 + Radix UI + shadcn/ui components
- Data: Supabase (PostgreSQL) via `@supabase/supabase-js`
- State/queries: TanStack Query v5
- Routing: wouter
- Charts: Recharts
- API (workspace): Express 5 + Drizzle ORM (separate from Supabase — currently unused by CRM)
- Build: esbuild (api-server), Vite (frontend)

## Where things live

- `artifacts/football-crm/` — React + Vite CRM app (the main product)
- `artifacts/football-crm/src/lib/supabase.ts` — Supabase client init
- `artifacts/football-crm/src/lib/queries.ts` — all Supabase data-fetching functions
- `artifacts/football-crm/src/pages/` — page components (Dashboard, Players, Sessions, Analytics, etc.)
- `artifacts/api-server/` — Express API server (workspace boilerplate, not used by CRM yet)
- `lib/db/src/schema/` — Drizzle schema (workspace boilerplate)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (workspace boilerplate)

## Architecture decisions

- CRM connects directly to Supabase (no intermediate API layer) — all queries go through the Supabase JS client using the anon key + RLS.
- The monorepo api-server/db/api-spec packages exist as workspace boilerplate but are not wired to the CRM; future backend work can use them.
- previewPath is `/` so the CRM is the root app in the preview pane.
- Supabase project ID: `ljxsclpmidkyqaujesio`

## Product

- **Dashboard** — squad overview: size, position breakdown, age groups, benchmark stats
- **Players** — full roster management with profiles
- **Sessions** — training session log
- **Calendar** — session scheduling view
- **Fitness Tests** — fitness tracking per player
- **Analytics** — performance analytics across the squad

## User preferences

- Don't add features without being asked — set up first, then enhance on request.
- User wants to push finished changes back to GitHub eventually (GITHUB_TOKEN is available).

## Gotchas

- `VITE_SUPABASE_ANON_KEY` and `VITE_SUPABASE_URL` must be set as Replit secrets or the app won't connect to data.
- The CRM's `vite.config.ts` requires `PORT` and `BASE_PATH` env vars (injected by the Replit workflow system automatically).
- Do not use `pnpm dev` at the workspace root — use the workflow or `pnpm --filter` instead.
- `@types/papaparse` is in `dependencies` (not `devDependencies`) due to how the workspace resolves types for this package.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See the `react-vite` skill for frontend build conventions
