import React, { useEffect, useState } from 'react';
import { usersAPI } from '../api';

export default function UserManagement() {
  const [hierarchy, setHierarchy] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    usersAPI.hierarchy()
      .then(r => { setHierarchy(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading hierarchy...</div>;

  return (
    <div>
      <div className="page-title">User Management</div>
      <div className="page-sub">MD → Directors → Managers → Associates</div>

      {/* MD row */}
      <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22 }}>👑</span>
          <div>
            <div style={{ fontWeight: 800 }}>Thirumurugan</div>
            <div style={{ fontSize: 11, color: 'var(--sub)' }}>mdthiru@gmail.com · MD / Admin</div>
          </div>
          <span className="badge blue" style={{ marginLeft: 'auto' }}>MD</span>
        </div>
      </div>

      {hierarchy.length === 0 ? (
        <div className="empty">No directors added yet. Approve users from Pending Approvals.</div>
      ) : (
        hierarchy.map(dir => (
          <div key={dir.id} className="card" style={{ borderLeft: '4px solid #1565c0', marginLeft: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 18 }}>📊</span>
              <div>
                <div style={{ fontWeight: 700 }}>{dir.name}</div>
                <div style={{ fontSize: 11, color: 'var(--sub)' }}>{dir.email}</div>
              </div>
              <span className="badge purple" style={{ marginLeft: 'auto' }}>Director</span>
            </div>
            {dir.managers?.map(mgr => (
              <div key={mgr.id} style={{ marginLeft: 20, marginBottom: 10, background: 'var(--bg)', borderRadius: 10, padding: '10px 14px', borderLeft: '3px solid var(--teal)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span>🗂</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{mgr.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--sub)' }}>{mgr.email}</div>
                  </div>
                  <span className="badge teal" style={{ marginLeft: 'auto' }}>Manager</span>
                </div>
                {mgr.associates?.map(a => (
                  <div key={a.id} style={{ marginLeft: 20, padding: '6px 10px', background: '#fff', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span>📝</span>
                    <span style={{ fontWeight: 600 }}>{a.name}</span>
                    <span style={{ color: 'var(--sub)' }}>{a.email}</span>
                    <span className="badge green" style={{ marginLeft: 'auto' }}>Associate</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
