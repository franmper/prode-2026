-- ============================================================================
--  Eliminatorias: cierre por fase, 1h antes del primer partido de la fase
--
--  Antes: cada partido de eliminación cerraba a la medianoche (ARG) de SU día.
--  Ahora: toda la fase (LAST_32, LAST_16, …) cierra junta, una hora antes del
--         primer partido de esa fase — igual que la fecha de grupos cierra
--         junta, pero con corte "1h antes del kickoff" en vez de medianoche.
--
--  Fase de grupos: SIN cambios (cierra a la medianoche ARG del día en que
--  arranca la fecha, es decir editable hasta las 23:59 ARG del día anterior).
-- ============================================================================

-- ¿Cuándo arranca la "ronda" de este partido? (kickoff más temprano de ella)
--  Grupos       -> primer partido de la misma fecha (matchday).
--  Eliminatorias-> primer partido de la misma fase (stage).
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
    when m.stage is not null and m.stage <> 'GROUP_STAGE' then (
      select min(x.kickoff_at)
      from public.matches x
      where x.stage = m.stage
    )
    else m.kickoff_at
  end
  from public.matches m
  where m.id = p_match_id;
$$;

-- Instante de cierre.
--  Grupos       -> medianoche (ARG) del día en que arranca la ronda.
--  Eliminatorias-> una hora antes del primer partido de la fase.
create or replace function public.match_lock_at(p_match_id uuid)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when m.stage = 'GROUP_STAGE' then
      date_trunc(
        'day',
        public.round_first_kickoff(p_match_id)
          at time zone 'America/Argentina/Buenos_Aires'
      ) at time zone 'America/Argentina/Buenos_Aires'
    else
      public.round_first_kickoff(p_match_id) - interval '1 hour'
  end
  from public.matches m
  where m.id = p_match_id;
$$;
