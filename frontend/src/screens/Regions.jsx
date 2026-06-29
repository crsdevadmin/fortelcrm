import React, { useEffect, useState } from 'react';
import { regionsAPI } from '../api';

export default function Regions() {
  const [states, setStates] = useState([]);
  const [regions, setRegions] = useState([]);
  const [selected, setSelected] = useState([]);
  const [managerId, setManagerId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([regionsAPI.states(), regionsAPI.list()])
      .then(([sRes, rRes]) => { setStates(sRes.data); setRegions(rRes.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const toggle = (code) =>
    setSelected(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);

  const getManager = (code) => regions.find(r => r.state_code === code)?.manager_name || '—';

  const assign = async () => {
    if (!managerId || selected.length === 0) return alert('Select states and enter manager ID');
    await regionsAPI.assign(selected, Number(managerId));
    setSaved(true);
    setSelected([]);
    const r = await regionsAPI.list();
    setRegions(r.data);
    setTimeout(() => setSaved(false), 3000);
  };

  if (loading) return <div className="loading">Loading regions...</div>;

  return (
    <div>
      <div className="page-title">Region Management</div>
      <div className="page-sub">Assign managers to Indian states</div>

      <div className="form-card">
        <h3>Assign Manager to States</h3>
        <div className="field">
          <label>Manager ID (from User Management)</label>
          <input type="number" placeholder="e.g. 3" value={managerId} onChange={e => setManagerId(e.target.value)} />
        </div>
        <div className="field">
          <label>Select States ({selected.length} selected)</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginTop: 6 }}>
            {states.map(s => (
              <label key={s.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: `1.5px solid ${selected.includes(s.code) ? 'var(--brand)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', background: selected.includes(s.code) ? 'var(--blue-bg)' : '#fff', fontSize: 12, fontWeight: selected.includes(s.code) ? 700 : 400 }}>
                <input type="checkbox" checked={selected.includes(s.code)} onChange={() => toggle(s.code)} style={{ accentColor: 'var(--brand)' }} />
                {s.name}
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--sub)' }}>{getManager(s.code)}</span>
              </label>
            ))}
          </div>
        </div>
        {saved && <div style={{ background: 'var(--green-bg)', color: 'var(--green)', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>✅ States assigned successfully</div>}
        <div className="form-actions">
          <button className="btn-primary" onClick={assign}>Assign Manager to Selected States</button>
          <button className="btn-secondary" onClick={() => setSelected([])}>Clear Selection</button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Current Region Assignments</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>State</th><th>Code</th><th>Assigned Manager</th></tr></thead>
            <tbody>
              {regions.map(r => (
                <tr key={r.id}>
                  <td>{r.state_name}</td>
                  <td><span className="badge blue">{r.state_code}</span></td>
                  <td>{r.manager_name || <span style={{ color: 'var(--sub)' }}>Unassigned</span>}</td>
                </tr>
              ))}
              {regions.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--sub)' }}>No regions assigned yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
