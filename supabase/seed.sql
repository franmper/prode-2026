-- Seed data for PREVIEW BRANCHES and local `supabase db reset` only.
-- Not applied to production. Negative api_id values keep these clearly
-- separate from real football-data.org fixtures (which use positive ids),
-- so the sync function never collides with them.

insert into public.matches
  (api_id, stage, group_name, home_team, away_team, kickoff_at, home_score, away_score, status)
values
  (-1, 'GROUP_STAGE', 'Group A', 'Argentina', 'Brazil',
     now() + interval '2 days', null, null, 'scheduled'),
  (-2, 'GROUP_STAGE', 'Group A', 'France',    'Spain',
     now() + interval '3 days', null, null, 'scheduled'),
  (-3, 'GROUP_STAGE', 'Group B', 'England',   'Germany',
     now() - interval '1 day',  2,    1,    'finished')
on conflict (api_id) do nothing;
