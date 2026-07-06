import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || '';

const CUSTOMER_TYPES = [
  { value: 'doctor',   label: 'Doctor',   icon: '👨‍⚕️', color: '#1d4ed8' },
  { value: 'pharmacy', label: 'Pharmacy', icon: '🏪',   color: '#7c3aed' },
];

const COMMERCIAL_MODELS = ['U1', 'U2', 'P1', 'P2', 'N1', 'D1', 'R1'];
const CATEGORIES  = ['A', 'B', 'C', 'D'];
const GENDERS     = ['Male', 'Female', 'Other'];
const PRESCRIBER_TYPES = ['Prescriber', 'Non Prescriber'];
const APPROX_BIZ  = ['0-5000', '5000-10000', '10000-25000', '25000-50000', '50000+'];

const STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
  'Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand',
  'Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur',
  'Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan',
  'Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal',
];

const SPECIALTIES = [
  'Cardiologist','Diabetologist','General Physician','Neurologist',
  'Nephrologist','Pulmonologist','Oncologist','Radiation Oncologist',
  'Medical Oncologist','Orthopedic','Gastroenterologist','Pharmacist','Other',
];

const ROI_COLORS = {
  Platinum: { bg: '#f0f9ff', text: '#0369a1', border: '#bae6fd' },
  Gold:     { bg: '#fffbeb', text: '#b45309', border: '#fcd34d' },
  Silver:   { bg: '#f8fafc', text: '#475569', border: '#cbd5e1' },
  Bronze:   { bg: '#fff7ed', text: '#c2410c', border: '#fdba74' },
};

const EMPTY_FORM = {
  customer_type: 'doctor',
  client_id: '', client_code: '', registration_number: '',
  name: '', phone: '', email: '', gender: '', dob: '', anniversary: '',
  hospital: '', firm_name: '', qualification: '', specialty: '',
  division: '', prescriber_type: '', category: '', approx_business: '',
  city: '', state_code: '', zone: '', pincode: '', country: 'INDIA',
  full_address: '', address2: '', address3: '',
  commercial_model: '', expected_multiple: 5, add_date: '', status: 'Active',
  manager_id: '',
};

const isActive = d => d.status !== 'Inactive' && d.is_active !== false;

const fld = (label, value, onChange, type = 'text', opts = null) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
    {opts ? (
      <select value={value || ''} onChange={e => onChange(e.target.value)}
        style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    ) : type === 'textarea' ? (
      <textarea value={value || ''} onChange={e => onChange(e.target.value)} placeholder={label} rows={2}
        style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa', resize: 'vertical', boxSizing: 'border-box', width: '100%' }} />
    ) : (
      <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={label}
        style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }} />
    )}
  </div>
);

const SectionLabel = ({ title }) => (
  <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #f3f4f6', paddingTop: 12, marginTop: 4, fontWeight: 700, fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1.5 }}>
    {title}
  </div>
);

