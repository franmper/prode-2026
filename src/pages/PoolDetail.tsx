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

  if (loading) return <div className="centered muted">Cargando…</div>;
  if (!pool) {
    return (
      <div className="app-shell">
        <TopBar />
        <div className="card">
          <p>Pozo no encontrado o no sos miembro.</p>
          <Link to="/">← Volver a tus pozos</Link>
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
            Invitá amigos con el código{' '}
            <span className="code" style={{ color: 'var(--accent)' }}>
              {pool.join_code}
            </span>
          </span>
        </div>
        <button className="secondary" onClick={copyCode}>
          {copied ? '¡Copiado!' : 'Copiar código'}
        </button>
      </div>

      <div className="tabs">
        <button
          className={tab === 'matches' ? 'active' : ''}
          onClick={() => setTab('matches')}
        >
          Partidos y Pronósticos
        </button>
        <button
          className={tab === 'board' ? 'active' : ''}
          onClick={() => setTab('board')}
        >
          Posiciones
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
