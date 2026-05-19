import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Pool } from '../lib/types';
import { TopBar } from '../components/TopBar';
import { MatchList } from '../components/MatchList';
import { Leaderboard } from '../components/Leaderboard';

type Tab = 'matches' | 'board';

export function PoolDetail() {
  const { poolId } = useParams<{ poolId: string }>();
  const [pool, setPool] = useState<Pool | null>(null);
  const [tab, setTab] = useState<Tab>('matches');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!poolId) return;
    supabase
      .from('pools')
      .select('*')
      .eq('id', poolId)
      .single()
      .then(({ data }) => {
        setPool(data as Pool | null);
        setLoading(false);
      });
  }, [poolId]);

  async function copyCode() {
    if (!pool) return;
    await navigator.clipboard.writeText(pool.join_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) return <div className="centered muted">Loading…</div>;
  if (!pool) {
    return (
      <div className="app-shell">
        <TopBar />
        <div className="card">
          <p>Pool not found or you're not a member.</p>
          <Link to="/">← Back to your pools</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopBar />

      <div className="card spread">
        <div>
          <h2 style={{ margin: '0 0 4px' }}>{pool.name}</h2>
          <span className="muted" style={{ fontSize: 13 }}>
            Invite friends with code{' '}
            <span className="code" style={{ color: 'var(--accent)' }}>
              {pool.join_code}
            </span>
          </span>
        </div>
        <button className="secondary" onClick={copyCode}>
          {copied ? 'Copied!' : 'Copy code'}
        </button>
      </div>

      <div className="tabs">
        <button
          className={tab === 'matches' ? 'active' : ''}
          onClick={() => setTab('matches')}
        >
          Matches & Picks
        </button>
        <button
          className={tab === 'board' ? 'active' : ''}
          onClick={() => setTab('board')}
        >
          Leaderboard
        </button>
      </div>

      <div className="card">
        {tab === 'matches' ? (
          <MatchList />
        ) : (
          <Leaderboard poolId={pool.id} />
        )}
      </div>
    </div>
  );
}
