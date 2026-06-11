import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Pool } from '../lib/types';
import { TopBar } from '../components/TopBar';
import { MatchList } from '../components/MatchList';
import { Leaderboard } from '../components/Leaderboard';
import { MembersPanel } from '../components/MembersPanel';
import { ScoringPanel } from '../components/ScoringPanel';
import { RulesPanel } from '../components/RulesPanel';
import { ResultsPanel } from '../components/ResultsPanel';

type Tab = 'matches' | 'board' | 'rules' | 'members' | 'scoring' | 'results';

export function PoolDetail() {
  const { poolId } = useParams<{ poolId: string }>();
  const { user } = useAuth();
  const [pool, setPool] = useState<Pool | null>(null);
  const [tab, setTab] = useState<Tab>('matches');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

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

  async function syncFixtures() {
    setSyncing(true);
    setSyncMsg('');
    const { data, error } = await supabase.functions.invoke('sync-fixtures');
    if (error) {
      // The function returns its own JSON error body on non-2xx.
      let detail = error.message;
      try {
        const body = await (error as { context?: Response }).context?.json();
        if (body?.error) detail = body.error;
      } catch {
        /* keep generic message */
      }
      setSyncMsg(`Error al sincronizar: ${detail}`);
    } else {
      setSyncMsg(`Fixture sincronizado: ${data?.synced ?? 0} partidos.`);
      // MatchList/Leaderboard auto-refresh via the matches realtime subscription.
    }
    setSyncing(false);
  }

  if (loading) return <div className="centered muted">Cargando…</div>;
  if (!pool) {
    return (
      <div className="app-shell">
        <TopBar />
        <div className="card">
          <p>Liga no encontrada o no sos miembro.</p>
          <Link to="/">← Volver a tus ligas</Link>
        </div>
      </div>
    );
  }

  const isOwner = !!user && user.id === pool.owner_id;

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
        <div className="row">
          {isOwner && (
            <button
              className="secondary"
              onClick={syncFixtures}
              disabled={syncing}
              title="Solo el dueño de la liga: actualiza partidos y resultados desde la API"
            >
              {syncing ? 'Sincronizando…' : 'Sincronizar fixture'}
            </button>
          )}
          <button className="secondary" onClick={copyCode}>
            {copied ? '¡Copiado!' : 'Copiar código'}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div
          className={syncMsg.startsWith('Error') ? 'error' : 'card'}
          style={{ marginBottom: 16, fontSize: 14 }}
        >
          {syncMsg}
        </div>
      )}

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
        <button
          className={tab === 'rules' ? 'active' : ''}
          onClick={() => setTab('rules')}
        >
          Reglas
        </button>
        {isOwner && (
          <button
            className={tab === 'members' ? 'active' : ''}
            onClick={() => setTab('members')}
          >
            Miembros
          </button>
        )}
        {isOwner && (
          <button
            className={tab === 'scoring' ? 'active' : ''}
            onClick={() => setTab('scoring')}
          >
            Puntajes
          </button>
        )}
        {isOwner && (
          <button
            className={tab === 'results' ? 'active' : ''}
            onClick={() => setTab('results')}
          >
            Resultados
          </button>
        )}
      </div>

      {tab === 'matches' && <MatchList poolId={pool.id} />}
      {tab === 'board' && (
        <div className="card">
          <Leaderboard poolId={pool.id} />
        </div>
      )}
      {tab === 'rules' && (
        <div className="card">
          <RulesPanel poolId={pool.id} />
        </div>
      )}
      {tab === 'members' && isOwner && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Miembros de la liga</h3>
          <MembersPanel poolId={pool.id} />
        </div>
      )}
      {tab === 'scoring' && isOwner && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Puntajes por fase</h3>
          <ScoringPanel poolId={pool.id} />
        </div>
      )}
      {tab === 'results' && isOwner && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Cargar resultados</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Completá el marcador de cada partido. Una vez cargado, la
            sincronización automática no lo pisa.
          </p>
          <ResultsPanel poolId={pool.id} />
        </div>
      )}
    </div>
  );
}
