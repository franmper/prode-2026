import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Pool } from '../lib/types';
import { TopBar } from '../components/TopBar';

export function Dashboard() {
  const navigate = useNavigate();
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadPools = useCallback(async () => {
    const { data, error } = await supabase
      .from('pools')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setPools(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPools();
  }, [loadPools]);

  async function createPool(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data, error } = await supabase
        .rpc('create_pool', { p_name: newName.trim() })
        .single<Pool>();
      if (error) throw error;
      setNewName('');
      if (data) navigate(`/pool/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create pool');
    } finally {
      setBusy(false);
    }
  }

  async function joinPool(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data, error } = await supabase
        .rpc('join_pool', { p_code: joinCode.trim().toUpperCase() })
        .single<Pool>();
      if (error) throw error;
      setJoinCode('');
      if (data) navigate(`/pool/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join pool');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <TopBar />

      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Your pools</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : pools.length === 0 ? (
          <p className="muted">
            You're not in any pool yet. Create one or join with a code.
          </p>
        ) : (
          pools.map((p) => (
            <div
              key={p.id}
              className="pool-item"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/pool/${p.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/pool/${p.id}`)}
            >
              <strong>{p.name}</strong>
              <span className="code">{p.join_code}</span>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Create a pool</h3>
        <form className="row" onSubmit={createPool}>
          <input
            placeholder="Pool name (e.g. Office World Cup)"
            value={newName}
            maxLength={60}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
          <button type="submit" disabled={busy}>
            Create
          </button>
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Join a pool</h3>
        <form className="row" onSubmit={joinPool}>
          <input
            placeholder="6-letter code"
            value={joinCode}
            maxLength={6}
            style={{ textTransform: 'uppercase', letterSpacing: 2 }}
            onChange={(e) => setJoinCode(e.target.value)}
            required
          />
          <button className="secondary" type="submit" disabled={busy}>
            Join
          </button>
        </form>
      </div>
    </div>
  );
}