export default function AdminDoctors() {
  const [doctors, setDoctors]   = useState([]);
  const [users, setUsers]       = useState([]);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]     = useState(null);
  const [viewDoc, setViewDoc]   = useState(null);
  const [search, setSearch]     = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterCity, setFilterCity]   = useState('');
  const [filterType, setFilterType]   = useState('');
  const [filterRep, setFilterRep]     = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [assignDoc, setAssignDoc]   = useState(null);
  const [assignForm, setAssignForm] = useState({ manager_id: '', rep_id: '' });

  const managers = users.filter(u => ['manager','senior_manager','director','md','custom'].includes(u.role));
  const reps     = users.filter(u => ['rep','custom'].includes(u.role));

  const uniqueStates = [...new Set(doctors.map(d => d.state_code).filter(Boolean))].sort();
  const uniqueCities = [...new Set(doctors.map(d => d.city).filter(Boolean))].sort();

  const f = k => val => setForm(p => ({ ...p, [k]: val }));

  const loadAll = () => {
    axios.get(`${API}/doctors/`).then(r => { setDoctors(r.data); setLoading(false); });
    axios.get(`${API}/users/`).then(r => setUsers(r.data));
  };
  useEffect(() => { loadAll(); }, []);

  const flash = msg => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 3000); };

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    try {
      const payload = { ...form, expected_multiple: Number(form.expected_multiple), manager_id: form.manager_id ? Number(form.manager_id) : null, commercial_model: form.commercial_model || null };
      if (editId) { await axios.patch(`${API}/doctors/${editId}`, payload); flash('Customer updated.'); }
      else        { await axios.post(`${API}/doctors/create`, payload);     flash('Customer added.'); }
      setForm(EMPTY_FORM); setShowForm(false); setEditId(null); loadAll();
    } catch (err) { setError(err.response?.data?.detail || 'Failed'); }
  };

  const startEdit = (doc) => {
    setForm({ ...EMPTY_FORM, ...doc, commercial_model: doc.commercial_model || '', manager_id: doc.manager_id || '' });
    setEditId(doc.id); setShowForm(true); setViewDoc(null); setSuccessMsg(''); setError('');
    setTimeout(() => document.getElementById('adm-customer-form')?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleDeactivate = async (id) => {
    if (!window.confirm('Remove this record?')) return;
    await axios.delete(`${API}/doctors/${id}`); flash('Deleted.'); loadAll();
  };

  const handleAssign = async () => {
    try {
      await axios.post(`${API}/doctors/assign`, { doctor_id: assignDoc.id, manager_id: assignForm.manager_id ? Number(assignForm.manager_id) : null, associate_id: assignForm.rep_id ? Number(assignForm.rep_id) : null });
      flash(`Assigned ${assignDoc.name}.`); setAssignDoc(null); loadAll();
    } catch (err) { setError(err.response?.data?.detail || 'Failed'); }
  };

  const handleRemoveRep = async (doctorId, repId) => {
    await axios.delete(`${API}/doctors/${doctorId}/remove-rep/${repId}`); loadAll();
  };

  const filtered = doctors.filter(d => {
    const q   = search.toLowerCase();
    const m   = !q || [d.name, d.hospital, d.city, d.client_code, d.specialty, d.division].some(v => v?.toLowerCase().includes(q));
    const st  = !filterState || (d.state_code || '').toLowerCase() === filterState.toLowerCase();
    const ct  = !filterCity  || (d.city || '').toLowerCase() === filterCity.toLowerCase();
    const tp  = !filterType  || (d.customer_type || 'doctor') === filterType;
    const rp  = !filterRep   || d.reps?.some(r => String(r.id) === filterRep);
    const act = statusFilter === 'all' ? true : statusFilter === 'active' ? isActive(d) : !isActive(d);
    return m && st && ct && tp && rp && act;
  });

  const totalActive   = doctors.filter(d =>  isActive(d)).length;
  const totalInactive = doctors.filter(d => !isActive(d)).length;
  const totalDoctors  = doctors.filter(d => (d.customer_type||'doctor') === 'doctor').length;
  const totalPharmacy = doctors.filter(d => d.customer_type === 'pharmacy').length;

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#aaa' }}>Loading customers…</div>;

  return (
    <div style={{ maxWidth: 1200, padding: '0 0 40px' }}>

      {/* ── HERO STRIP */}
      <div style={{
        background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
        borderRadius: '0 0 20px 20px', padding: '20px 24px 24px', color: '#fff', marginBottom: 20,
        position: 'relative', overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(15,32,39,0.45), 0 2px 8px rgba(0,0,0,0.2)',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 140, height: 140, borderRadius: '50%', background: 'rgba(59,130,246,0.12)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 10, right: 120, width: 70, height: 70, borderRadius: '50%', background: 'rgba(245,184,0,0.1)', pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>✦ Customer Master</div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>All customers — Doctors & Pharmacies</div>
          </div>
          <button onClick={() => { setShowForm(s => !s); setEditId(null); setForm(EMPTY_FORM); setError(''); }}
            style={{
              background: showForm ? 'rgba(255,255,255,0.15)' : '#F5B800',
              color: showForm ? '#fff' : '#1A1A1A',
              border: 'none', borderRadius: 12, padding: '10px 20px',
              fontSize: 13, fontWeight: 800, cursor: 'pointer',
            }}>
            {showForm && !editId ? '✕ Cancel' : '+ Add Customer'}
          </button>
        </div>

        {/* Summary chips */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { val: totalActive,    label: 'Active',     color: '#4ade80' },
            { val: totalInactive,  label: 'Inactive',   color: '#f87171' },
            { val: doctors.length, label: 'Total',      color: '#60a5fa' },
            { val: totalDoctors,   label: 'Doctors',    color: '#fbbf24' },
            { val: totalPharmacy,  label: 'Pharmacies', color: '#c084fc' },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '6px 14px', border: '1px solid rgba(255,255,255,0.15)' }}>
              <div style={{ fontSize: 9, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 24px' }}>

        {successMsg && (
          <div style={{ background: '#f0fdf4', border: '1px solid #a5d6a7', borderRadius: 10, padding: '10px 14px', marginBottom: 12, color: '#15803d', fontSize: 13 }}>
            ✅ {successMsg}
          </div>
        )}

        {/* ── ADD / EDIT FORM */}
        {showForm && (
          <div id="adm-customer-form" style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #3B82F6', boxShadow: '0 4px 24px #3B82F622', padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1D4ED8', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: '#3B82F6', color: '#fff', borderRadius: 8, padding: '3px 10px', fontSize: 11 }}>{editId ? 'EDIT' : 'NEW'}</span>
              {editId ? 'Update Customer Details' : 'Add New Customer'}
            </div>
            <form onSubmit={handleSubmit}>
              {/* Type toggle */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {CUSTOMER_TYPES.map(t => (
                  <button key={t.value} type="button" onClick={() => setForm(p => ({ ...p, customer_type: t.value, specialty: '' }))}
                    style={{ padding: '8px 20px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                      background: form.customer_type === t.value ? t.color : '#f3f4f6',
                      color: form.customer_type === t.value ? '#fff' : '#6b7280' }}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
                <SectionLabel title="Identity" />
                {fld('Client ID',          form.client_id,           f('client_id'))}
                {fld('Client Code',        form.client_code,         f('client_code'))}
                {fld('Registration No.',   form.registration_number, f('registration_number'))}
                {fld('Add Date',           form.add_date,            f('add_date'))}
                {fld('Status', form.status, f('status'), 'text', [['Active','Active'],['Inactive','Inactive']])}

                <SectionLabel title="Basic Info" />
                <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {form.customer_type === 'pharmacy' ? 'Pharmacy Name *' : 'Doctor Name *'}
                  </label>
                  <input value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder={form.customer_type === 'pharmacy' ? 'MedPlus Pharmacy' : 'Dr. Ravi Shankar'}
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, fontWeight: 700, outline: 'none', background: '#fafafa' }} />
                </div>
                {fld('Gender', form.gender, f('gender'), 'text', [['','— Select —'],['Male','Male'],['Female','Female'],['Other','Other']])}
                {fld('Date of Birth', form.dob,         f('dob'))}
                {fld('Anniversary',   form.anniversary, f('anniversary'))}

                <SectionLabel title="Professional" />
                {fld(form.customer_type === 'pharmacy' ? 'Pharmacy / Firm' : 'Hospital / Clinic', form.hospital, f('hospital'))}
                {fld('Firm Name',       form.firm_name,        f('firm_name'))}
                {fld('Division',        form.division,         f('division'))}
                {fld('Qualification',   form.qualification,    f('qualification'))}
                {form.customer_type === 'doctor' && fld('Specialty', form.specialty, f('specialty'), 'text', [['','— Select —'],...SPECIALTIES.map(s => [s,s])])}
                {fld('Category',        form.category,     f('category'),     'text', [['','— Select —'],...CATEGORIES.map(c => [c,c])])}
                {fld('Prescriber Type', form.prescriber_type, f('prescriber_type'), 'text', [['','— Select —'],...PRESCRIBER_TYPES.map(p => [p,p])])}
                {fld('Approx. Business',form.approx_business, f('approx_business'), 'text', [['','— Select —'],...APPROX_BIZ.map(b => [b,b])])}

                <SectionLabel title="Contact" />
                {fld('Phone', form.phone, f('phone'), 'tel')}
                {fld('Email', form.email, f('email'), 'email')}

                <SectionLabel title="Location" />
                {fld('City',    form.city,       f('city'))}
                {fld('State',   form.state_code, f('state_code'), 'text', [['','— Select —'],...STATES.map(s => [s,s])])}
                {fld('Zone',    form.zone,       f('zone'))}
                {fld('Pincode', form.pincode,    f('pincode'))}
                {fld('Country', form.country,    f('country'))}
                <div style={{ gridColumn: 'span 3' }}>{fld('Address 1', form.full_address, f('full_address'), 'textarea')}</div>
                <div style={{ gridColumn: 'span 3' }}>{fld('Address 2', form.address2,     f('address2'),     'textarea')}</div>

                <SectionLabel title="Fortel Commercial" />
                {fld('Commercial Model', form.commercial_model, f('commercial_model'), 'text', [['','— Select —'],...COMMERCIAL_MODELS.map(m => [m,m])])}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Expected ROI Multiple</label>
                  <input type="number" min="1" max="20" step="0.5" value={form.expected_multiple}
                    onChange={e => setForm(p => ({ ...p, expected_multiple: e.target.value }))}
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Assigned Manager</label>
                  <select value={form.manager_id || ''} onChange={e => setForm(p => ({ ...p, manager_id: e.target.value }))}
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }}>
                    <option value="">— None —</option>
                    {managers.map(m => <option key={m.id} value={m.id}>{m.name} ({m.display_role || m.role})</option>)}
                  </select>
                </div>
              </div>

              {error && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: 8, fontSize: 12, margin: '12px 0' }}>⚠️ {error}</div>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit"
                  style={{ background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                  {editId ? '💾 Save Changes' : '✅ Add Customer'}
                </button>
                {editId && (
                  <button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); }}
                    style={{ background: '#f3f4f6', color: '#6b7280', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 13, cursor: 'pointer' }}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        )}

        {/* ── FILTER BAR */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="🔍  Search name, hospital, city, code…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, minWidth: 220, outline: 'none' }} />

          <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 2 }}>
            {[['', 'All'], ['doctor', '👨‍⚕️'], ['pharmacy', '🏪']].map(([v, l]) => (
              <button key={v} onClick={() => setFilterType(v)}
                style={{ padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12,
                  background: filterType === v ? '#fff' : 'transparent',
                  fontWeight: filterType === v ? 700 : 400,
                  boxShadow: filterType === v ? '0 1px 3px #0001' : 'none' }}>{l}</button>
            ))}
          </div>

          <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 2 }}>
            {[['all','All'],['active','🟢 Active'],['inactive','🔴 Inactive']].map(([v, l]) => (
              <button key={v} onClick={() => setStatusFilter(v)}
                style={{ padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12,
                  background: statusFilter === v ? '#fff' : 'transparent',
                  fontWeight: statusFilter === v ? 700 : 400,
                  boxShadow: statusFilter === v ? '0 1px 3px #0001' : 'none' }}>{l}</button>
            ))}
          </div>

          <select value={filterState} onChange={e => { setFilterState(e.target.value); setFilterCity(''); }}
            style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, outline: 'none' }}>
            <option value="">All States</option>
            {uniqueStates.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={filterCity} onChange={e => setFilterCity(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, outline: 'none' }}>
            <option value="">All Cities</option>
            {(filterState
              ? [...new Set(doctors.filter(d => (d.state_code||'').toLowerCase() === filterState.toLowerCase()).map(d => d.city).filter(Boolean))].sort()
              : uniqueCities
            ).map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select value={filterRep} onChange={e => setFilterRep(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, outline: 'none' }}>
            <option value="">All Reps</option>
            {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>

          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af' }}>{filtered.length} of {doctors.length}</span>
        </div>

        {/* ── CUSTOMER CARDS */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#bbb' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>👥</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>No customers match the filter.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 }}>
            {filtered.map(doc => {
              const active  = isActive(doc);
              const isDoc   = (doc.customer_type || 'doctor') !== 'pharmacy';
              const accent  = isDoc ? '#1d4ed8' : '#7c3aed';
              const accentL = isDoc ? '#EFF6FF' : '#F5F3FF';
              const roiC    = ROI_COLORS[doc.roi_grade];

              return (
                <div key={doc.id}
                  style={{ background: '#fff', borderRadius: 14, border: `1.5px solid ${active ? '#e5e7eb' : '#fecaca'}`,
                    padding: '14px 16px', opacity: active ? 1 : 0.7, transition: 'all 0.15s',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = `0 4px 16px ${accent}22`}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)'}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: accentL,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                      {isDoc ? '👨‍⚕️' : '🏪'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.name}</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                        {[doc.specialty, doc.hospital || doc.firm_name].filter(Boolean).join(' · ') || (isDoc ? 'Doctor' : 'Pharmacy')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end', flexShrink: 0 }}>
                      {doc.category && (
                        <span style={{ background: accentL, color: accent, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 800 }}>{doc.category}</span>
                      )}
                      {roiC && doc.roi_grade && (
                        <span style={{ background: roiC.bg, color: roiC.text, border: `1px solid ${roiC.border}`, padding: '2px 7px', borderRadius: 20, fontSize: 9, fontWeight: 700 }}>
                          {doc.roi_grade}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                    {doc.city && <span style={{ fontSize: 10, background: '#f3f4f6', borderRadius: 20, padding: '2px 8px', color: '#6b7280' }}>📍 {doc.city}</span>}
                    {doc.phone && <span style={{ fontSize: 10, background: '#f3f4f6', borderRadius: 20, padding: '2px 8px', color: '#6b7280' }}>📞 {doc.phone}</span>}
                    {doc.manager_name && <span style={{ fontSize: 10, background: '#f0fdf4', borderRadius: 20, padding: '2px 8px', color: '#15803d' }}>👤 {doc.manager_name}</span>}
                    {doc.reps?.length > 0 && (
                      <span style={{ fontSize: 10, background: '#eff6ff', borderRadius: 20, padding: '2px 8px', color: '#1d4ed8' }}>
                        🧑 {doc.reps.map(r => r.name).join(', ')}
                      </span>
                    )}
                    {!active && <span style={{ fontSize: 10, background: '#FEE2E2', borderRadius: 20, padding: '2px 8px', color: '#DC2626', fontWeight: 700 }}>INACTIVE</span>}
                  </div>

                  <div style={{ display: 'flex', gap: 5, borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
                    <button onClick={() => setViewDoc(doc)}
                      style={{ flex: 1, padding: '6px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', fontSize: 11, color: '#374151', fontWeight: 600 }}>
                      👁 View
                    </button>
                    <button onClick={() => startEdit(doc)}
                      style={{ flex: 1, padding: '6px', borderRadius: 8, border: `1px solid ${accent}44`, background: accentL, cursor: 'pointer', fontSize: 11, color: accent, fontWeight: 600 }}>
                      ✏️ Edit
                    </button>
                    <button onClick={() => { setAssignDoc(doc); setAssignForm({ manager_id: doc.manager_id||'', rep_id:'' }); }}
                      style={{ flex: 1, padding: '6px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', cursor: 'pointer', fontSize: 11, color: '#1d4ed8', fontWeight: 600 }}>
                      👤 Assign
                    </button>
                    <button onClick={() => handleDeactivate(doc.id)}
                      style={{ padding: '6px 9px', borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', cursor: 'pointer', fontSize: 11, color: '#dc2626', fontWeight: 600 }}>
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── VIEW MODAL */}
      {viewDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setViewDoc(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 20, padding: 24, maxWidth: 560, width: '100%', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px #0003' }}>

            <div style={{ background: 'linear-gradient(135deg,#0f2027,#2c5364)', borderRadius: 12, padding: '16px 18px', marginBottom: 18, color: '#fff', position: 'relative' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                {(() => {
                  const ct = CUSTOMER_TYPES.find(t => t.value===(viewDoc.customer_type||'doctor'))||CUSTOMER_TYPES[0];
                  return (
                    <span style={{ background: `${ct.color}30`, color: '#fff', border: `1px solid ${ct.color}60`, borderRadius: 20, padding: '2px 10px', fontSize: 10, fontWeight: 700 }}>
                      {ct.icon} {ct.label}
                    </span>
                  );
                })()}
                {viewDoc.category && <span style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', padding: '2px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>Cat {viewDoc.category}</span>}
                {viewDoc.status && <span style={{ background: viewDoc.status==='Active'?'rgba(74,222,128,0.25)':'rgba(248,113,113,0.25)', color: '#fff', padding: '2px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>{viewDoc.status}</span>}
              </div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{viewDoc.name}</div>
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                {[viewDoc.specialty || viewDoc.qualification, viewDoc.division].filter(Boolean).join(' · ')}
              </div>
              <button onClick={() => setViewDoc(null)}
                style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', color: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>

            {[
              ['Client ID',        viewDoc.client_id],
              ['Client Code',      viewDoc.client_code],
              ['Registration',     viewDoc.registration_number],
              ['Add Date',         viewDoc.add_date],
              ['Phone',            viewDoc.phone],
              ['Email',            viewDoc.email],
              ['Gender',           viewDoc.gender],
              ['DOB',              viewDoc.dob],
              ['Hospital / Firm',  viewDoc.hospital || viewDoc.firm_name],
              ['Qualification',    viewDoc.qualification],
              ['Prescriber Type',  viewDoc.prescriber_type],
              ['Approx. Business', viewDoc.approx_business],
              ['City',             viewDoc.city],
              ['State',            viewDoc.state_code],
              ['Zone',             viewDoc.zone],
              ['Pincode',          viewDoc.pincode],
              ['Comm. Model',      viewDoc.commercial_model],
              ['Expected ROI',     viewDoc.expected_multiple ? `${viewDoc.expected_multiple}×` : null],
              ['ROI Grade',        viewDoc.roi_grade],
              ['Manager',          viewDoc.manager_name],
              ['Reps',             viewDoc.reps?.map(r => r.name).join(', ')],
              ['Address',          viewDoc.full_address],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label} style={{ display: 'flex', padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                <div style={{ width: 140, color: '#9ca3af', flexShrink: 0, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 2 }}>{label}</div>
                <div style={{ fontWeight: 600, color: '#1a1a1a', wordBreak: 'break-word' }}>{value}</div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button onClick={() => startEdit(viewDoc)}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#3B82F6', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                ✏️ Edit
              </button>
              <button onClick={() => { setAssignDoc(viewDoc); setAssignForm({ manager_id: viewDoc.manager_id||'', rep_id:'' }); setViewDoc(null); }}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#eff6ff', color: '#1d4ed8', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                👤 Assign Rep
              </button>
              <button onClick={() => { handleDeactivate(viewDoc.id); setViewDoc(null); }}
                style={{ padding: '10px 14px', borderRadius: 10, border: 'none', background: '#fef2f2', color: '#dc2626', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                🗑
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ASSIGN MODAL */}
      {assignDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setAssignDoc(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 20, padding: 28, minWidth: 380, maxWidth: 440, boxShadow: '0 20px 60px #0003' }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Assign Customer</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>{assignDoc.name} · {assignDoc.hospital}</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Manager / Senior Manager</label>
              <select value={assignForm.manager_id} onChange={e => setAssignForm(p => ({ ...p, manager_id: e.target.value }))}
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }}>
                <option value="">— None —</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.name} ({m.display_role || m.role})</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Sales Rep / KAM</label>
              <select value={assignForm.rep_id} onChange={e => setAssignForm(p => ({ ...p, rep_id: e.target.value }))}
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }}>
                <option value="">— None —</option>
                {reps.map(r => <option key={r.id} value={r.id}>{r.name} ({r.custom_role_name || r.role})</option>)}
              </select>
            </div>

            {error && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>⚠️ {error}</div>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleAssign}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#3B82F6', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Save Assignment
              </button>
              <button onClick={() => setAssignDoc(null)}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#f3f4f6', color: '#6b7280', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
