-- ============================================================================
--  Eliminatorias: cerrar 5 minutos antes (no 1 hora) del primer partido
--
--  El cliente (lockAt en src/lib/scoring.ts) ya cierra los knockouts 5 min
--  antes del primer partido de la fase. La RLS seguía cerrando 1h antes, así
--  que entre 1h-antes y 5min-antes la app mostraba el formulario pero la base
--  rechazaba el pronóstico (error de RLS). Alineamos el SQL al cliente.
--
--  Fase de grupos: SIN cambios (cierra a la medianoche ARG del día en que
--  arranca la fecha).
-- ============================================================================

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
      public.round_first_kickoff(p_match_id) - interval '5 minutes'
  end
  from public.matches m
  where m.id = p_match_id;
$$;
