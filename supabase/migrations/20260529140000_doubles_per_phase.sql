-- ============================================================================
--  Comodín ×2 → per-phase config
--
--  Supersedes the single global knob (pool_settings.doble_enabled/doble_count)
--  with one enabled flag + one per-player quota PER knockout phase. The quota
--  is now counted per phase: spending a ×2 in Dieciseisavos doesn't reduce the
--  ones available in Cuartos.
--
--  Idempotent and safe to replay: creates the new table/config, rewires the
--  functions, and drops pool_settings if it's still around.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Per-liga, per-phase comodín config (enabled flag + per-player quota).
-- ---------------------------------------------------------------------------

create table if not exists public.pool_stage_doubles (
  pool_id uuid    not null references public.pools (id) on delete cascade,
  stage   text    not null,
  enabled boolean not null default true,
  count   int     not null default 1 check (count between 0 and 20),
  primary key (pool_id, stage)
);

-- Default config for every comodín stage, applied to existing + future ligas.
create or replace function public.default_stage_doubles()
returns table (stage text, enabled boolean, count int)
language sql immutable as $$
  select * from (values
    ('LAST_32',        true, 1),
    ('LAST_16',        true, 1),
    ('QUARTER_FINALS', true, 1),
    ('SEMI_FINALS',    true, 1)
  ) as t(stage, enabled, count);
$$;

-- Seed for existing ligas. Where a pool had the old global config, carry its
-- enabled/count across to every phase so behaviour doesn't silently change.
insert into public.pool_stage_doubles (pool_id, stage, enabled, count)
select
  p.id,
  d.stage,
  coalesce(ps.doble_enabled, d.enabled),
  coalesce(ps.doble_count,   d.count)
from public.pools p
cross join public.default_stage_doubles() d
left join public.pool_settings ps on ps.pool_id = p.id
on conflict (pool_id, stage) do nothing;

alter table public.pool_stage_doubles enable row level security;

drop policy if exists pool_stage_doubles_select on public.pool_stage_doubles;
create policy pool_stage_doubles_select on public.pool_stage_doubles
  for select to authenticated
  using (public.is_pool_member(pool_id, auth.uid()));

drop policy if exists pool_stage_doubles_write on public.pool_stage_doubles;
create policy pool_stage_doubles_write on public.pool_stage_doubles
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
--  Toggle a ×2 pick — now validates against the PER-PHASE config and counts
--  the quota per stage.
-- ---------------------------------------------------------------------------

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

  select stage into v_stage from public.matches where id = p_match_id;
  if v_stage is null or not public.is_doble_stage(v_stage) then
    raise exception 'Este partido no se puede doblar';
  end if;

  -- Per-phase config for this match's stage.
  select sd.enabled, sd.count into v_enabled, v_count
  from public.pool_stage_doubles sd
  where sd.pool_id = p_pool_id and sd.stage = v_stage;
  if not coalesce(v_enabled, false) then
    raise exception 'El comodín no está habilitado en esta fase';
  end if;

  if not public.is_match_open(p_match_id) then
    raise exception 'El partido ya está cerrado';
  end if;

  if p_on then
    -- Quota is per phase: count only this user's ×2 picks in the same stage.
    select count(*) into v_used
    from public.match_doubles md
    join public.matches mm on mm.id = md.match_id
    where md.pool_id = p_pool_id
      and md.user_id = auth.uid()
      and mm.stage = v_stage;
    if v_used >= coalesce(v_count, 0) then
      raise exception 'Ya usaste todos tus comodines de esta fase';
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

-- ---------------------------------------------------------------------------
--  create_pool: seed per-phase comodín config (instead of pool_settings).
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

  insert into public.pool_stage_doubles (pool_id, stage, enabled, count)
  select v_pool.id, d.stage, d.enabled, d.count
  from public.default_stage_doubles() d;

  return v_pool;
end;
$$;

-- ---------------------------------------------------------------------------
--  Retire the old global settings table (no longer referenced).
-- ---------------------------------------------------------------------------

drop table if exists public.pool_settings;
