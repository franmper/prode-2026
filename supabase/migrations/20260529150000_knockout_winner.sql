-- ============================================================================
--  Eliminatorias: el acierto es "quién avanza", no el marcador a los 90'
--
--  Fase de grupos  -> 1-X-2 del marcador final (como siempre).
--  Eliminación directa -> el equipo que clasifica (incluye alargue y penales).
--
--  Para saberlo usamos el ganador real que reporta la API (score.winner),
--  guardado normalizado en matches.winner como 'home' | 'away' (o 'draw' en
--  grupos). El sync (edge function) llena esta columna.
-- ============================================================================

alter table public.matches add column if not exists winner text;

-- ¿Es una fase de eliminación directa? (todas menos la de grupos)
create or replace function public.is_knockout(p_stage text)
returns boolean language sql immutable as $$
  select p_stage in (
    'LAST_32', 'LAST_16', 'QUARTER_FINALS',
    'SEMI_FINALS', 'THIRD_PLACE', 'FINAL'
  );
$$;

-- Resultado que vale para puntuar: en knockouts, quién avanza (winner);
-- en grupos, el 1-X-2 del marcador.
create or replace function public.match_actual(
  p_stage text, p_home int, p_away int, p_winner text
) returns text language sql immutable as $$
  select case
    when public.is_knockout(p_stage) then p_winner
    else public.match_outcome(p_home, p_away)
  end;
$$;

-- ---------------------------------------------------------------------------
--  get_leaderboard: comparar el pronóstico contra match_actual (knockout =
--  quién avanza), manteniendo el peso por fase y el comodín ×2.
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
        and p.predicted_outcome =
            public.match_actual(m.stage, m.home_score, m.away_score, m.winner)
        then coalesce(sp.points, 1)
             * case when d.match_id is not null then 2 else 1 end
        else 0 end
    ), 0)::int as points,
    coalesce(count(*) filter (
      where m.status = 'finished'
        and p.predicted_outcome =
            public.match_actual(m.stage, m.home_score, m.away_score, m.winner)
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
