// Shared domain types, mirroring the Supabase schema in db/schema.sql

export type MatchStatus = 'scheduled' | 'live' | 'finished';

export interface Profile {
  id: string;
  display_name: string;
  created_at: string;
}

export interface Pool {
  id: string;
  name: string;
  owner_id: string;
  join_code: string;
  created_at: string;
}

export interface PoolMember {
  pool_id: string;
  user_id: string;
  joined_at: string;
}

export interface Match {
  id: string;
  api_id: number | null;
  stage: string | null;
  group_name: string | null;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  home_score: number | null;
  away_score: number | null;
  status: MatchStatus;
}

export interface Prediction {
  id: string;
  user_id: string;
  match_id: string;
  predicted_home: number;
  predicted_away: number;
  created_at: string;
  updated_at: string;
}

export interface LeaderboardRow {
  pool_id: string;
  user_id: string;
  display_name: string;
  points: number;
  exact_count: number;
  result_count: number;
  predictions_count: number;
}
