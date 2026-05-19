import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setBusy(true);
    try {
      await signUp(email.trim(), password, displayName);
      // Email confirmation is disabled, so we're logged in immediately.
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign up');
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
        <h2 style={{ margin: 0, fontSize: 18 }}>Create account</h2>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label htmlFor="name">Display name</label>
          <input
            id="name"
            type="text"
            maxLength={40}
            placeholder="How you'll show on the leaderboard"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="full" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Sign up'}
        </button>
      </form>

      <p className="muted" style={{ textAlign: 'center', fontSize: 14 }}>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
