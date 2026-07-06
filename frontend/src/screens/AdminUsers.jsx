import React, { useEffect, useState } from 'react';
import axios from 'axios';
import RegionView from './RegionView';

const API = process.env.REACT_APP_API_URL || '';

const ROLES = [
  { value: 'md',             label: 'MD' },
  { value: 'director',       label: 'Director' },
  { value: 'senior_manager', label: 'Senior Manager' },
  { value: 'manager',        label: 'Manager' },
  { value: 'rep',            label: 'Sales Rep' },
  { value: 'custom',         label: 'Custom (specify below)' },
];

const ROLE_COLORS = {
  admin:          { bg: '#f5f3ff', text: '#7c3aed', border: '#ddd6fe' },
  md:             { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  director:       { bg: '#ecfeff', text: '#0891b2', border: '#a5f3fc' },
  senior_manager: { bg: '#f0fdf4', text: '#065f46', border: '#a7f3d0' },
  manager:        { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
  rep:            { bg: '#fffbeb', text: '#92400e', border: '#fcd34d' },
  custom:         { bg: '#f9fafb', text: '#6b7280', border: '#e5e7eb' },
};

const roleColor = (role) => ROLE_COLORS[role] || ROLE_COLORS.custom;
const avatarColor = (role) => {
  const map = { admin:'#7c3aed', md:'#1d4ed8', director:'#0891b2', senior_manager:'#065f46', manager:'#166534', rep:'#92400e', custom:'#6b7280' };
  return map[role] || '#6b7280';
};
const initials = name => (name || '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();

// ── Hierarchy tree ──────────────────────────────────────────────
function TreeNode({ node, depth = 0 }) {
  const [open, setOpen] = useState(true);
  const rc = roleColor(node.role);
  const hasChildren = node.reports.length > 0;

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
          background: depth === 0 ? '#f8f9ff' : '#fff', border: `1px solid ${rc.border}`,
          borderRadius: 10, marginBottom: 5, cursor: hasChildren ? 'pointer' : 'default',
          transition: 'all 0.15s' }}
        onClick={() => hasChildren && setOpen(o => !o)}
      >
        {hasChildren
          ? <span style={{ fontSize: 11, color: '#9ca3af', width: 14, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
          : <span style={{ width: 14, flexShrink: 0 }} />}
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarColor(node.role),
          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
          {initials(node.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{node.name}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>{node.display_role} · {node.email}</div>
        </div>
        <span style={{ background: rc.bg, color: rc.text, border: `1px solid ${rc.border}`, padding: '2px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
          {node.display_role}
        </span>
        {hasChildren && (
          <span style={{ marginLeft: 4, fontSize: 11, background: '#f3f4f6', padding: '2px 8px', borderRadius: 20, color: '#6b7280', flexShrink: 0 }}>
            {node.reports.length}
          </span>
        )}
      </div>
      {open && hasChildren && (
        <div style={{ borderLeft: `2px solid ${rc.border}`, marginLeft: 26, paddingLeft: 4 }}>
          {node.reports.map(child => <TreeNode key={child.id} node={child} depth={1} />)}
        </div>
      )}
    </div>
  );
}

// ── Field helper ────────────────────────────────────────────────
const fld = (label, value, onChange, type = 'text', opts = null) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
    {opts ? (
      <select value={value || ''} onChange={e => onChange(e.target.value)}
        style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    ) : (
      <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={label}
        style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }} />
    )}
  </div>
);

// ── Main ─────────────────────────────────────────────────────────
export default function AdminUsers() {
  const [users, setUsers]               = useState([]);
  const [hierarchy, setHierarchy]       = useState([]);
  const [tab, setTab]                   = useState('list');
  const [form, setForm]                 = useState({ name: '', email: '', role: 'rep', custom_role_name: '', reports_to_id: '', phone: '', personal_email: '', city: '', state: '' });
  const [showForm, setShowForm]         = useState(false);
  const [newUserResult, setNewUserResult] = useState(null);
  const [resetResult, setResetResult]   = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [savedRow, setSavedRow]         = useState(null);
  const [revealedPwd, setRevealedPwd]   = useState(new Set());
  const [viewUser, setViewUser]         = useState(null);
  const [searchQ, setSearchQ]           = useState('');
  const [roleFilter, setRoleFilter]     = useState('');

  const loadUsers = () => {
    axios.get(`${API}/users/`).then(r => { setUsers(r.data); setLoading(false); });
    axios.get(`${API}/users/hierarchy/tree`).then(r => setHierarchy(r.data)).catch(() => {});
  };
  useEffect(() => { loadUsers(); }, []);

  const f = k => v => setForm(p => ({ ...p, [k]: v }));

  const handleCreate = async (e) => {
    e.preventDefault(); setError('');
    if (!form.email.endsWith('@fortel.in')) { setError('Email must end with @fortel.in'); return; }
    try {
      const payload = {
        name: form.name, email: form.email, role: form.role,
        custom_role_name: form.role === 'custom' ? form.custom_role_name : null,
        reports_to_id: form.reports_to_id ? Number(form.reports_to_id) : null,
        phone: form.phone || null, personal_email: form.personal_email || null,
        city: form.city || null, state: form.state || null,
      };
      const res = await axios.post(`${API}/users/create`, payload);
      setNewUserResult(res.data);
      setForm({ name: '', email: '', role: 'rep', custom_role_name: '', reports_to_id: '', phone: '', personal_email: '', city: '', state: '' });
      setShowForm(false); loadUsers();
    } catch (err) { setError(err.response?.data?.detail || 'Failed to create user'); }
  };

  const handleResetPassword = async (userId) => {
    const res = await axios.post(`${API}/auth/admin/reset-password`, { user_id: userId });
    setResetResult(res.data);
    setViewUser(null);
  };

  const handleDeactivate = async (userId) => {
    if (!window.confirm('Deactivate this user?')) return;
    await axios.delete(`${API}/users/${userId}`); loadUsers(); setViewUser(null);
  };

  const handleReportsTo = async (userId, reportsToId) => {
    const params = reportsToId ? { reports_to_id: reportsToId } : {};
    await axios.patch(`${API}/users/${userId}/reports-to`, null, { params });
    setSavedRow(userId); setTimeout(() => setSavedRow(null), 2000); loadUsers();
  };

  const togglePwd = id => setRevealedPwd(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const filtered = users.filter(u => {
    const q = searchQ.toLowerCase();
    const m = !q || [u.name, u.email, u.city, u.display_role].some(v => v?.toLowerCase().includes(q));
    const r = !roleFilter || u.role === roleFilter;
    return m && r;
  });

  const totalActive   = users.filter(u =>  u.is_active).length;
  const totalInactive = users.filter(u => !u.is_active).length;

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#aaa' }}>Loading users…</div>;

  return (
    <div style={{ maxWidth: 1200, padding: '0 0 40px' }}>

      {/* ── HERO STRIP */}
      <div style={{
        background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
        borderRadius: '0 0 20px 20px', padding: '20px 24px 24px', color: '#fff', marginBottom: 20,
        position: 'relative', overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(15,32,39,0.45), 0 2px 8px rgba(0,0,0,0.2)',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 140, height: 140, borderRadius: '50%', background: 'rgba(124,58,237,0.12)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 10, right: 120, width: 70, height: 70, borderRadius: '50%', background: 'rgba(245,184,0,0.1)', pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>◎ User Management</div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>Create, assign designations, and map the org hierarchy</div>
          </div>
          <button onClick={() => { setShowForm(s => !s); setError(''); }}
            style={{
              background: showForm ? 'rgba(255,255,255,0.15)' : '#F5B800',
              color: showForm ? '#fff' : '#1A1A1A',
              border: 'none', borderRadius: 12, padding: '10px 20px',
              fontSize: 13, fontWeight: 800, cursor: 'pointer',
            }}>
            {showForm ? '✕ Cancel' : '+ Create User'}
          </button>
        </div>

        {/* Summary chips */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { val: totalActive,   label: 'Active',   color: '#4ade80' },
            { val: totalInactive, label: 'Inactive', color: '#f87171' },
            { val: users.length,  label: 'Total',    color: '#60a5fa' },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '6px 14px', border: '1px solid rgba(255,255,255,0.15)' }}>
              <div style={{ fontSize: 9, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 24px' }}>

        {/* Notifications */}
        {newUserResult && (
          <div style={{ background: '#f0fdf4', border: '1px solid #a5d6a7', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 800, color: '#15803d', marginBottom: 8, fontSize: 14 }}>✅ User Created Successfully</div>
            <div style={{ fontSize: 13, color: '#374151' }}>
              <strong>{newUserResult.name}</strong> · {newUserResult.email}
            </div>
            <div style={{ margin: '10px 0', padding: '10px 14px', background: '#fff', borderRadius: 10, fontFamily: 'monospace', fontSize: 15, border: '1px solid #d1fae5', display: 'inline-block' }}>
              Password: <strong>{newUserResult.temp_password}</strong>
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>Share with the user. They must change password on first login.</div>
            <button onClick={() => setNewUserResult(null)}
              style={{ background: '#dcfce7', color: '#15803d', border: 'none', borderRadius: 8, padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Dismiss</button>
          </div>
        )}
        {resetResult && (
          <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 800, color: '#b45309', marginBottom: 6, fontSize: 14 }}>🔑 Password Reset</div>
            <div style={{ fontSize: 13 }}>
              <strong>{resetResult.user_email}</strong> — new password:
              <span style={{ fontFamily: 'monospace', background: '#fff', padding: '3px 12px', borderRadius: 6, marginLeft: 8, fontWeight: 800, border: '1px solid #fcd34d' }}>{resetResult.new_password}</span>
            </div>
            <button onClick={() => setResetResult(null)}
              style={{ marginTop: 10, background: '#fef3c7', color: '#b45309', border: 'none', borderRadius: 8, padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Dismiss</button>
          </div>
        )}

        {/* ── CREATE USER FORM */}
        {showForm && (
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #8B5CF6', boxShadow: '0 4px 24px #8B5CF622', padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#7c3aed', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: '#8B5CF6', color: '#fff', borderRadius: 8, padding: '3px 10px', fontSize: 11 }}>NEW</span>
              Create New User
            </div>
            <form onSubmit={handleCreate}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
                {fld('Full Name *',     form.name,           f('name'))}
                {fld('Email * (@fortel.in)', form.email,     f('email'), 'email')}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Designation *</label>
                  <select value={form.role} onChange={e => f('role')(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }}>
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                {form.role === 'custom' && fld('Custom Role Name', form.custom_role_name, f('custom_role_name'))}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Reports To</label>
                  <select value={form.reports_to_id} onChange={e => f('reports_to_id')(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }}>
                    <option value="">— Top Level —</option>
                    {users.filter(u => u.role !== 'rep').map(u => <option key={u.id} value={u.id}>{u.name} ({u.display_role})</option>)}
                  </select>
                </div>
                {fld('Phone',          form.phone,          f('phone'), 'tel')}
                {fld('Personal Email', form.personal_email, f('personal_email'), 'email')}
                {fld('City / Territory', form.city,         f('city'))}
                {fld('State / Region', form.state,          f('state'))}
              </div>

              {error && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>⚠️ {error}</div>}

              <button type="submit"
                style={{ background: '#8B5CF6', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                ✅ Create User & Generate Password
              </button>
            </form>
          </div>
        )}

        {/* ── TAB BAR */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 2 }}>
            {[{ key: 'list', label: '☰ List' }, { key: 'hierarchy', label: '🌲 Hierarchy' }, { key: 'region', label: '📍 By Region' }].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13,
                background: tab === t.key ? '#fff' : 'transparent',
                fontWeight: tab === t.key ? 700 : 400,
                boxShadow: tab === t.key ? '0 1px 4px #0001' : 'none',
              }}>{t.label}</button>
            ))}
          </div>

          {tab === 'list' && (
            <>
              <input placeholder="🔍  Search name, email, city…" value={searchQ} onChange={e => setSearchQ(e.target.value)}
                style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, minWidth: 200, outline: 'none' }} />
              <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 2 }}>
                {[['','All'],...ROLES.map(r => [r.value, r.label])].map(([v, l]) => (
                  <button key={v} onClick={() => setRoleFilter(v)}
                    style={{ padding: '5px 11px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 11,
                      background: roleFilter === v ? '#fff' : 'transparent',
                      fontWeight: roleFilter === v ? 700 : 400,
                      boxShadow: roleFilter === v ? '0 1px 3px #0001' : 'none' }}>{l}</button>
                ))}
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af' }}>{filtered.length} of {users.length}</span>
            </>
          )}
        </div>

        {/* ── LIST TAB — CARDS */}
        {tab === 'list' && (
          filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#bbb' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>👤</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>No users match the filter.</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {filtered.map(u => {
                const rc = roleColor(u.role);
                const pwdVisible = revealedPwd.has(u.id);
                return (
                  <div key={u.id}
                    style={{ background: '#fff', borderRadius: 14, border: `1.5px solid ${u.is_active ? '#e5e7eb' : '#fecaca'}`,
                      padding: '14px 16px', opacity: u.is_active ? 1 : 0.7,
                      boxShadow: '0 1px 4px rgba(0,0,0,0.05)', transition: 'all 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = `0 4px 16px ${rc.border}88`}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)'}
                  >
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 12, background: avatarColor(u.role),
                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
                        {initials(u.name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>{u.email}</div>
                      </div>
                      <span style={{ background: rc.bg, color: rc.text, border: `1px solid ${rc.border}`, padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {u.display_role || u.role}
                      </span>
                    </div>

                    {/* Info chips */}
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                      {(u.city || u.state) && (
                        <span style={{ fontSize: 10, background: '#f3f4f6', borderRadius: 20, padding: '2px 8px', color: '#6b7280' }}>
                          📍 {[u.city, u.state].filter(Boolean).join(', ')}
                        </span>
                      )}
                      {u.phone && <span style={{ fontSize: 10, background: '#f3f4f6', borderRadius: 20, padding: '2px 8px', color: '#6b7280' }}>📱 {u.phone}</span>}
                      {u.must_reset_password && <span style={{ fontSize: 10, background: '#fffbeb', borderRadius: 20, padding: '2px 8px', color: '#d97706', fontWeight: 700 }}>⚠ Must reset pwd</span>}
                      {!u.is_active && <span style={{ fontSize: 10, background: '#FEE2E2', borderRadius: 20, padding: '2px 8px', color: '#DC2626', fontWeight: 700 }}>INACTIVE</span>}
                    </div>

                    {/* Password row */}
                    {u.plain_password && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '6px 10px', background: '#f9fafb', borderRadius: 8, border: '1px solid #f3f4f6' }}>
                        <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Pwd</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 13, flex: 1, letterSpacing: pwdVisible ? 0 : 2 }}>
                          {pwdVisible ? u.plain_password : '••••••••'}
                        </span>
                        <button onClick={() => togglePwd(u.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#6b7280', padding: '0 2px' }}>
                          {pwdVisible ? '🙈' : '👁'}
                        </button>
                      </div>
                    )}

                    {/* Reports-to */}
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Reports To</div>
                      <select value={u.reports_to_id || ''} onChange={e => handleReportsTo(u.id, e.target.value)}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: 8, fontSize: 12, outline: 'none',
                          border: `1px solid ${savedRow === u.id ? '#a5d6a7' : '#e5e7eb'}`,
                          background: savedRow === u.id ? '#f0fdf4' : '#fafafa', transition: 'all 0.3s' }}>
                        <option value="">— None —</option>
                        {users.filter(x => x.id !== u.id && x.role !== 'rep').map(x => (
                          <option key={x.id} value={x.id}>{x.name} ({x.display_role})</option>
                        ))}
                      </select>
                      {savedRow === u.id && <div style={{ fontSize: 10, color: '#15803d', marginTop: 2, fontWeight: 700 }}>✓ Saved</div>}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 6, borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
                      <button onClick={() => setViewUser(u)}
                        style={{ flex: 1, padding: '6px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', fontSize: 11, color: '#374151', fontWeight: 600 }}>
                        👁 View
                      </button>
                      <button onClick={() => handleResetPassword(u.id)}
                        style={{ flex: 1, padding: '6px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', cursor: 'pointer', fontSize: 11, color: '#1d4ed8', fontWeight: 600 }}>
                        🔑 Reset
                      </button>
                      {u.role !== 'admin' && (
                        <button onClick={() => handleDeactivate(u.id)}
                          style={{ flex: 1, padding: '6px', borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', cursor: 'pointer', fontSize: 11, color: '#dc2626', fontWeight: 600 }}>
                          Deactivate
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ── HIERARCHY TAB */}
        {tab === 'hierarchy' && (
          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 16, color: '#111' }}>Organisation Hierarchy</div>
            {hierarchy.length === 0 ? (
              <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: 24 }}>
                No hierarchy set yet. Use "Reports To" on any user card to map reporting lines.
              </div>
            ) : (
              hierarchy.map(node => <TreeNode key={node.id} node={node} depth={0} />)
            )}
            {/* Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, paddingTop: 16, borderTop: '1px solid #f3f4f6', marginTop: 16 }}>
              {Object.entries(ROLE_COLORS).filter(([k]) => k !== 'admin').map(([role, c]) => (
                <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b7280' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: avatarColor(role) }} />
                  {role.replace('_', ' ')}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── REGION TAB */}
        {tab === 'region' && <RegionView embedded />}
      </div>

      {/* ── VIEW MODAL */}
      {viewUser && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setViewUser(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 20, padding: 24, maxWidth: 480, width: '100%', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px #0003' }}>

            <div style={{ background: 'linear-gradient(135deg,#0f2027,#2c5364)', borderRadius: 12, padding: '16px 18px', marginBottom: 18, color: '#fff', position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: avatarColor(viewUser.role),
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, flexShrink: 0 }}>
                  {initials(viewUser.name)}
                </div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 17 }}>{viewUser.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{viewUser.email}</div>
                </div>
              </div>
              <button onClick={() => setViewUser(null)}
                style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', color: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>

            {[
              ['Designation',    viewUser.display_role || viewUser.role],
              ['Status',         viewUser.is_active ? 'Active' : 'Inactive'],
              ['Phone',          viewUser.phone],
              ['Personal Email', viewUser.personal_email],
              ['City',           viewUser.city],
              ['State',          viewUser.state],
              ['Reports To',     users.find(u => u.id === viewUser.reports_to_id)?.name],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label} style={{ display: 'flex', padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                <div style={{ width: 130, color: '#9ca3af', flexShrink: 0, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 2 }}>{label}</div>
                <div style={{ fontWeight: 600, color: '#1a1a1a' }}>{value}</div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button onClick={() => handleResetPassword(viewUser.id)}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#eff6ff', color: '#1d4ed8', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                🔑 Reset Password
              </button>
              {viewUser.role !== 'admin' && (
                <button onClick={() => handleDeactivate(viewUser.id)}
                  style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#fef2f2', color: '#dc2626', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  Deactivate
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
