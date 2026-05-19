-- ============================================================================
--  Fix: "infinite recursion detected in policy for relation pool_members"
--
--  The pool_members_select policy queried pool_members inside its own USING
--  clause, so evaluating the policy re-evaluated the policy → recursion.
--
--  Fix: a SECURITY DEFINER helper that checks membership WITHOUT triggering
--  RLS (it runs as the function owner, which bypasses row policies). All
--  membership checks in policies now go through it.
-- ============================================================================

create or replace function public.is_pool_member(p_pool_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.pool_members
    where pool_id = p_pool_id and user_id = p_user_id
  );
$$;

-- Lock down who can call it (authenticated users only).
revoke all on function public.is_pool_member(uuid, uuid) from public;
grant execute on function public.is_pool_member(uuid, uuid) to authenticated;

-- pool_members: see membership rows of pools you belong to — via the helper,
-- so the subquery no longer hits pool_members' own RLS.
drop policy if exists pool_members_select on public.pool_members;
create policy pool_members_select on public.pool_members
  for select to authenticated
  using (public.is_pool_member(pool_id, auth.uid()));

-- pools: same membership check, via the helper (avoids any nested RLS chain).
drop policy if exists pools_select on public.pools;
create policy pools_select on public.pools
  for select to authenticated
  using (public.is_pool_member(id, auth.uid()));
