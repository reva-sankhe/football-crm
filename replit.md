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
- `artifacts/football-crm/src/lib/opponents.ts` — opponent CRUD + head-to-head/player-split readers
- `artifacts/football-crm/src/lib/lineup.ts` — minutes derivation, sub policy, goal methods, shootouts (pure)
- `artifacts/football-crm/src/pages/` — page components (Dashboard, Players, Sessions, Analytics, etc.)
- `artifacts/football-crm/src/pages/Tournaments.tsx` — the tournaments + friendlies list; its
  two tabs are `components/tournaments/TournamentsTab.tsx` and `FriendliesTab.tsx`
- `artifacts/api-server/` — Express API server (workspace boilerplate, not used by CRM yet)
- `lib/db/src/schema/` — Drizzle schema (workspace boilerplate)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (workspace boilerplate)

## Architecture decisions

- CRM connects directly to Supabase (no intermediate API layer) — all queries go through the Supabase JS client using the anon key + RLS.
- The monorepo api-server/db/api-spec packages exist as workspace boilerplate but are not wired to the CRM; future backend work can use them.
- `players.jersey_number` is the player's permanent squad number (1–99, nullable, CHECK
  constraint `players_jersey_number_check`). It is **not** the same as
  `squad_players.shirt_number`, which is the number worn for one tournament squad and may
  differ. `playerLabel()` in `lib/utils.ts` is the single definition of the "Aanya Vora (#12)"
  display format — use it everywhere a player is named, and `parseJersey`/`isValidJersey`
  (same file) to validate input against the constraint before writing.
- Opponents are a real table, not free text. `matches.opponent_id` is the FK; the old
  `matches.opponent` text column is deprecated and kept only until the UI is fully cut
  over. Always write `opponent_id`.
- Head-to-head and player-vs-opponent aggregation lives in Postgres views
  (`v_opponent_h2h`, `v_player_vs_opponent`, `v_player_match_totals`), not in TypeScript,
  so every screen reports the same numbers. Fix the view, not the caller. All are
  `security_invoker = on` — without it a view bypasses RLS and trips Supabase's linter.
- `matches.tournament_id` is nullable: a standalone friendly belongs to no tournament.
  The Friendlies tab on `/tournaments` is its UI — `fetchStandaloneMatches` reads them, and
  `MatchFormModal` with `tournament={null}` creates them (no squad, stage fixed to "Friendly",
  duration from `DEFAULT_MATCH_MINS`). The same modal serves tournament matches, so keep the
  two paths in one component rather than forking it.
- `MatchFormModal` both creates and edits, like `TournamentFormModal` — an optional `match`
  prop switches it, hides the adopt-a-session mode (creation only) and reveals Delete. It is
  the **only** place a match's date, duration, opponent, stage or squad can be changed;
  the match page keeps just the score, shootout and player stats.
- Date and duration live on the backing `sessions` row, so editing them goes through
  `updateTrainingSession`, which re-derives the stored `day` column with `dayFromISO`. Never
  update `sessions.date` without carrying `day` — nothing else recomputes it.
- **The match page has exactly one save.** Score, shootout and player stats are three
  different tables but one edit as far as the user is concerned, so the sticky bar's `dirty`
  is `statsDirty || scoreDirty || shootoutDirty` and `handleSave` writes all three. Don't add
  a second save button to a sub-panel; wire its dirty state into the bar instead.
- **Attendance is per day, not per match.** `collapseMatchDays` in `lib/attendance.ts`
  folds every match session on a date into one entry — a tournament day with four
  fixtures is one attendance check. The surviving "canonical" session is whichever
  one already holds that day's rows (falling back to earliest-created), so
  collapsing never strands existing attendance. Training and Lecture sessions are
  untouched and stay one entry each.
- **Everything that reports an attendance percentage counts days, not fixtures.** The
  player profile and the printed report both run their sessions through
  `collapseMatchDays` first, so a tournament day is one unit however many matches it
  held — otherwise every month containing a tournament reads far too low. The match tile
  is the one place the two units are mixed on purpose: `matchDayAttendance` in
  `lib/attendance.ts` returns a **day-wise `pct`** with an **`attended`/`total` counted in
  fixtures**, so it reads "67% matches (6/8)" — 2 of 3 match days, 6 of 8 fixtures. Don't
  "fix" that by making pct equal attended/total.
- Tournaments is its own page at `/tournaments`, not a Sessions tab — it owns the
  `/tournaments/:id` and `/matches/:id` detail pages beneath it. Its active tab lives in the
  query string (`?tab=friendlies`) so both lists are linkable and a match page can send you
  back to the one you came from. Sessions is Training + Fitness Tests only.
- The Sessions → Training tab excludes `session_type = 'Match'`; matches live under
  `/tournaments`. Its create form omits Match for the same reason.
- Time on the pitch lives on the player's own stat row — `started`, `on_minute`,
  `off_minute` — not in a separate event table. Blank `on_minute` means "from
  kickoff", blank `off_minute` means "to the final whistle", and neither set means
  they didn't play. `playerMinutes` in `lib/lineup.ts` turns that into minutes.
  One spell per player: a genuine re-entry is handled by typing minutes in by hand,
  which sets `minutes_overridden` and stops the calculation touching that row.
- **The match grid changes shape with the sub policy.** Limited subs shows
  Start/On/Off and calculates minutes; rolling subs hides all three and takes typed
  minutes, because on/off is meaningless when players rotate constantly. Policy
  resolves match → tournament → app default (`resolveSubPolicy`), and the match page
  has an override so a standalone match (no tournament) can set its own.
- Exceeding a limited sub cap warns but never blocks a save — formats vary more than
  the schema usefully models.
- Goals are logged one at a time by method through a single control — the grid has
  no separate FK/P columns. `applyGoal` in `lib/lineup.ts` recomputes `goals` as the
  sum of open play + free kicks + penalties, so the DB's `FK + P <= goals` check
  constraint holds by construction rather than by clamping. Open-play goals carry no
  label; only free kicks and penalties are called out.
- Penalty shootouts never touch `goals_for`/`goals_against` or `matchResult()`. The
  match stays a draw and "won 4–3 on pens" is shown alongside, so head-to-head
  totals and per-90 rates stay honest.
- previewPath is `/` so the CRM is the root app in the preview pane.
- Supabase project ID: `ljxsclpmidkyqaujesio`

## Product

- **Dashboard** — squad overview: size, position breakdown, age groups, benchmark stats
- **Players** — full roster management with profiles
- **Sessions** — training session log, plus fitness tests
- **Tournaments** — tournaments, their squads and matches, and standalone friendlies
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
