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
- `artifacts/football-crm/src/lib/tournamentAnalytics.ts` — tournament/squad reports, form, trend
  and the deterministic prose that reads them (pure)
- `artifacts/football-crm/src/lib/lineup.ts` — minutes derivation, sub policy, goal methods, shootouts (pure)
- `artifacts/football-crm/src/pages/` — page components (Dashboard, Players, Sessions, Analytics, etc.)
- `artifacts/football-crm/src/pages/Tournaments.tsx` — the tournaments + friendlies list; its
  three tabs are `components/tournaments/TournamentsTab.tsx`, `FriendliesTab.tsx` and
  `OverviewTab.tsx`
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
- The Players page has two tabs: **All** (the roster table) and **Overview** (squad
  composition). Both read one fetch made by the parent `Players()` so they can never
  describe different data. `lib/squad.ts` holds the computation *and* the prose:
  `buildSquadOverview` derives the figures, and `interpretSize` / `interpretAge` /
  `interpretPositions` turn them into the paragraph under each block. Those readings are
  **deterministic, not LLM-generated** — every sentence is written from a real figure, so
  the text can never claim something the data doesn't show. Adjust a threshold there and
  adjust the sentence that reports it in the same edit.
- **An Overview tab is a chart plus the reading of it, never a table of figures.**
  `components/OverviewCard.tsx` is the shared block — title, chart, a Table toggle, and an
  **Interpretation** paragraph — used by both Players → Overview and Tournaments → Overview.
  The interpretation is the point of the card: restating numbers already visible on the
  tournament or player page is not analytics. Those sentences live beside the arithmetic
  (`interpretGoals`, `interpretGoalkeeping`, `interpretRotation`, `interpretOpponents`,
  `interpretTrend`, `interpretForm` in `lib/tournamentAnalytics.ts`, mirroring `lib/squad.ts`)
  and are **deterministic, not LLM-generated** — each names real figures, so the text can never
  claim what the data doesn't show. Change a threshold, change the sentence that reports it.
- **Our own squads are filed as opponents.** Two squads entered in one tournament can be drawn
  against each other, and that fixture needs an opponent row — so squad names appear in
  `opponents` and in `v_opponent_h2h` beside real clubs, with nothing on the row marking them.
  `ownSquadNames`/`withoutOwnSquads` in `lib/scope.ts` match them by name against the squads that
  actually played, and keep them out of the head-to-head card and the opponent picker. Beating
  ourselves is not a record against anyone.
- Tournament analytics derivation lives in `lib/tournamentAnalytics.ts` (pure TypeScript, no
  Supabase). Head-to-head is the deliberate exception and stays in the SQL views — see the
  opponents note below. Everything in the module counts with `matchOutcome`, so the Overview,
  the tournament page and the printed report can never disagree; the head-to-head card counts
  goals only and says so on screen. The Tournaments → Overview tab reads **one** parent fetch
  and passes slices to its cards, the way `Players()` feeds both of its tabs.
- **The Overview reports on one scope at a time.** `lib/scope.ts` defines it — a tournament, the
  friendlies, or an opponent — and owns both the `<select>` value and the report's query string,
  so the tab and `/reports/tournament` can never read a selection differently. Deliberately not a
  stack of combinable filters: a competition and an opponent answer different questions, and a
  screen that quietly ANDs them shows a slice nobody asked for. The whole dataset is fetched once
  and sliced with `matchesInScope`; only the trend and the head-to-head card sit outside the
  scope, and both say so on screen.
- **A scope whose matches span more than one squad reports per squad.** The Overview's squad
  pills and the printed report's per-squad pages both come from `buildScopedReport`, which reads
  the squads off the matches (`MATCH_SELECT` already embeds `squads(id, name)`) rather than
  fetching them — squad rows belong to a tournament, so there is no list to fetch for an opponent
  scope. It returns `bySquad: []` below two squads rather than repeating the combined figures
  under a squad heading. Selection and rotation differ between squads, so averaging them together
  describes neither.
- **Clean sheets are attributed, not recorded.** There is no per-keeper conceded column, so
  `creditedKeeper` gives a match to whichever goalkeeper played the most of it — crediting
  everyone who featured double-counts a shared match, and splitting by minutes would report
  fractional clean sheets. Matches with no goalkeeper on the sheet are credited to nobody, and
  both the card and the printed report say how many those were, otherwise the conceded column
  silently fails to add up to the team's.
