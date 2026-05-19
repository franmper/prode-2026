-- ============================================================================
--  Round-based prediction deadline
--
--  Group stage: all matches of a Fecha (matchday 1/2/3) lock together, at the
--  start of the calendar day (Argentina, UTC-3) of the FIRST match of that
--  Fecha — i.e. editable until 23:59 ARG the day before the round starts.
--
--  Knockouts: no matchday; each match locks the day before THAT match (the
--  bracket isn't known until prior rounds finish, and stages span many days).
-- ============================================================================

alter table public.matches add column if not exists matchday int;
create index if not exists matches_round_idx
  on public.matches (stage, matchday);

-- When does the round containing this match start? (earliest kickoff in it)
create or replace function public.round_first_kickoff(p_match_id uuid)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when m.stage = 'GROUP_STAGE' and m.matchday is not null then (
      select min(x.kickoff_at)
      from public.matches x
      where x.stage = 'GROUP_STAGE' and x.matchday = m.matchday
    )
    else m.kickoff_at
  end
  from public.matches m
  where m.id = p_match_id;
$$;

-- Lock instant = midnight (ARG) of the day the round starts.
-- That instant is exactly "23:59:59 ARG of the day before" + 1 second.
create or replace function public.match_lock_at(p_match_id uuid)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select date_trunc(
           'day',
           public.round_first_kickoff(p_match_id)
             at time zone 'America/Argentina/Buenos_Aires'
         ) at time zone 'America/Argentina/Buenos_Aires';
$$;

-- A prediction can be made/changed only while the match is still scheduled
-- AND we haven't reached its round's lock instant.
create or replace function public.is_match_open(p_match_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.matches m
    where m.id = p_match_id
      and m.status = 'scheduled'
      and now() < public.match_lock_at(p_match_id)
  );
$$;

revoke all on function public.round_first_kickoff(uuid) from public;
revoke all on function public.match_lock_at(uuid)       from public;
revoke all on function public.is_match_open(uuid)       from public;
grant execute on function public.round_first_kickoff(uuid) to authenticated;
grant execute on function public.match_lock_at(uuid)       to authenticated;
grant execute on function public.is_match_open(uuid)       to authenticated;

-- ---------------------------------------------------------------------------
--  Predictions now lock at the round deadline, not at kickoff
-- ---------------------------------------------------------------------------

drop policy if exists predictions_insert on public.predictions;
create policy predictions_insert on public.predictions
  for insert to authenticated with check (
    user_id = auth.uid() and public.is_match_open(match_id)
  );

drop policy if exists predictions_update on public.predictions;
create policy predictions_update on public.predictions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_match_open(match_id));
