-- ============================================================================
--  UI rename: "pozo" -> "liga" (user-facing wording only).
--  Table/function names stay in English; only the exception messages that
--  surface to users change. Recreates the latest join_pool / get_leaderboard
--  bodies verbatim with just the wording updated.
-- ============================================================================

create or replace function public.join_pool(p_code text)
returns public.pools language plpgsql security definer set search_path = public as $$
declare
  v_pool public.pools;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into v_pool
  from public.pools
  where join_code = upper(trim(p_code));

  if v_pool.id is null then
    raise exception 'No se encontró ninguna liga con ese código';
  end if;

  insert into public.pool_members (pool_id, user_id)
  values (v_pool.id, auth.uid())
  on conflict do nothing;

  return v_pool;
end;
$$;

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
