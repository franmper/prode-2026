import { Fragment, useCallback, useEffect, useState } from 'react';
import { supabase, selectAll } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  emptyStat,
  roundPointsBreakdown,
  type RoundBreakdown,
  type RoundColumn,
  type UserBreakdown,
} from '../lib/scoring';
import type { LeaderboardRow, Match, Prediction } from '../lib/types';

const EMPTY_BREAKDOWN: RoundBreakdown = { columns: [], byUser: new Map() };

function pctOf(correct: number, finished: number): number | null {
  return finished > 0 ? Math.round((correct / finished) * 100) : null;
}

export function Leaderboard({ poolId }: { poolId: string }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [breakdown, setBreakdown] = useState<RoundBreakdown>(EMPTY_BREAKDOWN);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Orden de la tabla: por puntos totales (default) o por puntos de la fecha.
  const [sortBy, setSortBy] = useState<'total' | 'current'>('total');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [lbRes, mRes, pRes, spRes, mdRes] = await Promise.all([
      supabase.rpc('get_leaderboard', { p_pool_id: poolId }),
      supabase.from('matches').select('*'),
      selectAll<Prediction>(() =>
        supabase.from('predictions').select('*').order('id'),
      ),
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
        pRes.data,
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

  const toggle = (userId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  if (loading) return <p className="muted">Cargando posiciones…</p>;
  if (error) return <div className="error">{error}</div>;

  const { columns, byUser } = breakdown;
  // La "fecha actual" es la última ronda con partidos finalizados.
  const current: RoundColumn | undefined = columns[columns.length - 1];

  // Puntos de la fecha actual para un jugador.
  const currentPtsFor = (r: LeaderboardRow) =>
    current ? (byUser.get(r.user_id)?.perRound.get(current.key)?.points ?? 0) : 0;

  // `rows` ya viene ordenado por puntos totales (RPC). Si se pide ordenar por
  // la fecha, reordenamos por sus puntos (desempate por totales).
  const sortByCurrent = sortBy === 'current' && !!current;
  const sortedRows = sortByCurrent
    ? [...rows].sort(
        (a, b) => currentPtsFor(b) - currentPtsFor(a) || b.points - a.points,
      )
    : rows;

  // Posición de cada jugador en cada fecha (ranking por puntos de esa ronda,
  // con empates compartiendo posición).
  const positionsByRound = new Map<string, Map<string, number>>();
  for (const c of columns) {
    const ranked = rows
      .map((r) => ({
        id: r.user_id,
        pts: byUser.get(r.user_id)?.perRound.get(c.key)?.points ?? 0,
      }))
      .sort((a, b) => b.pts - a.pts);
    const positions = new Map<string, number>();
    let pos = 0;
    let prevPts: number | null = null;
    ranked.forEach((x, idx) => {
      if (prevPts === null || x.pts !== prevPts) {
        pos = idx + 1;
        prevPts = x.pts;
      }
      positions.set(x.id, pos);
    });
    positionsByRound.set(c.key, positions);
  }

  return (
    <div className="board-scroll">
      <table className="board">
        <thead>
          <tr>
            <th className="rank">#</th>
            <th>Jugador</th>
            <th
              className={`num total-pts sortable${sortBy === 'total' ? ' sorted' : ''}`}
              aria-sort={sortBy === 'total' ? 'descending' : 'none'}
              title="Ordenar por puntos totales"
              onClick={() => setSortBy('total')}
            >
              Pts
              {sortBy === 'total' && <span className="sort-arrow">▾</span>}
            </th>
            <th
              className={`num current-pts${current ? ' sortable' : ''}${
                sortByCurrent ? ' sorted' : ''
              }`}
              aria-sort={sortByCurrent ? 'descending' : 'none'}
              title={
                current
                  ? `Ordenar por puntos de ${current.title}`
                  : 'Fecha actual'
              }
              onClick={() => current && setSortBy('current')}
            >
              {current?.label ?? 'Fecha'}
              {sortByCurrent && <span className="sort-arrow">▾</span>}
            </th>
            <th className="num pron" title="Pronósticos hechos">
              Pron.
            </th>
            <th className="caret-col" aria-label="Detalle" />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r, i) => {
            const stats = byUser.get(r.user_id);
            const isOpen = expanded.has(r.user_id);
            const currentPts = currentPtsFor(r);
            return (
              <Fragment key={r.user_id}>
                <tr
                  className={`clickable${r.user_id === user?.id ? ' me' : ''}${
                    isOpen ? ' open' : ''
                  }`}
                  onClick={() => toggle(r.user_id)}
                >
                  <td className="rank">{i + 1}</td>
                  <td>{r.display_name}</td>
                  <td className="num total-pts">
                    <strong>{r.points}</strong>
                  </td>
                  <td
                    className={`num current-pts${currentPts === 0 ? ' zero' : ''}`}
                  >
                    {currentPts}
                  </td>
                  <td className={`num pron${r.predictions_count === 0 ? ' zero' : ''}`}>
                    {r.predictions_count}
                  </td>
                  <td className="caret-col">
                    <span className={`caret${isOpen ? ' open' : ''}`}>▸</span>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="stats-row">
                    <td colSpan={6}>
                      <StatsPanel
                        breakdown={breakdown}
                        stats={stats}
                        row={r}
                        rank={i + 1}
                        positionsByRound={positionsByRound}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatsPanel({
  breakdown,
  stats,
  row,
  rank,
  positionsByRound,
}: {
  breakdown: RoundBreakdown;
  stats: UserBreakdown | undefined;
  row: LeaderboardRow;
  rank: number;
  positionsByRound: Map<string, Map<string, number>>;
}) {
  const { columns } = breakdown;
  const total = stats?.total ?? emptyStat();
  const totalPct = pctOf(total.correct, total.finished);
  const currentKey = columns[columns.length - 1]?.key;

  return (
    <div className="stats-panel">
      <div className="stats-summary">
        <div className="stat-box">
          <span className="stat-label">Pos.</span>
          <span className="stat-value">{rank}°</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Puntos</span>
          <span className="stat-value">{row.points}</span>
        </div>
      </div>
      <div className="stats-summary">
        <div className="stat-box">
          <span className="stat-label">Aciertos</span>
          <span className="stat-value">
            {total.correct}
            <span className="stat-sub">/{total.finished}</span>
          </span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Efectividad</span>
          <span className="stat-value">
            {totalPct !== null ? `${totalPct}%` : '—'}
          </span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Pronósticos</span>
          <span className="stat-value">{row.predictions_count}</span>
        </div>
      </div>

      {columns.length > 0 ? (
        <div className="rounds-list">
          {columns.map((c) => {
            const s = stats?.perRound.get(c.key) ?? emptyStat();
            const p = pctOf(s.correct, s.finished);
            const pos = positionsByRound.get(c.key)?.get(row.user_id);
            return (
              <div
                key={c.key}
                className={`round-card${c.key === currentKey ? ' current' : ''}`}
              >
                <div className="round-card-title">{c.title}</div>
                <div className="round-card-stats">
                  <div className="mini-stat">
                    <span className="mini-label">Pos.</span>
                    <span className="mini-value">{pos ? `${pos}°` : '—'}</span>
                  </div>
                  <div className="mini-stat">
                    <span className="mini-label">Pron.</span>
                    <span className="mini-value">
                      {s.made}
                      <span className="stat-sub">/{c.matchCount}</span>
                    </span>
                  </div>
                  <div className="mini-stat">
                    <span className="mini-label">Aciertos</span>
                    <span className="mini-value">
                      {s.correct}
                      <span className="stat-sub">/{s.finished}</span>
                    </span>
                  </div>
                  <div className="mini-stat">
                    <span className="mini-label">Efec.</span>
                    <span className="mini-value">
                      {p !== null ? `${p}%` : '—'}
                    </span>
                  </div>
                  <div className="mini-stat">
                    <span className="mini-label">Pts</span>
                    <span className="mini-value">{s.points}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">Todavía no hay partidos finalizados.</p>
      )}
    </div>
  );
}
