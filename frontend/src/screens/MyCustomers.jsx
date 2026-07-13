import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const API = process.env.REACT_APP_API_URL || '';

const EMPTY_FORM = {
  customer_type: 'doctor', name: '', phone: '', email: '', gender: '',
  hospital: '', firm_name: '', qualification: '', specialty: '', division: '',
  prescriber_type: '', category: '', approx_business: '',
  city: '', state_code: '', pincode: '', full_address: '',
  client_id: '', client_code: '', status: 'Active',
};

const isActive = (d) => d.is_active !== false;

const fld = (label, value, onChange, type = 'text', opts = null) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
    {opts ? (
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    ) : (
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={label}
        style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }} />
    )}
  </div>
);

export default function MyCustomers() {
  const { user: me } = useAuth();
  const isAdmin = me?.role === 'admin' || me?.role === 'md';

  const [docs,         setDocs]         = useState([]);
  const [myUserId,     setMyUserId]     = useState(me?.id || null);
  const [loading,      setLoading]      = useState(true);
  const [apiError,     setApiError]     = useState('');
  const [search,       setSearch]       = useState('');
  const [typeFilter,   setTypeFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [showForm,     setShowForm]     = useState(false);
  const [form,         setForm]         = useState(EMPTY_FORM);
  const [editId,       setEditId]       = useState(null);
  const [viewDoc,      setViewDoc]      = useState(null);
  const [error,        setError]        = useState('');
  const [successMsg,   setSuccessMsg]   = useState('');

  useEffect(() => {
    if (me?.id) { setMyUserId(me.id); return; }
    if (!me?.email) return;
    axios.get(`${API}/users/`).then(r => {
      const found = r.data.find(u => u.email === me.email);
      if (found) setMyUserId(found.id);
    }).catch(() => {});
  }, [me?.id, me?.email]);

  const load = useCallback(() => {
    if (!isAdmin && !myUserId) return;
    setApiError('');
    const params = { include_inactive: true };
    if (!isAdmin && myUserId) params.viewer_id = myUserId;
    axios.get(`${API}/doctors/`, { params })
      .then(r => { setDocs(r.data); setLoading(false); })
      .catch(() => { setApiError('Could not load customers.'); setLoading(false); });
  }, [myUserId, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const flash = msg => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 3000); };

  const f = (key) => (val) => setForm(prev => ({ ...prev, [key]: val }));

  const filtered = docs.filter(d => {
    if (typeFilter && d.customer_type !== typeFilter) return false;
    if (statusFilter === 'active'   && !isActive(d)) return false;
    if (statusFilter === 'inactive' &&  isActive(d)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (d.name||'').toLowerCase().includes(q) ||
             (d.city||'').toLowerCase().includes(q) ||
             (d.hospital||'').toLowerCase().includes(q) ||
             (d.specialty||'').toLowerCase().includes(q);
    }
    return true;
  });

  const activeCount   = docs.filter(d =>  isActive(d)).length;
  const inactiveCount = docs.filter(d => !isActive(d)).length;

  const handleSubmit = async e => {
    e.preventDefault(); setError('');
    try {
      const payload = { ...form, manager_id: isAdmin ? (form.manager_id || null) : myUserId };
      if (editId) { await axios.patch(`${API}/doctors/${editId}`, payload); flash('Customer updated.'); }
      else        { await axios.post(`${API}/doctors/create`, payload);     flash('Customer added.'); }
      setShowForm(false); setForm(EMPTY_FORM); setEditId(null); load();
    } catch (err) { setError(err.response?.data?.detail || 'Failed to save'); }
  };

  const handleToggleStatus = async doc => {
    try {
      await axios.patch(`${API}/doctors/${doc.id}/toggle-status`);
    } catch {
      await axios.patch(`${API}/doctors/${doc.id}`, { ...doc, status: isActive(doc)?'Inactive':'Active', is_active: !isActive(doc) });
    }
    flash(`${doc.name} marked ${isActive(doc)?'Inactive':'Active'}.`);
    load();
    if (viewDoc?.id === doc.id) setViewDoc(null);
  };

  const handleDelete = async doc => {
    if (!window.confirm(`Permanently delete ${doc.name}?`)) return;
    await axios.delete(`${API}/doctors/${doc.id}`);
    flash(`${doc.name} deleted.`); load();
  };

  const openEdit = doc => {
    setForm({ ...EMPTY_FORM, ...doc }); setEditId(doc.id); setShowForm(true); setViewDoc(null);
  };

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#aaa' }}>Loading customers…</div>;

  return (
    <div style={{ maxWidth: 1100, padding: '0 0 40px' }}>

      {/* ── HERO STRIP ─────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
        borderRadius: '0 0 20px 20px', padding: '20px 24px 24px', color: '#fff', marginBottom: 20,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 130, height: 130, borderRadius: '50%', background: 'rgba(59,130,246,0.15)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 10, right: 110, width: 70, height: 70, borderRadius: '50%', background: 'rgba(245,184,0,0.1)', pointerEvents: 'none' }} />

        {/* Title + action */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>✦ {isAdmin ? 'Customer Management' : 'My Customers'}</div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>
              {isAdmin ? 'All customers across all users' : `Mapped to ${me?.name} and team`}
            </div>
          </div>
          <button onClick={() => { setShowForm(f => !f); setEditId(null); setForm(EMPTY_FORM); setError(''); }}
            style={{
              background: showForm ? 'rgba(255,255,255,0.15)' : '#F5B800',
              color: showForm ? '#fff' : '#1A1A1A',
              border: 'none', borderRadius: 12, padding: '10px 20px',
              fontSize: 13, fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s',
            }}>
            {showForm ? '✕ Cancel' : '+ Add Customer'}
          </button>
        </div>

        {/* Summary chips */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { val: activeCount,   label: 'Active',   color: '#4ade80' },
            { val: inactiveCount, label: 'Inactive',  color: '#f87171' },
            { val: docs.length,   label: 'Total',     color: '#60a5fa' },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '6px 14px', border: '1px solid rgba(255,255,255,0.15)' }}>
              <div style={{ fontSize: 9, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 24px' }}>

        {/* Error */}
        {apiError && (
          <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '10px 16px', marginBottom: 12, color: '#DC2626', fontSize: 13 }}>⚠️ {apiError}</div>
        )}
        {successMsg && (
          <div style={{ background: '#F0FDF4', border: '1px solid #A5D6A7', borderRadius: 10, padding: '10px 16px', marginBottom: 12, color: '#15803D', fontWeight: 600, fontSize: 13 }}>✅ {successMsg}</div>
        )}

        {/* ── ADD / EDIT FORM ──────────────────────────────────────────── */}
        {showForm && (
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #3B82F6', boxShadow: '0 4px 24px #3B82F622', padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1D4ED8', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: '#3B82F6', color: '#fff', borderRadius: 8, padding: '3px 10px', fontSize: 11 }}>{editId ? 'EDIT' : 'NEW'}</span>
              {editId ? 'Update Customer Details' : 'Add a New Customer'}
            </div>

            <form onSubmit={handleSubmit}>
              {/* Type toggle */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {[['doctor','👨‍⚕️ Doctor'],['pharmacy','🏪 Pharmacy']].map(([v,l]) => (
                  <button key={v} type="button" onClick={() => setForm(p => ({...p, customer_type: v}))}
                    style={{ padding: '8px 18px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                      background: form.customer_type === v ? '#3B82F6' : '#f3f4f6',
                      color: form.customer_type === v ? '#fff' : '#6b7280' }}>
                    {l}
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
                {fld('Name *',     form.name,           f('name'))}
                {fld('Phone',      form.phone,           f('phone'), 'tel')}
                {fld('Email',      form.email,           f('email'), 'email')}
                {fld(form.customer_type === 'pharmacy' ? 'Firm Name' : 'Hospital / Clinic', form.hospital, f('hospital'))}
                {fld('Qualification', form.qualification, f('qualification'))}
                {fld('Specialty',  form.specialty,       f('specialty'))}
                {fld('City',       form.city,            f('city'))}
                {fld('State',      form.state_code,      f('state_code'))}
                {fld('Pincode',    form.pincode,         f('pincode'))}
                {fld('Category',   form.category,        f('category'), 'text', [['','— Select —'],['A','A'],['B','B'],['C','C'],['D','D'],['NA','NA']])}
                {fld('Gender',     form.gender,          f('gender'),   'text', [['','— Select —'],['Male','Male'],['Female','Female']])}
                {fld('Type',       form.prescriber_type, f('prescriber_type'), 'text', [['','— Select —'],['Prescriber','Prescriber'],['Non Prescriber','Non Prescriber']])}
                {fld('Address',    form.full_address,    f('full_address'))}
                {fld('Client ID',  form.client_id,       f('client_id'))}
              </div>

              {error && <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>⚠️ {error}</div>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit"
                  style={{ background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                  {editId ? '💾 Save Changes' : '✅ Add Customer'}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); }}
                  style={{ background: '#f3f4f6', color: '#6b7280', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── FILTER BAR ────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="🔍  Search name, city, hospital…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, minWidth: 220, outline: 'none' }} />

          {/* Type chips */}
          <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 2 }}>
            {[['','All'],['doctor','👨‍⚕️'],['pharmacy','🏪']].map(([v,l]) => (
              <button key={v} onClick={() => setTypeFilter(v)}
                style={{ padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12,
                  background: typeFilter === v ? '#fff' : 'transparent',
                  fontWeight: typeFilter === v ? 700 : 400,
                  boxShadow: typeFilter === v ? '0 1px 3px #0001' : 'none' }}>{l}</button>
            ))}
          </div>

          {/* Status chips */}
          <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 2 }}>
            {[['active','🟢 Active'],['inactive','🔴 Inactive'],['all','All']].map(([v,l]) => (
              <button key={v} onClick={() => setStatusFilter(v)}
                style={{ padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12,
                  background: statusFilter === v ? '#fff' : 'transparent',
                  fontWeight: statusFilter === v ? 700 : 400,
                  boxShadow: statusFilter === v ? '0 1px 3px #0001' : 'none' }}>{l}</button>
            ))}
          </div>

          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af' }}>{filtered.length} of {docs.length}</span>
        </div>

        {/* ── CUSTOMER CARDS ────────────────────────────────────────────── */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#bbb' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>👥</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {docs.length === 0 ? 'No customers mapped to you yet.' : 'No customers match the filter.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {filtered.map(doc => {
              const active = isActive(doc);
              const isDoc  = doc.customer_type !== 'pharmacy';
              const accent = isDoc ? '#3B82F6' : '#8B5CF6';
              const accentLight = isDoc ? '#EFF6FF' : '#F5F3FF';
              return (
                <div key={doc.id}
                  style={{ background: '#fff', borderRadius: 14, border: `1.5px solid ${active ? '#e5e7eb' : '#fecaca'}`,
                    padding: '14px 16px', opacity: active ? 1 : 0.7, transition: 'all 0.15s',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = `0 4px 16px ${accent}22`}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)'}
                >
                  {/* Card header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: accentLight,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                      {isDoc ? '👨‍⚕️' : '🏪'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.name}</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                        {[doc.specialty, doc.hospital || doc.firm_name].filter(Boolean).join(' · ') || doc.customer_type}
                      </div>
                    </div>
                    {doc.category && (
                      <span style={{ background: accentLight, color: accent, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 800, flexShrink: 0 }}>{doc.category}</span>
                    )}
                  </div>

                  {/* Details row */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {doc.city && <span style={{ fontSize: 10, background: '#f3f4f6', borderRadius: 20, padding: '2px 8px', color: '#6b7280' }}>📍 {doc.city}</span>}
                    {doc.phone && <span style={{ fontSize: 10, background: '#f3f4f6', borderRadius: 20, padding: '2px 8px', color: '#6b7280' }}>📞 {doc.phone}</span>}
                    {!active && <span style={{ fontSize: 10, background: '#FEE2E2', borderRadius: 20, padding: '2px 8px', color: '#DC2626', fontWeight: 700 }}>INACTIVE</span>}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6, borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
                    <button onClick={() => setViewDoc(doc)}
                      style={{ flex: 1, padding: '6px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', fontSize: 12, color: '#374151', fontWeight: 600 }}>
                      👁 View
                    </button>
                    <button onClick={() => openEdit(doc)}
                      style={{ flex: 1, padding: '6px', borderRadius: 8, border: `1px solid ${accent}44`, background: accentLight, cursor: 'pointer', fontSize: 12, color: accent, fontWeight: 600 }}>
                      ✏️ Edit
                    </button>
                    <button onClick={() => handleToggleStatus(doc)}
                      style={{ flex: 1, padding: '6px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                        background: active ? '#FEE2E2' : '#DCFCE7',
                        color: active ? '#DC2626' : '#15803D' }}>
                      {active ? '⏸' : '▶'} {active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── VIEW MODAL ────────────────────────────────────────────────── */}
      {viewDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setViewDoc(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 20, padding: 24, maxWidth: 520, width: '100%', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px #0003' }}>

            {/* Modal header */}
            <div style={{ background: 'linear-gradient(135deg,#0f2027,#2c5364)', borderRadius: 12, padding: '16px 18px', marginBottom: 18, color: '#fff', position: 'relative' }}>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{viewDoc.name}</div>
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{viewDoc.customer_type} · {viewDoc.specialty || ''}</div>
              <button onClick={() => setViewDoc(null)}
                style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', color: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>

            {[
              ['Hospital / Firm', viewDoc.hospital || viewDoc.firm_name],
              ['Specialty',       viewDoc.specialty],
              ['Qualification',   viewDoc.qualification],
              ['Phone',           viewDoc.phone],
              ['Email',           viewDoc.email],
              ['Gender',          viewDoc.gender],
              ['Category',        viewDoc.category],
              ['Type',            viewDoc.prescriber_type],
              ['City',            viewDoc.city],
              ['State',           viewDoc.state_code],
              ['Pincode',         viewDoc.pincode],
              ['Address',         viewDoc.full_address],
              ['Division',        viewDoc.division],
              ['Approx Business', viewDoc.approx_business],
              ['Client ID',       viewDoc.client_id],
              ['Client Code',     viewDoc.client_code],
              ['Manager',         viewDoc.manager_name],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label} style={{ display: 'flex', padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                <div style={{ width: 130, color: '#9ca3af', flexShrink: 0, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 1 }}>{label}</div>
                <div style={{ fontWeight: 600, color: '#1a1a1a' }}>{value}</div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button onClick={() => openEdit(viewDoc)}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#3B82F6', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                ✏️ Edit
              </button>
              <button onClick={() => handleToggleStatus(viewDoc)}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                  background: isActive(viewDoc) ? '#FEE2E2' : '#DCFCE7',
                  color:      isActive(viewDoc) ? '#DC2626' : '#15803D' }}>
                {isActive(viewDoc) ? 'Mark Inactive' : 'Mark Active'}
              </button>
              <button onClick={() => handleDelete(viewDoc)}
                style={{ padding: '10px 14px', borderRadius: 10, border: 'none', background: '#FEE2E2', color: '#DC2626', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                🗑
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