- The printed tournament report is a second `/reports/*` route (`/reports/tournament?id=…`),
  following the player report's mechanism exactly: rendered outside the app chrome, `dark`
  stripped off `<html>` while mounted, `document.title` seeding the "Save as PDF" filename, and
  `window.print()` after two `requestAnimationFrame`s. `lib/reportLinks.ts` is the single
  definition of those URLs and handles `BASE_URL`. One page per squad, plus the combined page.
  It is the paper edition of Tournaments → Overview: the same blocks in the same order, each a
  compact table with its `interpret*` reading underneath, and deliberately shorter than the
  screen — a report is read once, so every table is the shortest one that supports its sentence.
  It prints whatever scope the tab had selected, down to the squad, because the Download button
  and the route share `scopeToParams`/`scopeFromParams`; a bare `/reports/tournament` still means
  the latest tournament played. Blocks that belong to a bracket — the podium, the placing —
  render only for a tournament scope, and an opponent scope gains the "where we met them"
  breakdown a single competition can't have.
  The combined page carries the squad-against-squad comparison (`buildSquadComparison`), which
  compares rates rather than totals so an uneven number of games stays comparable.
- **Who won the tournament is derived, and often unknowable.** `tournamentPlacings` names first,
  second and third off the bracket, but the database holds our own results only: a placing is
  knowable exactly when we played the tie that settled it. Out at the semi-final and nobody knows
  who lifted it, so the report prints "Not recorded" and says why rather than guessing. Placings
  and `finish` are both computed per squad in `buildSquadReport`, so a two-squad entry can't show
  one squad's final on the other's page.
- **`fetchAllMatchStats` and `fetchAllMatches` are paged.** One stat row per player per fixture
  passes PostgREST's silent 1000-row cap quickly, and a truncated read under-reports without
  erroring. Both are read whole and sliced in the client rather than re-queried per selection.
  If you ever do filter stats by a match column, the embed has to be `matches!inner` — PostgREST
  ignores a filter on a plain embed and returns the whole table instead.
- Chart work follows the `dataviz` skill, and `lib/viz.ts` is this app's validated instance
  of it — the categorical slots pass all six checks of the skill's validator on both real
  surfaces. Consume `posColor`/`ink`/`HIGHLIGHT` rather than picking colours. Two rules bite
  in practice: light mode's contrast WARN means any categorical chart needs visible labels
  (the position bars carry direct value labels for exactly this reason), and every chart
  needs a table view because a value reachable only by hovering fails accessibility.
- **Where the team finished is derived, never stored.** `tournamentFinish` in
  `lib/tournaments.ts` reads the Final and Third Place matches — win the final → Winners,
  lose it → Runners-up, win the third-place playoff → Third, anything else → null. A final
  level at full time is settled on the shootout, which is why the function consults
  `pens_for`/`pens_against` even though `matchResult` still calls that match a draw. There is
  no column to keep in sync, so a corrected scoreline corrects the placing everywhere.
  `fetchTournamentFinishes` returns them all in one request; the tournament list, the player
  profile and the printed report each use it. A squad call-up earns the placing, so it shows
  on a player's profile whether or not they got on the pitch. On screen it renders as a
  medal (`FinishBadge`) with the word in `sr-only` text and the `title`, so nothing depends
  on the emoji font; the printed report uses `FINISH_CFG[...].label` instead, because the
  report is deliberately monochrome and a colour glyph doesn't belong in it.
- Tournament matches are grouped by stage in bracket order (`stageRank`) and dated within each
  group, each group collapsible. The per-row stage badge is gone — the group heading carries it.
- The tournaments list and the Players roster deliberately share one table shell
  (`bg-card border rounded-2xl` → `thead` at `text-xs` → rows at `text-sm`). If you restyle
  one, restyle the other; they were visibly different type scales before and it read as two
  different apps.
- **Load = rated sessions + match minutes.** `buildLoadRows` in `lib/report.ts` folds the two
  into one `LoadRow[]`, which is the only thing `computeAcwr` accepts. A match is always
  `MATCH_RPE × minutes_played` (7) however hard it felt, so a match's own `session_rpe` row is
  dropped once the match grid has covered that fixture — dedupe is on `(player_id, session_id)`.
  Two fallbacks catch match days the grid never saw, both at MATCH_RPE, so no day scores zero:
  an orphan session **with** an RPE row uses the minutes on that row; an orphan session
  **without** one uses `duration_mins` for whoever was marked Present or Late.
