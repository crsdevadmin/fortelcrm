import React, { useEffect, useState } from 'react';
import { usersAPI } from '../api';

export default function PendingApprovals() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    usersAPI.pendingApprovals()
      .then(r => { setUsers(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const approve = async (id) => {
    await usersAPI.approve(id, 'associate', null, null);
    load();
  };

  const reject = async (id) => {
    await usersAPI.reject(id);
    load();
  };

  if (loading) return <div className="loading">Loading approvals...</div>;

  return (
    <div>
      <div className="page-title">Pending Approvals</div>
      <div className="page-sub">{users.length} users awaiting access</div>

      {users.length === 0 ? (
        <div className="empty">✅ No pending approvals. All users have been reviewed.</div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Email (Gmail)</th><th>Requested</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td><strong>{u.name}</strong></td>
                    <td>{u.email}</td>
                    <td style={{ color: 'var(--sub)', fontSize: 12 }}>
                      {new Date(u.created_at).toLocaleDateString('en-IN')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn-sm green" onClick={() => approve(u.id)}>✓ Approve</button>
                        <button className="btn-sm red" onClick={() => reject(u.id)}>✗ Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
