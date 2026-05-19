import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Match, Prediction, Outcome } from '../lib/types';
import { matchPoints, isLocked, formatKickoff } from '../lib/scoring';

export function MatchList() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<Match[]>([]);
  const [preds, setPreds] = useState<Record<string, Prediction>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [m, p] = await Promise.all([
      supabase.from('matches').select('*').order('kickoff_at'),
      supabase.from('predictions').select('*'),
    ]);
    if (m.error) setError(m.error.message);
    setMatches((m.data as Match[]) ?? []);
    const map: Record<string, Prediction> = {};
    for (const row of (p.data as Prediction[]) ?? []) map[row.match_id] = row;
    setPreds(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Refresca en vivo cuando cambian los resultados (los escribe la Edge Function).
    const channel = supabase
      .channel('matches-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function pick(match: Match, outcome: Outcome) {
    if (!user || savingId) return;
    setSavingId(match.id);
    setError('');
    const { error } = await supabase.from('predictions').upsert(
      { user_id: user.id, match_id: match.id, predicted_outcome: outcome },
      { onConflict: 'user_id,match_id' },
    );
    if (error) setError(error.message);
    else await load();
    setSavingId(null);
  }

  if (loading) return <p className="muted">Cargando partidos…</p>;
  if (matches.length === 0) {
    return (
      <p className="muted">
        Todavía no hay partidos. Ejecutá la sincronización del fixture (ver
        README) para cargar el calendario del Mundial.
      </p>
    );
  }

  const label = (m: Match, o: Outcome) =>
    o === 'home' ? `Gana ${m.home_team}` : o === 'away' ? `Gana ${m.away_team}` : 'Empate';

  return (
    <div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      {matches.map((m) => {
        const locked = isLocked(m.kickoff_at, m.status);
        const pred = preds[m.id];
        const finished = m.status === 'finished';
        const pts = finished && pred
          ? matchPoints(pred.predicted_outcome, m.home_score, m.away_score)
          : null;
        const options: Outcome[] = ['home', 'draw', 'away'];

        return (
          <div key={m.id} className={`match${locked ? ' locked' : ''}`}>
            <div className="meta">
              <span>
                {[m.stage, m.group_name].filter(Boolean).join(' · ') || 'Partido'}
                {' — '}
                {formatKickoff(m.kickoff_at)}
              </span>
              <span>
                {m.status === 'live' && <span className="pill live">EN VIVO</span>}
                {finished && <span className="pill done">FINAL</span>}
                {pts != null && (
                  <span className="pill pts" style={{ marginLeft: 6 }}>
                    +{pts}
                  </span>
                )}
              </span>
            </div>

            <div className="matchup">
              <span className="team">{m.home_team}</span>
              <span className="vs">
                {locked ? `${m.home_score ?? '–'} : ${m.away_score ?? '–'}` : 'vs'}
              </span>
              <span className="team" style={{ textAlign: 'right' }}>
                {m.away_team}
              </span>
            </div>

            {locked ? (
              <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                {pred ? (
                  <>
                    Tu pronóstico: <strong>{label(m, pred.predicted_outcome)}</strong>
                    {finished &&
                      (pts ? ' — ¡Acertaste! ✓' : ' — No acertaste ✗')}
                  </>
                ) : (
                  'No pronosticaste este partido'
                )}
              </div>
            ) : (
              <>
                <div className="outcomes">
                  {options.map((o) => (
                    <button
                      key={o}
                      className={
                        'outcome-btn' +
                        (pred?.predicted_outcome === o ? ' active' : '')
                      }
                      disabled={savingId === m.id}
                      onClick={() => pick(m, o)}
                    >
                      {label(m, o)}
                    </button>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  {savingId === m.id
                    ? 'Guardando…'
                    : pred
                      ? 'Pronóstico guardado — editable hasta el inicio'
                      : 'Elegí un resultado'}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
