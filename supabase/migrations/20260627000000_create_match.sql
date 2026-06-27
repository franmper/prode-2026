-- ============================================================================
--  Alta manual de partidos (solo dueño de liga)
--
--  Si football-data.org todavía no publicó un fixture (p. ej. antes del sorteo,
--  o un cruce de eliminatorias aún sin definir), el dueño de la liga puede
--  crear el partido a mano. Se guarda con api_id NULL.
--
--  El sync (edge function) "adopta" el partido manual cuando la API finalmente
--  lo trae: le estampa el api_id real matcheando por los dos equipos, así no
--  se duplica. Ver supabase/functions/sync-fixtures/index.ts.
-- ============================================================================

create or replace function public.create_match(
  p_pool_id    uuid,
  p_stage      text,
  p_group_name text,
  p_matchday   int,
  p_home_team  text,
  p_away_team  text,
  p_kickoff_at timestamptz
) returns public.matches
language plpgsql security definer set search_path = public as $$
declare
  v_match public.matches;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  -- Solo el dueño de la liga puede crear partidos.
  if not exists (
    select 1 from public.pools
    where id = p_pool_id and owner_id = auth.uid()
  ) then
    raise exception 'Solo el dueño de la liga puede crear partidos';
  end if;

  if coalesce(trim(p_home_team), '') = '' or coalesce(trim(p_away_team), '') = '' then
    raise exception 'Elegí los dos equipos';
  end if;
  if lower(trim(p_home_team)) = lower(trim(p_away_team)) then
    raise exception 'Los dos equipos no pueden ser el mismo';
  end if;
  if p_kickoff_at is null then
    raise exception 'Indicá la fecha y hora del partido';
  end if;

  insert into public.matches (
    api_id, stage, group_name, matchday,
    home_team, away_team, kickoff_at, status
  ) values (
    null,                                   -- manual: lo adopta el sync si aparece
    nullif(trim(p_stage), ''),
    nullif(trim(p_group_name), ''),
    p_matchday,
    trim(p_home_team),
    trim(p_away_team),
    p_kickoff_at,
    'scheduled'
  )
  returning * into v_match;

  return v_match;
end;
$$;

revoke all on function public.create_match(uuid, text, text, int, text, text, timestamptz) from public;
grant execute on function public.create_match(uuid, text, text, int, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
--  Borrar un partido cargado a mano (solo dueño, solo si sigue siendo manual:
--  api_id NULL). Borra en cascada los pronósticos asociados.
-- ---------------------------------------------------------------------------

create or replace function public.delete_match(
  p_pool_id  uuid,
  p_match_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if not exists (
    select 1 from public.pools
    where id = p_pool_id and owner_id = auth.uid()
  ) then
    raise exception 'Solo el dueño de la liga puede borrar partidos';
  end if;

  -- Solo partidos manuales: los que vienen de la API se gestionan vía sync.
  if not exists (
    select 1 from public.matches where id = p_match_id and api_id is null
  ) then
    raise exception 'Solo se pueden borrar partidos cargados a mano';
  end if;

  delete from public.matches where id = p_match_id and api_id is null;
end;
$$;

revoke all on function public.delete_match(uuid, uuid) from public;
grant execute on function public.delete_match(uuid, uuid) to authenticated;
