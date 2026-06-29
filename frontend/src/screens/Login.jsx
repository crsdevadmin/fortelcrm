import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [showPwd, setShowPwd]   = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    // Enforce @fortel.in domain for all users
    if (!email.endsWith('@fortel.in')) {
      setError('Only @fortel.in accounts are allowed to log in.');
      return;
    }

    setLoading(true);
    try {
      const { must_reset_password } = await login(email, password);
      if (must_reset_password) {
        navigate('/change-password');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Fortel logo mark */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <div className="login-logo-mark">
            <span>fort</span>
            <span style={{ position: 'relative', display: 'inline-block' }}>
              <span>e</span>
              <svg style={{ position: 'absolute', top: -5, left: 0, pointerEvents: 'none' }}
                width="12" height="8" viewBox="0 0 12 8">
                <ellipse cx="6" cy="4" rx="5.5" ry="3" fill="#3D8C40" transform="rotate(-20 6 4)"/>
              </svg>
            </span>
            <span>l</span>
          </div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-1)', marginBottom: 4 }}>
          Welcome back
        </div>
        <div className="login-tagline">Doctor Investment, ROI & Growth Platform</div>

        <form onSubmit={handleLogin}>
          <div className="field" style={{ textAlign: 'left', marginBottom: 14 }}>
            <label>Email Address</label>
            <input
              type="email"
              placeholder="yourname@fortel.in"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="field" style={{ textAlign: 'left', marginBottom: 18 }}>
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPwd ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                style={{ paddingRight: 38 }}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
                  color: '#9ca3af', lineHeight: 1, padding: 0,
                }}
                title={showPwd ? 'Hide password' : 'Show password'}
              >
                {showPwd ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && (
            <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 'var(--r-md)', padding: '10px 13px', fontSize: 12, color: 'var(--red)', marginBottom: 14, textAlign: 'left', fontWeight: 500 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', padding: 13, fontSize: 14 }}
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: 20, fontSize: 11, color: 'var(--sub)' }}>
          Contact your admin if you need access or forgot your password.
        </div>
      </div>
    </div>
  );
}
