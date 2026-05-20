-- ============================================================================
--  Show predictions to liga-mates after the match locks
--
--  Before lock: predictions stay private (only the owner sees them).
--  After lock:  any user that shares at least one liga with the prediction's
--               owner can see it (their picks are no longer editable, so
--               revealing them is safe).
-- ============================================================================

-- Do auth.uid() and another user share any pool? (Bypasses RLS via SECURITY
-- DEFINER, so the check itself never recurses through pool_members policies.)
create or replace function public.users_share_pool(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pool_members pa
    join public.pool_members pb on pb.pool_id = pa.pool_id
    where pa.user_id = a and pb.user_id = b
  );
$$;

revoke all on function public.users_share_pool(uuid, uuid) from public;
grant execute on function public.users_share_pool(uuid, uuid) to authenticated;

drop policy if exists predictions_select on public.predictions;
create policy predictions_select on public.predictions
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      not public.is_match_open(match_id)
      and public.users_share_pool(auth.uid(), user_id)
    )
  );
