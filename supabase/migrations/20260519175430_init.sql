-- ============================================================================
--  Prode World Cup 2026 — Supabase schema
--  Run this in the Supabase SQL Editor (one shot). Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at   timestamptz not null default now()
);

create table if not exists public.pools (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  join_code  text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.pool_members (
  pool_id   uuid not null references public.pools (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (pool_id, user_id)
);

create table if not exists public.matches (
  id         uuid primary key default gen_random_uuid(),
  api_id     bigint unique,                       -- id from the football API (dedupe key)
  stage      text,                                -- e.g. 'GROUP_STAGE', 'ROUND_OF_16'
  group_name text,                                -- e.g. 'Group A'
  home_team  text not null,
  away_team  text not null,
  kickoff_at timestamptz not null,
  home_score int,
  away_score int,
  status     text not null default 'scheduled'
             check (status in ('scheduled', 'live', 'finished'))
);

create table if not exists public.predictions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  match_id       uuid not null references public.matches (id) on delete cascade,
  predicted_home int  not null check (predicted_home between 0 and 99),
  predicted_away int  not null check (predicted_away between 0 and 99),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, match_id)            -- one prediction per user per match
);

create index if not exists predictions_user_idx  on public.predictions (user_id);
create index if not exists predictions_match_idx on public.predictions (match_id);
create index if not exists pool_members_user_idx on public.pool_members (user_id);

-- ---------------------------------------------------------------------------
--  Scoring helper: exact score = 3, correct result = 1, otherwise 0
-- ---------------------------------------------------------------------------

create or replace function public.match_points(
  predicted_home int, predicted_away int, actual_home int, actual_away int
) returns int language sql immutable as $$
  select case
    when predicted_home is null or predicted_away is null
      or actual_home is null or actual_away is null then 0
    when predicted_home = actual_home and predicted_away = actual_away then 3
    when sign(predicted_home - predicted_away) = sign(actual_home - actual_away) then 1
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
--  Auto-create a profile when a user signs up (display_name from metadata)
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''),
             split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
--  Keep predictions.updated_at fresh; pin user_id/match_id once set
-- ---------------------------------------------------------------------------

create or replace function public.touch_prediction()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.user_id    := old.user_id;
  new.match_id   := old.match_id;
  return new;
end;
$$;

drop trigger if exists predictions_touch on public.predictions;
create trigger predictions_touch
  before update on public.predictions
  for each row execute function public.touch_prediction();

-- ---------------------------------------------------------------------------
--  RPC: create a pool (returns the new pool row)
-- ---------------------------------------------------------------------------

create or replace function public.create_pool(p_name text)
returns public.pools language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_pool public.pools;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- 6-char A-Z/2-9 code (no ambiguous 0/O/1/I), retried until unique
  loop
    v_code := upper(
      string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                        (floor(random() * 32)::int) + 1, 1), '')
    )
    from generate_series(1, 6);
    exit when not exists (select 1 from public.pools where join_code = v_code);
  end loop;

  insert into public.pools (name, owner_id, join_code)
  values (trim(p_name), auth.uid(), v_code)
  returning * into v_pool;

  insert into public.pool_members (pool_id, user_id)
  values (v_pool.id, auth.uid());

  return v_pool;
end;
$$;

-- ---------------------------------------------------------------------------
--  RPC: join a pool by code (returns the pool row)
-- ---------------------------------------------------------------------------

create or replace function public.join_pool(p_code text)
returns public.pools language plpgsql security definer set search_path = public as $$
declare
  v_pool public.pools;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_pool
  from public.pools
  where join_code = upper(trim(p_code));

  if v_pool.id is null then
    raise exception 'No pool found with that code';
  end if;

  insert into public.pool_members (pool_id, user_id)
  values (v_pool.id, auth.uid())
  on conflict do nothing;

  return v_pool;
end;
$$;

-- ---------------------------------------------------------------------------
--  RPC: leaderboard for a pool (caller must be a member)
--  Aggregates everyone's points WITHOUT exposing individual picks.
-- ---------------------------------------------------------------------------

create or replace function public.get_leaderboard(p_pool_id uuid)
returns table (
  pool_id           uuid,
  user_id           uuid,
  display_name      text,
  points            int,
  exact_count       int,
  result_count      int,
  predictions_count int
) language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.pool_members
    where pool_id = p_pool_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this pool';
  end if;

  return query
  select
    pm.pool_id,
    pm.user_id,
    pr.display_name,
    coalesce(sum(
      public.match_points(p.predicted_home, p.predicted_away,
                          m.home_score, m.away_score)
    ), 0)::int as points,
    coalesce(count(*) filter (
      where m.status = 'finished'
        and public.match_points(p.predicted_home, p.predicted_away,
                                m.home_score, m.away_score) = 3
    ), 0)::int as exact_count,
    coalesce(count(*) filter (
      where m.status = 'finished'
        and public.match_points(p.predicted_home, p.predicted_away,
                                m.home_score, m.away_score) = 1
    ), 0)::int as result_count,
    coalesce(count(p.id), 0)::int as predictions_count
  from public.pool_members pm
  join public.profiles pr on pr.id = pm.user_id
  left join public.predictions p on p.user_id = pm.user_id
  left join public.matches m on m.id = p.match_id
  where pm.pool_id = p_pool_id
  group by pm.pool_id, pm.user_id, pr.display_name
  order by points desc, exact_count desc, pr.display_name asc;
end;
$$;

-- ---------------------------------------------------------------------------
--  Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.pools        enable row level security;
alter table public.pool_members enable row level security;
alter table public.matches      enable row level security;
alter table public.predictions  enable row level security;

-- profiles: any authenticated user can read display names; manage only your own
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_upsert on public.profiles;
create policy profiles_upsert on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- pools: visible to members (joining is done via the join_pool RPC)
drop policy if exists pools_select on public.pools;
create policy pools_select on public.pools
  for select to authenticated using (
    exists (select 1 from public.pool_members m
            where m.pool_id = pools.id and m.user_id = auth.uid())
  );

-- pool_members: you can see the membership rows of pools you belong to
drop policy if exists pool_members_select on public.pool_members;
create policy pool_members_select on public.pool_members
  for select to authenticated using (
    exists (select 1 from public.pool_members me
            where me.pool_id = pool_members.pool_id and me.user_id = auth.uid())
  );

drop policy if exists pool_members_leave on public.pool_members;
create policy pool_members_leave on public.pool_members
  for delete to authenticated using (user_id = auth.uid());

-- matches: readable by everyone signed in; writes only via service role (edge fn)
drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches
  for select to authenticated using (true);

-- predictions: you only ever touch your own, and only before kickoff
drop policy if exists predictions_select on public.predictions;
create policy predictions_select on public.predictions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists predictions_insert on public.predictions;
create policy predictions_insert on public.predictions
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and m.status = 'scheduled'
        and m.kickoff_at > now()
    )
  );

drop policy if exists predictions_update on public.predictions;
create policy predictions_update on public.predictions
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and m.status = 'scheduled'
        and m.kickoff_at > now()
    )
  );

-- ---------------------------------------------------------------------------
--  Realtime: push match score updates to clients (live leaderboard)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'matches'
  ) then
    alter publication supabase_realtime add table public.matches;
  end if;
end $$;
