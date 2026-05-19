# Prode ⚽ 2026

A World Cup prediction game (*prode*). Friends sign up, create or join a pool
with a 6-letter code, predict every match score, and a live leaderboard ranks
everyone. **No custom backend** — only this frontend plus Supabase (auth + DB)
and one tiny Edge Function that syncs fixtures.

**Predicción:** 1‑X‑2 — Gana Local / Empate / Gana Visitante.
**Puntaje:** resultado correcto = **1 pt** · incorrecto = 0.

The database lives in version-controlled **migrations** (`supabase/migrations/`),
which makes the optional [Supabase Branching](#7-supabase-branching-optional-paid)
workflow possible: every GitHub branch gets its own throwaway preview database.

---

## 1. Supabase project (~5 min)

1. Create a project at [supabase.com](https://supabase.com).
2. **Disable email confirmation** so signup is instant:
   **Authentication → Sign In / Providers → Email → turn OFF "Confirm email" → Save.**
3. **Project Settings → API**: copy the **Project URL**, the **anon public**
   key, and (for later) the **service_role** key. Note your **project ref**
   (the subdomain in the URL, e.g. `abcd1234` in `abcd1234.supabase.co`).

## 2. Apply the database schema

**Option A — Supabase CLI (recommended, needed for branching):**

```bash
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
```

This runs everything in `supabase/migrations/`.

**Option B — no CLI:** open the Supabase **SQL Editor**, paste the entire
contents of `supabase/migrations/20260519175430_init.sql`, and run it. Safe to
re-run.

## 3. Configure the frontend

```bash
cp .env.example .env
```

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

## 4. Run it

```bash
npm install
npm run dev
```

Create an account, create a pool, share the code. (Matches appear after the
fixtures sync — step 5.)

## 5. Load World Cup fixtures (Edge Function)

The browser never calls the football API directly (keeps the key secret and the
shared rate limit safe). A Supabase Edge Function syncs fixtures + results into
the `matches` table. `verify_jwt = false` for it is already set in
`supabase/config.toml`.

1. Get a free token at [football-data.org](https://www.football-data.org/client/register)
   (free tier covers the FIFA World Cup, competition code `WC`).
2. Set the secret and deploy (after `supabase link` from step 2):

   ```bash
   supabase secrets set FOOTBALL_API_KEY=your-football-data-token
   supabase functions deploy sync-fixtures
   ```

3. Trigger it once to load the schedule. `verify_jwt = false` is set for this
   function, but the Supabase gateway still needs an `apikey`, so pass your
   **anon** key:

   ```bash
   curl -i -X POST \
     "https://YOUR-PROJECT.supabase.co/functions/v1/sync-fixtures" \
     -H "Authorization: Bearer YOUR-ANON-KEY"
   ```

   It returns `{ "synced": N, ... }` and matches appear in the app.
   (`supabase functions invoke` also works, but only on newer CLI versions —
   the `curl` call is version-independent and is what the cron job uses.)

### Keep scores updating automatically

In the SQL Editor (replace URL + use your **service_role** key):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sync-fixtures-every-15m',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT.supabase.co/functions/v1/sync-fixtures',
    headers := '{"Authorization":"Bearer YOUR-SERVICE-ROLE-KEY"}'::jsonb
  );
  $$
);
```

## 6. Deploy the frontend (optional)

Import the GitHub repo into [Vercel](https://vercel.com) (framework: **Vite**),
add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Environment Variables,
deploy, share the link.

## 7. Supabase Branching (optional, PAID)

> ⚠️ **Branching requires a paid Supabase plan (Pro, ~$25/mo) and bills extra
> compute per active preview branch.** The free tier does not support it. The
> repo is already structured for it — enabling is a dashboard toggle you flip
> when you're ready to pay. Everything above works fine on the free plan
> without this.

What it gives you: open a GitHub branch/PR → Supabase spins up a **preview
database**, runs your migrations, and seeds it from `supabase/seed.sql` (no
production data is copied). Merge to your production branch → migrations and the
`sync-fixtures` Edge Function deploy to production automatically.

**To enable (when on Pro):**

1. Push this repo to GitHub (see below) — `supabase/config.toml`,
   `supabase/migrations/`, and `supabase/seed.sql` are already in place.
2. Supabase Dashboard → **Project Settings → Integrations → GitHub** →
   **Authorize GitHub**.
3. Select this repository. Set **working directory** to `.` (the `supabase/`
   folder is at the repo root).
4. Choose your production git branch (e.g. `main`) and enable
   **Deploy to production**.
5. Click **Enable integration**.

Per-branch notes:
- Secrets aren't inherited — set `FOOTBALL_API_KEY` for preview branches you
  want the sync to work on (Branch settings), or just rely on `seed.sql`'s
  sample matches for UI testing.
- Each preview branch is billed while it exists; delete merged branches.

---

## How it fits together

| Piece | Where | Role |
|---|---|---|
| React + Vite UI | `src/` | Login, pools, picks, leaderboard |
| Auth | Supabase Auth | Email + password, no confirmation |
| Data | Supabase Postgres | `supabase/migrations/` — tables, RLS, RPCs |
| Fixtures sync | `supabase/functions/sync-fixtures` | Football API → `matches` |

**Security model:** predictions are RLS-locked to their owner and frozen at
the round deadline — 23:59 Argentina time the day before a Fecha starts for the
group stage, the day before each match for knockouts (enforced in the DB); you
can't see anyone's picks. The leaderboard is a
`SECURITY DEFINER` RPC that aggregates points per pool without exposing
individual predictions. Pools are joinable only via their code.

### Project layout

```
supabase/config.toml                Supabase + CLI config (functions, branching)
supabase/migrations/                Versioned schema (tables, RLS, RPCs)
supabase/seed.sql                   Sample data for preview branches only
supabase/functions/sync-fixtures/   Edge Function: fixtures + results
src/lib/                            supabase client, types, scoring
src/contexts/AuthContext.tsx        session + auth actions
src/pages/                          Login, Signup, Dashboard, PoolDetail
src/components/                     TopBar, MatchList, Leaderboard, ProtectedRoute
```

Scoring lives in two places that must stay in sync: `public.match_points()` /
`match_outcome()` in the `outcome_predictions` migration and `matchPoints()` /
`actualOutcome()` in `src/lib/scoring.ts`.
