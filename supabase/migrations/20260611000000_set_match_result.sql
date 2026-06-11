-- ============================================================================
--  Carga manual de resultados (solo dueño de liga)
--
--  El plan gratuito de football-data.org marca el partido como FINISHED pero
--  no devuelve el marcador, así que el dueño de una liga puede completar el
--  resultado a mano. El sync (edge function) ya respeta los partidos completos
--  y no los pisa.
--
--  Grupos:        se cargan los goles; el ganador 1-X-2 se deriva del marcador.
--  Eliminatorias: se carga quién avanza (winner); el marcador es opcional.
-- ============================================================================

create or replace function public.set_match_result(
  p_pool_id    uuid,
  p_match_id   uuid,
  p_home_score int,
  p_away_score int,
  p_winner     text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_stage text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  -- Solo el dueño de la liga puede cargar resultados.
  if not exists (
    select 1 from public.pools
    where id = p_pool_id and owner_id = auth.uid()
  ) then
    raise exception 'Solo el dueño de la liga puede cargar resultados';
  end if;

  select stage into v_stage from public.matches where id = p_match_id;
  if not found then
    raise exception 'Partido inexistente';
  end if;

  if public.is_knockout(v_stage) then
    if p_winner not in ('home', 'away') then
      raise exception 'En eliminatorias hay que indicar quién avanza';
    end if;
    update public.matches set
      home_score = p_home_score,
      away_score = p_away_score,
      winner     = p_winner,
      status     = 'finished'
    where id = p_match_id;
  else
    if p_home_score is null or p_away_score is null then
      raise exception 'Cargá ambos marcadores';
    end if;
    update public.matches set
      home_score = p_home_score,
      away_score = p_away_score,
      winner     = public.match_outcome(p_home_score, p_away_score),
      status     = 'finished'
    where id = p_match_id;
  end if;
end;
$$;

revoke all on function public.set_match_result(uuid, uuid, int, int, text) from public;
grant execute on function public.set_match_result(uuid, uuid, int, int, text) to authenticated;
