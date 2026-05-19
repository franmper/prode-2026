-- ============================================================================
--  Fix: "column reference \"pool_id\" is ambiguous" (42702) in get_leaderboard
--
--  RETURNS TABLE (pool_id, user_id, ...) declares OUT variables with those
--  names. The inline membership check `where pool_id = p_pool_id and
--  user_id = auth.uid()` then couldn't tell the OUT variable from the
--  pool_members column.
--
--  Fix: do the membership check via public.is_pool_member() (added in the
--  recursion-fix migration) and fully-qualify every column in the query so
--  nothing collides with the OUT parameter names.
-- ============================================================================

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
  if not public.is_pool_member(p_pool_id, auth.uid()) then
    raise exception 'No sos miembro de este pozo';
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
