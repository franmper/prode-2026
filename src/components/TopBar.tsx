import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export function TopBar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');

  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .single()
      .then(({ data }) => setName(data?.display_name ?? ''));
  }, [user]);

  async function onLogout() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="topbar">
      <h1>
        <Link to="/" style={{ color: 'var(--text)' }}>
          Prode <span style={{ color: 'var(--accent)' }}>⚽</span> 2026
        </Link>
      </h1>
      <div className="row">
        {name && <span className="who muted">Hola, {name}</span>}
        <button className="ghost" onClick={onLogout}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
