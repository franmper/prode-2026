-- ============================================================================
--  Switch predictions from exact score to 1-X-2 outcome
--
--  A prediction is now just: home win / draw / away win.
--  Scoring: correct outcome = 1 pt, wrong = 0. No exact-score concept.
--
--  NOTE: this clears existing predictions (they were exact-score test data;
--  the tournament hasn't started, so nothing real is lost). Required because
--  predicted_outcome is NOT NULL and old rows have no outcome.
-- ============================================================================

delete from public.predictions;

alter table public.predictions drop column if exists predicted_home;
alter table public.predictions drop column if exists predicted_away;
alter table public.predictions
  add column if not exists predicted_outcome text not null
  check (predicted_outcome in ('home', 'draw', 'away'));

-- ---------------------------------------------------------------------------
--  Scoring helpers
-- ---------------------------------------------------------------------------

-- Derive the 1-X-2 outcome from a final score (null until the match is played)
create or replace function public.match_outcome(actual_home int, actual_away int)
returns text language sql immutable as $$
  select case
    when actual_home is null or actual_away is null then null
    when actual_home > actual_away then 'home'
    when actual_home < actual_away then 'away'
    else 'draw'
  end;
$$;

-- Old exact-score signature is gone; replace with the outcome one.
drop function if exists public.match_points(int, int, int, int);

create or replace function public.match_points(
  predicted_outcome text, actual_home int, actual_away int
) returns int language sql immutable as $$
  select case
    when predicted_outcome is null then 0
    when predicted_outcome = public.match_outcome(actual_home, actual_away) then 1
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
--  Leaderboard: return shape changes (no more exact/result split), so the
--  function must be dropped and recreated. Points are only counted for
--  FINISHED matches (fixes counting live scores early).
-- ---------------------------------------------------------------------------

drop function if exists public.get_leaderboard(uuid);

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
    raise exception 'No sos miembro de este pozo';
  end if;

  return query
  select
    pm.pool_id,
    pm.user_id,
    pr.display_name,
    coalesce(sum(
      case when m.status = 'finished'
        then public.match_points(p.predicted_outcome, m.home_score, m.away_score)
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
  where pm.pool_id = p_pool_id
  group by pm.pool_id, pm.user_id, pr.display_name
  order by points desc, correct_count desc, pr.display_name asc;
end;
$$;
