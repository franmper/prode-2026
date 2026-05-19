import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="brand">
        Prode <span className="ball">⚽</span> 2026
      </div>
      <p className="tagline muted">Predict the World Cup. Beat your friends.</p>

      <form className="card stack" onSubmit={onSubmit}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Log in</h2>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="full" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>
      </form>

      <p className="muted" style={{ textAlign: 'center', fontSize: 14 }}>
        No account? <Link to="/signup">Create one</Link>
      </p>
    </div>
  );
}
