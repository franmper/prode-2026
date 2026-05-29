-- ============================================================================
--  Per-liga, per-phase point weights
--
--  Until now every correct outcome was worth a flat 1 point, so the group
--  stage (~70% of the matches) decided almost everything. This lets each liga
--  weight the later phases more heavily, so a weak group stage isn't fatal and
--  players can still come back in the knockouts.
--
--  Scoring becomes:  match_points (0/1)  ×  the liga's weight for that stage.
--  Unknown / unconfigured stages fall back to a weight of 1.
-- ============================================================================

create table if not exists public.pool_stage_points (
  pool_id uuid not null references public.pools (id) on delete cascade,
  stage   text not null,
  points  int  not null default 1 check (points between 0 and 100),
  primary key (pool_id, stage)
);

-- The default progressive scale, applied to every existing and future liga.
-- Owners can change these afterwards from the "Puntajes" tab.
create or replace function public.default_stage_points()
returns table (stage text, points int) language sql immutable as $$
  select * from (values
    ('GROUP_STAGE',    1),
    ('LAST_32',        2),
    ('LAST_16',        3),
    ('QUARTER_FINALS', 5),
    ('SEMI_FINALS',    8),
    ('THIRD_PLACE',    5),
    ('FINAL',         10)
  ) as t(stage, points);
$$;

-- Seed defaults for ligas that already exist.
insert into public.pool_stage_points (pool_id, stage, points)
select p.id, d.stage, d.points
from public.pools p cross join public.default_stage_points() d
on conflict (pool_id, stage) do nothing;

-- ---------------------------------------------------------------------------
--  Row Level Security: members read, only the owner writes.
-- ---------------------------------------------------------------------------

alter table public.pool_stage_points enable row level security;

drop policy if exists pool_stage_points_select on public.pool_stage_points;
create policy pool_stage_points_select on public.pool_stage_points
  for select to authenticated
  using (public.is_pool_member(pool_id, auth.uid()));

drop policy if exists pool_stage_points_write on public.pool_stage_points;
create policy pool_stage_points_write on public.pool_stage_points
  for all to authenticated
  using (
    exists (select 1 from public.pools po
            where po.id = pool_id and po.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.pools po
            where po.id = pool_id and po.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
--  create_pool: seed the default weights for every new liga.
--  (Recreated verbatim from the init migration, plus the seeding insert.)
-- ---------------------------------------------------------------------------

create or replace function public.create_pool(p_name text)
returns public.pools language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_pool public.pools;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
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

  insert into public.pool_stage_points (pool_id, stage, points)
  select v_pool.id, d.stage, d.points from public.default_stage_points() d;

  return v_pool;
end;
$$;

-- ---------------------------------------------------------------------------
--  get_leaderboard: weight each correct outcome by the liga's stage points.
--  Shape is unchanged; only the points sum is now weighted. correct_count
--  stays as the raw number of correct outcomes (aciertos), unweighted.
-- ---------------------------------------------------------------------------

create or replace function public.get_leaderboard(p_pool_id uuid)
returns table (
  pool_id           uuid,
  user_id           uuid,
  display_name      text,
  points            int,
  correct_count     int,
  predictions_count int
) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_pool_member(p_pool_id, auth.uid()) then
    raise exception 'No sos miembro de esta liga';
  end if;

  return query
  select
    pm.pool_id,
    pm.user_id,
    pr.display_name,
    coalesce(sum(
      case when m.status = 'finished'
        then public.match_points(p.predicted_outcome, m.home_score, m.away_score)
             * coalesce(sp.points, 1)
        else 0 end
    ), 0)::int as points,
    coalesce(count(*) filter (
      where m.status = 'finished'
        and public.match_points(p.predicted_outcome, m.home_score, m.away_score) = 1
    ), 0)::int as correct_count,
    coalesce(count(p.id), 0)::int as predictions_count
  from public.pool_members pm
  join public.profiles pr on pr.id = pm.user_id
  left join public.predictions p on p.user_id = pm.user_id
  left join public.matches m on m.id = p.match_id
  left join public.pool_stage_points sp
    on sp.pool_id = pm.pool_id and sp.stage = m.stage
  where pm.pool_id = p_pool_id
  group by pm.pool_id, pm.user_id, pr.display_name
  order by points desc, correct_count desc, pr.display_name asc;
end;
$$;
