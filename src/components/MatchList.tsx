import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Match, Prediction } from '../lib/types';
import { matchPoints, isLocked, formatKickoff } from '../lib/scoring';

type Draft = Record<string, { home: string; away: string }>;

export function MatchList() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<Match[]>([]);
  const [preds, setPreds] = useState<Record<string, Prediction>>({});
  const [draft, setDraft] = useState<Draft>({});
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
    // Live-refresh when scores change (Edge Function sync writes to matches).
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

  function setField(id: string, side: 'home' | 'away', value: string) {
    const v = value.replace(/[^0-9]/g, '').slice(0, 2);
    setDraft((d) => {
      const prev = d[id] ?? { home: '', away: '' };
      return { ...d, [id]: { ...prev, [side]: v } };
    });
  }

  async function save(match: Match) {
    if (!user) return;
    const existing = preds[match.id];
    const d = draft[match.id];
    const home = Number(d?.home ?? existing?.predicted_home);
    const away = Number(d?.away ?? existing?.predicted_away);
    if (Number.isNaN(home) || Number.isNaN(away)) {
      setError('Enter both scores first');
      return;
    }
    setSavingId(match.id);
    setError('');
    const { error } = await supabase.from('predictions').upsert(
      {
        user_id: user.id,
        match_id: match.id,
        predicted_home: home,
        predicted_away: away,
      },
      { onConflict: 'user_id,match_id' },
    );
    if (error) {
      setError(error.message);
    } else {
      await load();
      setDraft((dd) => {
        const next = { ...dd };
        delete next[match.id];
        return next;
      });
    }
    setSavingId(null);
  }

  if (loading) return <p className="muted">Loading matches…</p>;
  if (matches.length === 0) {
    return (
      <p className="muted">
        No matches yet. Run the fixtures sync (see README) to load the World Cup
        schedule.
      </p>
    );
  }

  return (
    <div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      {matches.map((m) => {
        const locked = isLocked(m.kickoff_at, m.status);
        const pred = preds[m.id];
        const d = draft[m.id];
        const homeVal = d?.home ?? pred?.predicted_home?.toString() ?? '';
        const awayVal = d?.away ?? pred?.predicted_away?.toString() ?? '';
        const dirty = !!d && (d.home !== '' || d.away !== '');
        const pts =
          m.status === 'finished' && pred
            ? matchPoints(
                pred.predicted_home,
                pred.predicted_away,
                m.home_score,
                m.away_score,
              )
            : null;

        return (
          <div key={m.id} className={`match${locked ? ' locked' : ''}`}>
            <div className="meta">
              <span>
                {[m.stage, m.group_name].filter(Boolean).join(' · ') || 'Match'}
                {' — '}
                {formatKickoff(m.kickoff_at)}
              </span>
              <span>
                {m.status === 'live' && <span className="pill live">LIVE</span>}
                {m.status === 'finished' && (
                  <span className="pill done">FINAL</span>
                )}
                {pts != null && (
                  <span className="pill pts" style={{ marginLeft: 6 }}>
                    +{pts}
                  </span>
                )}
              </span>
            </div>

            <div className="teams">
              <span className="team home">{m.home_team}</span>

              {locked ? (
                <div className="final">
                  {m.home_score ?? '–'} : {m.away_score ?? '–'}
                </div>
              ) : (
                <div className="score-in">
                  <input
                    inputMode="numeric"
                    aria-label={`${m.home_team} score`}
                    value={homeVal}
                    onChange={(e) => setField(m.id, 'home', e.target.value)}
                  />
                  <input
                    inputMode="numeric"
                    aria-label={`${m.away_team} score`}
                    value={awayVal}
                    onChange={(e) => setField(m.id, 'away', e.target.value)}
                  />
                </div>
              )}

              <span className="team away">{m.away_team}</span>
            </div>

            {!locked && (
              <div className="spread" style={{ marginTop: 10 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {pred ? 'Your pick saved — editable until kickoff' : 'Not predicted yet'}
                </span>
                <button
                  onClick={() => save(m)}
                  disabled={savingId === m.id || (!dirty && !!pred)}
                >
                  {savingId === m.id ? 'Saving…' : pred ? 'Update' : 'Save pick'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
