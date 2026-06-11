import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { roundPointsBreakdown, type RoundBreakdown } from '../lib/scoring';
import type { LeaderboardRow, Match, Prediction } from '../lib/types';

const EMPTY_BREAKDOWN: RoundBreakdown = { columns: [], byUser: new Map() };

export function Leaderboard({ poolId }: { poolId: string }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [breakdown, setBreakdown] = useState<RoundBreakdown>(EMPTY_BREAKDOWN);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [lbRes, mRes, pRes, spRes, mdRes] = await Promise.all([
      supabase.rpc('get_leaderboard', { p_pool_id: poolId }),
      supabase.from('matches').select('*'),
      supabase.from('predictions').select('*'),
      supabase
        .from('pool_stage_points')
        .select('stage, points')
        .eq('pool_id', poolId),
      supabase
        .from('match_doubles')
        .select('user_id, match_id')
        .eq('pool_id', poolId),
    ]);

    if (lbRes.error) {
      setError(lbRes.error.message);
      setLoading(false);
      return;
    }
    setRows((lbRes.data as LeaderboardRow[]) ?? []);

    const stagePoints: Record<string, number> = {};
    for (const r of (spRes.data as { stage: string; points: number }[]) ?? []) {
      stagePoints[r.stage] = r.points;
    }
    const doubled = new Set<string>();
    for (const r of (mdRes.data as { user_id: string; match_id: string }[]) ??
      []) {
      doubled.add(`${r.user_id}|${r.match_id}`);
    }
    setBreakdown(
      roundPointsBreakdown(
        (mRes.data as Match[]) ?? [],
        (pRes.data as Prediction[]) ?? [],
        stagePoints,
        doubled,
      ),
    );
    setLoading(false);
  }, [poolId]);

  useEffect(() => {
    load();
    // Recalcula cuando cambian los resultados de los partidos.
    const channel = supabase
      .channel(`board-${poolId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, poolId]);

  if (loading) return <p className="muted">Cargando posiciones…</p>;
  if (error) return <div className="error">{error}</div>;

  const { columns, byUser } = breakdown;

  return (
    <div className="board-scroll">
      <table className="board">
        <thead>
          <tr>
            <th className="rank">#</th>
            <th>Jugador</th>
            <th className="num">Pts</th>
            {columns.map((c) => (
              <th key={c.key} className="num fecha" title={c.title}>
                {c.label}
              </th>
            ))}
            <th className="num" title="Aciertos / Pronósticos">Aciertos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const cells = byUser.get(r.user_id);
            return (
              <tr key={r.user_id} className={r.user_id === user?.id ? 'me' : ''}>
                <td className="rank">{i + 1}</td>
                <td>{r.display_name}</td>
                <td className="num">
                  <strong>{r.points}</strong>
                </td>
                {columns.map((c) => {
                  const pts = cells?.get(c.key) ?? 0;
                  return (
                    <td
                      key={c.key}
                      className={`num fecha${pts === 0 ? ' zero' : ''}`}
                    >
                      {pts}
                    </td>
                  );
                })}
                <td className="num">
                  {r.correct_count}/{r.predictions_count}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