- **The attendance fallback must be given the genuinely orphaned sessions** — pass
  `fetchAdoptableSessions()`, never "every match session". It cannot be inferred from "this
  player has no grid row for this session": attendance is taken once per match *day* while
  grid rows are per fixture *and* squad, so a second-squad player has no stat row on the
  fixture holding that day's attendance and would collect a phantom estimate on top of the
  minutes they actually played. This was caught in review, not in design.
- **Load is expressed per day, not per fixture.** `collapseLoadByDay` sums a player's rows by
  date before they reach the chart or `computeAcwr`: a tournament day is one hard day, not
  five points stacked on the same x value, and the chart's rolling average is then "last four
  days" rather than "last four fixtures". Totals are unchanged, so ACWR is numerically
  identical — this is about the unit. `buildLoadRows` still emits one row per fixture, which
  is what the "N matches" counts are taken from; don't collapse before counting.
- All three ACWR surfaces — player profile, printed report, Dashboard injury alerts — call
  `computeAcwr`. The Dashboard used to reimplement the arithmetic inline and silently kept its
  own answer; don't reintroduce that. Its alert loop iterates *players*, not RPE rows, because
  a player can now have load with no rated session at all.
- `fetchPlayerRecentSessions` is **date**-bounded, not row-limited — ACWR needs a 28-day
  window and a row cap turns a heavy month into a light-looking one. Filtering on the joined
  session date needs `sessions!inner(*)`: PostgREST ignores `.gte("sessions.date", …)` on a
  plain embed. PlayerDetail windows the match rows to the same span, since match stats are
  fetched in full for the tournament history.
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
  `/tournaments/:id` and `/matches/:id` detail pages beneath it. Its three tabs live in the
  query string (`?tab=friendlies`, `?tab=overview`) so every list is linkable and a match page
  can send you back to the one you came from. Sessions is Training + Fitness Tests only.
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
- **There are two result functions, and the split is deliberate.** `matchResult` counts
  goals only — it is what the SQL head-to-head views (`v_opponent_h2h`) and the per-90
  rates mirror, so it must never learn about shootouts. `matchOutcome` is the bracket's
  view: identical everywhere except a drawn *knockout* tie, which the shootout settles into
  a W or an L, because there is no such thing as a drawn semi-final. Group games and
  friendlies can still end level under both. Anything a bracket owns — result badges, stage
  records, a tournament's own W/D/L, `tournamentFinish` — uses `matchOutcome`;
  `tournamentRecord` takes it as its `resultOf` argument. Consequence to accept: a
  tournament page can read 4/2/1 while the H2H view counts the same games 3/3/1. That is
  correct, not a bug — they are answering different questions.
- previewPath is `/` so the CRM is the root app in the preview pane.
- Supabase project ID: `ljxsclpmidkyqaujesio`
- **Database functions are hardened; keep them that way.** The four trigger functions
  (`sessions_auto_fields`, `session_rpe_auto_load`, `calculate_age`, `calculate_age_range`)
  run with `search_path = ''`. pg_catalog is still searched implicitly, so built-ins and
  operators resolve — but **every table reference inside them must be schema-qualified**,
  which is why `session_rpe_auto_load` reads `public.sessions`. Adding an unqualified table
  reference to any of them will fail at runtime, not at deploy time.
- `rls_auto_enable()` is an **event trigger** function that turns RLS on for newly created
  public tables. Don't drop it. `EXECUTE` is revoked from `public`, `anon` and
  `authenticated` so it isn't callable over the REST API; event triggers fire as their owner,
  so the revoke doesn't affect it.

## Product

- **Dashboard** — squad overview: size, position breakdown, age groups, benchmark stats
- **Players** — full roster management with profiles
- **Sessions** — training session log, plus fitness tests
- **Tournaments** — tournaments, their squads and matches, standalone friendlies, and an
  **Overview** tab of analytics (form, goal routes, goalkeeping, rotation, head-to-head,
  trend), with a print-ready per-tournament report
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
