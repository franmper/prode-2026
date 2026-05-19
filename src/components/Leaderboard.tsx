import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { LeaderboardRow } from '../lib/types';

export function Leaderboard({ poolId }: { poolId: string }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_leaderboard', {
      p_pool_id: poolId,
    });
    if (error) setError(error.message);
    else setRows((data as LeaderboardRow[]) ?? []);
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

  return (
    <table className="board">
      <thead>
        <tr>
          <th className="rank">#</th>
          <th>Jugador</th>
          <th className="num">Pts</th>
          <th className="num">Aciertos</th>
          <th className="num">Pronósticos</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.user_id} className={r.user_id === user?.id ? 'me' : ''}>
            <td className="rank">{i + 1}</td>
            <td>{r.display_name}</td>
            <td className="num">
              <strong>{r.points}</strong>
            </td>
            <td className="num">{r.correct_count}</td>
            <td className="num">{r.predictions_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
