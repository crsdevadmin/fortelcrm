import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ChangePassword() {
  const { changePassword, user } = useAuth();
  const navigate = useNavigate();
  const [newPwd, setNewPwd]     = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPwd.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (newPwd !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      await changePassword(newPwd);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">FORTEL CRM</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '12px 0 4px' }}>
          Set Your New Password
        </div>
        <div className="login-tagline" style={{ marginBottom: 24 }}>
          Welcome, {user?.name}! Please set a personal password before continuing.
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field" style={{ textAlign: 'left', marginBottom: 14 }}>
            <label>New Password</label>
            <input
              type="password"
              placeholder="Minimum 6 characters"
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              required autoFocus
            />
          </div>
          <div className="field" style={{ textAlign: 'left', marginBottom: 18 }}>
            <label>Confirm Password</label>
            <input
              type="password"
              placeholder="Re-enter your new password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
            />
          </div>

          {error && (
            <div style={{ background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#c62828', marginBottom: 14, textAlign: 'left' }}>
              ⚠️ {error}
            </div>
          )}

          <button type="submit" className="btn-primary" style={{ width: '100%', padding: 13 }} disabled={loading}>
            {loading ? 'Saving…' : 'Set Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
