-- ============================================================================
--  Comodín ×2: each player may mark a few knockout matches to count double
--
--  Window: Dieciseisavos → Semifinal (LAST_32, LAST_16, QUARTER_FINALS,
--  SEMI_FINALS). Group stage is excluded (too many, too cheap) and so are the
--  Final / Tercer puesto.
--
--  Per liga the owner controls whether the comodín is on and HOW MANY ×2 picks
--  each player gets across that whole window. A doubled match scores:
--      match_points (0/1) × phase weight × 2
--
--  A pick can be set/removed only while the match is still open (same deadline
--  as predictions); once it locks the ×2 is frozen.
--
--  NOTE: the per-liga config introduced here (pool_settings, a single global
--  count) is superseded by per-phase config in a later migration
--  (..._doubles_per_phase). This file is kept as-is because it was already
--  applied; the follow-up migrates it forward.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Per-liga settings (currently just the comodín knobs).
-- ---------------------------------------------------------------------------

create table if not exists public.pool_settings (
  pool_id       uuid primary key references public.pools (id) on delete cascade,
  doble_enabled boolean not null default true,
  doble_count   int     not null default 1 check (doble_count between 0 and 20)
);

-- Seed defaults for existing ligas, and add to create_pool below for new ones.
insert into public.pool_settings (pool_id)
select id from public.pools
on conflict (pool_id) do nothing;

alter table public.pool_settings enable row level security;

drop policy if exists pool_settings_select on public.pool_settings;
create policy pool_settings_select on public.pool_settings
  for select to authenticated
  using (public.is_pool_member(pool_id, auth.uid()));

drop policy if exists pool_settings_write on public.pool_settings;
create policy pool_settings_write on public.pool_settings
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
--  The ×2 picks themselves. Writes go through set_match_double() only; the
--  table has no client write policy, so the RPC is the single validated path.
-- ---------------------------------------------------------------------------

create table if not exists public.match_doubles (
  pool_id    uuid not null references public.pools (id)   on delete cascade,
  user_id    uuid not null references auth.users (id)     on delete cascade,
  match_id   uuid not null references public.matches (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pool_id, user_id, match_id)
);

create index if not exists match_doubles_match_idx
  on public.match_doubles (match_id);

alter table public.match_doubles enable row level security;

-- Same reveal rule as predictions: your own always; liga-mates' once the match
-- locks (so a ×2 can't be scouted before the deadline).
drop policy if exists match_doubles_select on public.match_doubles;
create policy match_doubles_select on public.match_doubles
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      not public.is_match_open(match_id)
      and public.users_share_pool(auth.uid(), user_id)
    )
  );

-- Which stages may be doubled.
create or replace function public.is_doble_stage(p_stage text)
returns boolean language sql immutable as $$
  select p_stage in ('LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS');
$$;

-- Toggle a ×2 pick with full validation (membership, window, deadline, quota).
create or replace function public.set_match_double(
  p_pool_id uuid, p_match_id uuid, p_on boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_stage   text;
  v_enabled boolean;
  v_count   int;
  v_used    int;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_pool_member(p_pool_id, auth.uid()) then
    raise exception 'No sos miembro de esta liga';
  end if;

  select doble_enabled, doble_count into v_enabled, v_count
  from public.pool_settings where pool_id = p_pool_id;
  if not coalesce(v_enabled, false) then
    raise exception 'El comodín no está habilitado en esta liga';
  end if;

  select stage into v_stage from public.matches where id = p_match_id;
  if v_stage is null or not public.is_doble_stage(v_stage) then
    raise exception 'Este partido no se puede doblar';
  end if;

  if not public.is_match_open(p_match_id) then
    raise exception 'El partido ya está cerrado';
  end if;

  if p_on then
    select count(*) into v_used
    from public.match_doubles
    where pool_id = p_pool_id and user_id = auth.uid();
    if v_used >= coalesce(v_count, 0) then
      raise exception 'Ya usaste todos tus comodines';
    end if;
    insert into public.match_doubles (pool_id, user_id, match_id)
    values (p_pool_id, auth.uid(), p_match_id)
    on conflict (pool_id, user_id, match_id) do nothing;
  else
    delete from public.match_doubles
    where pool_id = p_pool_id and user_id = auth.uid() and match_id = p_match_id;
  end if;
end;
$$;

revoke all on function public.set_match_double(uuid, uuid, boolean) from public;
grant execute on function public.set_match_double(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
--  create_pool: also seed pool_settings for new ligas. (Verbatim body + the
--  stage-points seed from the previous migration + the settings seed.)
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

  insert into public.pool_settings (pool_id) values (v_pool.id);

  return v_pool;
end;
$$;

-- ---------------------------------------------------------------------------
--  get_leaderboard: apply the ×2 on top of the phase weight, per user/match.
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
             * case when d.match_id is not null then 2 else 1 end
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
  left join public.match_doubles d
    on d.pool_id = pm.pool_id and d.user_id = pm.user_id and d.match_id = m.id
  where pm.pool_id = p_pool_id
  group by pm.pool_id, pm.user_id, pr.display_name
  order by points desc, correct_count desc, pr.display_name asc;
end;
$$;
