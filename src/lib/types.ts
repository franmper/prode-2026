// Shared domain types, mirroring the Supabase schema in supabase/migrations/.

export type MatchStatus = 'scheduled' | 'live' | 'finished';

// 1-X-2 prediction: home win / draw / away win
export type Outcome = 'home' | 'draw' | 'away';

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
  matchday: number | null;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  home_score: number | null;
  away_score: number | null;
  // Who advances (knockouts) / 1-X-2 result — from the API, accounts for ET
  // and penalties. Null until decided.
  winner: Outcome | null;
  status: MatchStatus;
}

export interface Prediction {
  id: string;
  user_id: string;
  match_id: string;
  predicted_outcome: Outcome;
  created_at: string;
  updated_at: string;
}

// Per-liga, per-phase point weight. A correct outcome in a given stage is
// worth `points` instead of a flat 1, letting later phases count for more.
export interface StagePoints {
  pool_id: string;
  stage: string;
  points: number;
}

// Per-liga, per-phase comodín ×2 config. `count` is how many ×2 picks each
// player gets in that phase; `enabled` turns the comodín on for the phase.
export interface StageDouble {
  pool_id: string;
  stage: string;
  enabled: boolean;
  count: number;
}

export interface LeaderboardRow {
  pool_id: string;
  user_id: string;
  display_name: string;
  points: number;
  correct_count: number;
  predictions_count: number;
}
