import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roiAPI } from '../api';

const API   = process.env.REACT_APP_API_URL || '';
const NOW   = new Date();
const CUR_YEAR  = NOW.getFullYear();
const CUR_MONTH = NOW.getMonth() + 1;
const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const NORMALIZE = s => (s || '').replace(/\s+/g,'').toLowerCase();
const STATE_NAMES = {
  'tn': 'Tamil Nadu', 'tamilnadu': 'Tamil Nadu',
  'kl': 'Kerala',    'kerala': 'Kerala',
  'ka': 'Karnataka', 'karnataka': 'Karnataka',
  'ts': 'Telangana', 'telangana': 'Telangana',
  'ap': 'andhra pradesh', 'andhrapradesh': 'Andhra Pradesh',
  'mh': 'Maharashtra', 'maharashtra': 'Maharashtra',
  'dl': 'Delhi',      'delhi': 'Delhi',
};
const toStateName = code => { const k = NORMALIZE(code); return STATE_NAMES[k] || code; };

const STATE_STYLE = {
  'Tamil Nadu':     { color: '#3D8C40', light: '#E0F4EE', dark: '#065438', icon: '🌿' },
  'Kerala':         { color: '#6D28D9', light: '#EDE9FE', dark: '#4C1D95', icon: '🌴' },
  'Karnataka':      { color: '#92400E', light: '#FEF3C7', dark: '#6B3007', icon: '🏛️' },
  'Telangana':      { color: '#B45309', light: '#FEF3C7', dark: '#843F00', icon: '🔶' },
  'Andhra Pradesh': { color: '#1D4ED8', light: '#DBEAFE', dark: '#1E3A8A', icon: '⭐' },
  'Maharashtra':    { color: '#7C3AED', light: '#EDE9FE', dark: '#5B21B6', icon: '🏙️' },
  'Delhi':          { color: '#374151', light: '#F3F4F6', dark: '#1F2937', icon: '🏛️' },
};
const stateStyle = name => STATE_STYLE[name] || { color: '#6B7280', light: '#F3F4F6', dark: '#374151', icon: '🗺️' };

const GRADE_COLOR = { Platinum: '#2563EB', Gold: '#D97706', Silver: '#6B7280', Bronze: '#92400E' };
const GRADE_BG    = { Platinum: '#DBEAFE', Gold: '#FEF3C7', Silver: '#F3F4F6', Bronze: '#FEF3C7' };

function fmtInr(v) {
  if (!v) return '₹0';
  if (v >= 10000000) return `₹${(v/10000000).toFixed(1)}Cr`;
  if (v >= 100000)   return `₹${(v/100000).toFixed(1)}L`;
  if (v >= 1000)     return `₹${(v/1000).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
}
function fmtROIValue(sales, invested, roi) {
  if ((invested || 0) > 0) return `${roi || 0}x`;
  if ((sales || 0) > 0) return 'Sales only';
  return '0x';
}
function fmtROIStatus(sales, invested, roi) {
  if ((invested || 0) <= 0 && (sales || 0) > 0) return 'No investment';
  return roi >= 5 ? 'On track' : roi >= 3 ? 'Average' : 'Below target';
}
function investmentTooltip(doc) {
  const total = fmtInr(doc.total_invested || 0);
  const rows = Array.isArray(doc.investment_months) ? doc.investment_months : [];
  if (!rows.length) return `Cumulative investment: ${total}`;
  return [`Cumulative investment: ${total}`, ...rows.map(r => `${r.label}: ${fmtInr(r.amount || 0)}`)].join('\n');
}
function initials(n) { return (n || '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0,2).toUpperCase(); }

function Avatar({ name, color = '#888', size = 36 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color + '22', border: `1.5px solid ${color}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.32, fontWeight: 700, color, flexShrink: 0,
    }}>{initials(name)}</div>
  );
}

function Pill({ label, bg, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px',
      borderRadius: 20, background: bg || '#f0f0f0', color: color || '#333' }}>
      {label}
    </span>
  );
}

function CABar({ pct }) {
  const p = pct || 0;
  const color = p >= 100 ? '#3D8C40' : p >= 80 ? '#D97706' : '#DC2626';
  return (
    <div>
      <div style={{ height: 5, borderRadius: 3, background: '#f0f0f0', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(p, 100)}%`, background: color, borderRadius: 3, transition: 'width 0.6s' }} />
      </div>
      <div style={{ fontSize: 10, color, fontWeight: 700, marginTop: 2 }}>{p}%</div>
    </div>
  );
}

function Breadcrumb({ crumbs, onGo }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: '#d1d5db', fontSize: 14 }}>›</span>}
          <button onClick={() => onGo(i)} style={{
            border: 'none', padding: '3px 6px', borderRadius: 6,
            fontSize: 13, fontWeight: i === crumbs.length - 1 ? 700 : 500,
            color: i < crumbs.length - 1 ? '#3D8C40' : '#111',
            cursor: i < crumbs.length - 1 ? 'pointer' : 'default',
            textDecoration: i < crumbs.length - 1 ? 'underline' : 'none',
            background: i < crumbs.length - 1 ? 'transparent' : '#f3f4f6',
          }}>{c}</button>
        </React.Fragment>
      ))}
    </div>
  );
}

function ProductView({ doctor, repUser, year, month }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    setError('');
    roiAPI.doctorFull(doctor.doctor_id || doctor.id, year, month)
      .then(r => setData(r.data))
      .catch(() => setError('Unable to load doctor product details.'));
  }, [doctor, year, month]);

  if (error) return <div style={{ padding: 32, textAlign: 'center', color: '#dc2626' }}>{error}</div>;
  if (!data) return <div style={{ padding: 60, textAlign: 'center', color: '#aaa' }}>Loading...</div>;

  const trendMax = Math.max(...(data.monthly_trend || []).map(t => t.sales), 1);
  const caColor = data.ca_status === 'green' ? '#3D8C40' : data.ca_status === 'yellow' ? '#D97706' : '#DC2626';

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '16px 20px',
        background: '#f9fafb', borderRadius: 12, marginBottom: 20, border: '0.5px solid #e5e7eb' }}>
        <Avatar name={doctor.doctor_name || doctor.name || '?'} color="#3D8C40" size={48} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{doctor.doctor_name || doctor.name}</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            {doctor.specialty}{doctor.hospital ? ` · ${doctor.hospital}` : ''}
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
            {doctor.city}{doctor.client_code ? ` · ${doctor.client_code}` : ''}
          </div>
        </div>
        {repUser && (
          <div style={{ textAlign: 'right', fontSize: 12 }}>
            <div style={{ color: '#aaa' }}>Sales Rep</div>
            <div style={{ fontWeight: 700 }}>{repUser.name}</div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Invested', val: fmtInr(data.total_invested) },
          { label: `Sales · ${MONTH_NAMES[month]}`, val: fmtInr(data.actual_sales), color: '#3D8C40' },
          { label: 'ROI Multiple', val: fmtROIValue(data.actual_sales, data.total_invested, data.roi_multiple) },
          { label: 'Achievement', val: `${data.ca_percent}%`, color: caColor },
        ].map((s, i) => (
          <div key={i} style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color || '#111' }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Products · {MONTH_NAMES[month]} {year}</div>
          {data.products_sales && data.products_sales.length > 0 ? data.products_sales.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', borderRadius: 8, marginBottom: 6, background: '#f9fafb' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.product_name}</div>
                <div style={{ fontSize: 11, color: '#888' }}>Qty: {p.total_qty}</div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#3D8C40' }}>{fmtInr(p.total_sales)}</div>
            </div>
          )) : <div style={{ textAlign: 'center', color: '#aaa', padding: 24, fontSize: 13 }}>No sales this month</div>}
        </div>

        {data.monthly_trend && data.monthly_trend.length > 0 && (
          <div style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Monthly trend</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 80 }}>
              {data.monthly_trend.map((t, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <div style={{ fontSize: 9, color: '#888' }}>{fmtInr(t.sales)}</div>
                  <div style={{
                    width: '100%', borderRadius: '3px 3px 0 0',
                    height: `${Math.max((t.sales / trendMax) * 56, 2)}px`,
                    background: t.month === month ? '#3D8C40' : '#9FE1CB',
                  }} />
                  <div style={{ fontSize: 9, color: '#aaa' }}>{t.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ClientList({ repUser, onSelect }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');

  useEffect(() => {
    axios.get(`${API}/doctors/`, { params: { manager_id: repUser.id, include_inactive: false } })
      .then(r => { setClients(r.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [repUser.id]);

  const filtered = clients.filter(d =>
    !search || (d.name||'').toLowerCase().includes(search.toLowerCase()) ||
    (d.hospital||'').toLowerCase().includes(search.toLowerCase()) ||
    (d.city||'').toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: '#aaa' }}>Loading clients...</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <Avatar name={repUser.name || '?'} color="#3D8C40" size={44} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{repUser.name}</div>
          <div style={{ fontSize: 12, color: '#888' }}>{repUser.custom_role_name || repUser.role} · {clients.length} clients</div>
        </div>
      </div>
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search name, hospital, city..."
        style={{ width: '100%', padding: '9px 14px', borderRadius: 10, border: '0.5px solid #ddd', fontSize: 13, marginBottom: 16, boxSizing: 'border-box' }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {filtered.map(d => (
          <div key={d.id} onClick={() => onSelect(d)}
            style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderLeft: '3px solid #3D8C40',
              borderRadius: 10, padding: '13px 14px', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 10px #3D8C4022'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = ''}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>{d.specialty}{d.city ? ` · ${d.city}` : ''}</div>
            {d.hospital && <div style={{ fontSize: 11, color: '#bbb', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🏥 {d.hospital}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '0.5px solid #f0f0f0', paddingTop: 8 }}>
              {d.commercial_model && <Pill label={d.commercial_model} bg="#EEEDFE" color="#26215C" />}
              <span style={{ fontSize: 11, color: '#3D8C40', fontWeight: 600, marginLeft: 'auto' }}>View →</span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: '#aaa', fontSize: 13 }}>
            {search ? 'No matches' : 'No clients mapped yet'}
          </div>
        )}
      </div>
    </div>
  );
}

function TeamDrill({ stateName, users, docCounts, onSelect }) {
  const { color, light } = stateStyle(stateName);
  const teamUsers = users.filter(u => {
    const userStates = (u.state || '').split(',').map(s => s.trim());
    return userStates.some(s => toStateName(s) === stateName || s === stateName);
  });

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#888' }}>
        {teamUsers.length} team member{teamUsers.length !== 1 ? 's' : ''} covering <strong>{stateName}</strong>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {teamUsers.map(u => (
          <div key={u.id} onClick={() => (docCounts[u.id] || 0) > 0 && onSelect(u)}
            style={{
              background: '#fff', border: '0.5px solid #e5e7eb',
              borderLeft: `4px solid ${color}`, borderRadius: 12,
              padding: '16px 18px', cursor: (docCounts[u.id] || 0) > 0 ? 'pointer' : 'default',
            }}
            onMouseEnter={e => { if ((docCounts[u.id] || 0) > 0) e.currentTarget.style.boxShadow = `0 2px 12px ${color}33`; }}
            onMouseLeave={e => e.currentTarget.style.boxShadow = ''}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
              <Avatar name={u.name} color={color} size={40} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{u.name}</div>
                <div style={{ fontSize: 11, color: '#888' }}>{u.custom_role_name || u.role}{u.city ? ` · ${u.city}` : ''}</div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {u.phone && <div style={{ fontSize: 11, color: '#aaa' }}>📞 {u.phone}</div>}
              <div style={{
                fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 20,
                background: (docCounts[u.id] || 0) > 0 ? light : '#f5f5f5',
                color: (docCounts[u.id] || 0) > 0 ? color : '#aaa', marginLeft: 'auto',
              }}>
                🏥 {docCounts[u.id] || 0} clients
              </div>
            </div>
          </div>
        ))}
        {teamUsers.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: '#aaa', fontSize: 13 }}>
            No team members mapped to this region yet.
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user: me } = useAuth();
  const navigate = useNavigate();

  const todayStr = () => new Date().toISOString().split('T')[0];
  const monthStart = (y, m) => `${y}-${String(m).padStart(2,'0')}-01`;
  const monthEnd   = (y, m) => {
    const last = new Date(y, m, 0).getDate();
    const s = `${y}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
    return s > todayStr() ? todayStr() : s;
  };

  const [selYear,  setSelYear]  = useState(CUR_YEAR);
  const [selMonth, setSelMonth] = useState(CUR_MONTH);
  const [startDate, setStartDate] = useState(monthStart(CUR_YEAR, CUR_MONTH));
  const [endDate,   setEndDate]   = useState(todayStr());

  const year  = selYear;
  const month = selMonth;

  const goMonth = (delta) => {
    let y = selYear, m = selMonth + delta;
    if (m < 1)  { m = 12; y -= 1; }
    if (m > 12) { m = 1;  y += 1; }
    if (y > CUR_YEAR || (y === CUR_YEAR && m > CUR_MONTH)) return;
    setSelYear(y); setSelMonth(m);
    setStartDate(monthStart(y, m));
    setEndDate(monthEnd(y, m));
  };

  const [allDoctors,  setAllDoctors]  = useState([]);
  const [allUsers,    setAllUsers]    = useState([]);
  const [docCounts,   setDocCounts]   = useState({});
  const [topProducts, setTopProducts] = useState([]);
  const [clientStats, setClientStats] = useState(null);
  const [loading,     setLoading]     = useState(true);

  const [selRegion,     setSelRegion]     = useState(null);
  const [selCity,       setSelCity]       = useState(null);
  const [showAllCities, setShowAllCities] = useState(false);

  const [showSalesPanel,    setShowSalesPanel]    = useState(false);
  const [showInvestPanel,   setShowInvestPanel]   = useState(false);
  const [showROIPanel,      setShowROIPanel]      = useState(false);
  const [showAllInvest,     setShowAllInvest]     = useState(false);
  const [showAllProducts,   setShowAllProducts]   = useState(false);
  const [selProduct,        setSelProduct]        = useState(null);
  const [productDoctors,    setProductDoctors]    = useState([]);
  const [productDoctorsLoading, setProductDoctorsLoading] = useState(false);
  const [showAllProdDoctors, setShowAllProdDoctors] = useState(false);
  const [showMoreProducts,   setShowMoreProducts]   = useState(false);

  const normCity = c => (c || '').trim().toLowerCase().replace(/\b\w/g, l => l.toUpperCase());

  const [view,      setView]      = useState('overview');
  const [selState,  setSelState]  = useState(null);
  const [selUser,   setSelUser]   = useState(null);
  const [selDoctor, setSelDoctor] = useState(null);
  const [clientSearch, setClientSearch] = useState('');
  const [clientsVisible, setClientsVisible] = useState(8);

  useEffect(() => {
    if (!me?.id) return;
    setLoading(true);
    Promise.all([
      roiAPI.allDoctorsByDate(startDate, endDate, { viewer_id: me.id }),
      axios.get(`${API}/users/`, { params: { viewer_id: me.id } }),
      axios.get(`${API}/sales/by-product`, { params: { year, month, start_date: startDate, end_date: endDate } }),
    ]).then(([docRes, userRes, prodRes]) => {
      const docs  = docRes.data  || [];
      const users = userRes.data || [];
      setAllDoctors(docs);
      setAllUsers(users);
      setTopProducts((prodRes.data || []).slice(0, 5));
      const counts = {};
      docs.forEach(d => { if (d.manager_id) counts[d.manager_id] = (counts[d.manager_id] || 0) + 1; });
      setDocCounts(counts);
      setLoading(false);
    }).catch(() => setLoading(false));

    // Client stats — prescribed vs not
    roiAPI.clientStats(year, month, { viewer_id: me.id })
      .then(r => setClientStats(r.data)).catch(() => {});
  }, [me?.id, startDate, endDate, year, month]);

  const allRegions = useMemo(() => {
    const seen = new Set();
    allDoctors.forEach(d => { const s = toStateName(d.state_code); if (s) seen.add(s); });
    return [...seen].sort();
  }, [allDoctors]);

  const cityList = useMemo(() => {
    const src = selRegion ? allDoctors.filter(d => toStateName(d.state_code) === selRegion) : allDoctors;
    const counts = {};
    src.forEach(d => { const c = normCity(d.city); if (c) counts[c] = (counts[c] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [allDoctors, selRegion]);

  const displayDoctors = useMemo(() => {
    let d = selRegion ? allDoctors.filter(x => toStateName(x.state_code) === selRegion) : allDoctors;
    if (selCity) d = d.filter(x => normCity(x.city) === selCity);
    return d;
  }, [allDoctors, selRegion, selCity]);

  const {
    totalSales, totalInvested, overallROI,
    top5Doctors, top5Reps, atRisk,
  } = useMemo(() => {
    if (!displayDoctors.length) return {
      totalSales: 0, totalInvested: 0, overallROI: 0,
      top5Doctors: [], top5Reps: [], atRisk: [],
    };
    const totalSales    = displayDoctors.reduce((a, d) => a + (d.actual_sales   || 0), 0);
    const totalInvested = displayDoctors.reduce((a, d) => a + (d.total_invested || 0), 0);
    const overallROI    = totalInvested > 0 ? Math.round((totalSales / totalInvested) * 10) / 10 : 0;
    const top5Doctors   = [...displayDoctors].sort((a, b) => b.actual_sales - a.actual_sales).slice(0, 5);
    const atRisk        = displayDoctors.filter(d => d.is_at_risk || d.ca_percent < 60)
                            .sort((a, b) => a.ca_percent - b.ca_percent).slice(0, 10);
    const repMap = {};
    displayDoctors.forEach(d => {
      if (!d.manager_id) return;
      if (!repMap[d.manager_id]) repMap[d.manager_id] = { manager_id: d.manager_id, name: d.manager_name || '—', sales: 0, count: 0 };
      repMap[d.manager_id].sales += d.actual_sales || 0;
      repMap[d.manager_id].count += 1;
    });
    const top5Reps = Object.values(repMap).sort((a, b) => b.sales - a.sales).slice(0, 5);
    return { totalSales, totalInvested, overallROI, top5Doctors, top5Reps, atRisk };
  }, [displayDoctors]);

  const repUsers   = allUsers.filter(u => u.role !== 'admin' && u.role !== 'md' && (docCounts[u.id] || 0) > 0);
  const totalTeams = allUsers.filter(u => u.role !== 'admin' && u.role !== 'md').length;
  const totalDocs  = displayDoctors.length;
  const hasReports = allUsers.some(u => u.reports_to_id === me?.id);

  const crumbMap = {
    'overview':    ['Dashboard'],
    'region':      ['Dashboard', selState || 'All Regions'],
    'all-teams':   ['Dashboard', 'Teams'],
    'all-clients': ['Dashboard', 'Clients'],
    'team':        ['Dashboard', selState || 'Regions', selUser?.name].filter(Boolean),
    'client':      ['Dashboard', selState || 'Regions', selDoctor?.doctor_name || selDoctor?.name].filter(Boolean),
    'product':     ['Dashboard', selState || 'Regions', selDoctor?.doctor_name || selDoctor?.name].filter(Boolean),
  };
  const crumbs = crumbMap[view] || ['Dashboard'];

  const handleBreadcrumb = idx => {
    if (idx === 0) { setView('overview'); setSelState(null); setSelUser(null); setSelDoctor(null); }
    else if (idx === 1) {
      if (view === 'all-teams' || view === 'all-clients') { setView('overview'); }
      else if (view === 'team')   { setView(selState ? 'region' : 'all-teams'); setSelUser(null); setSelDoctor(null); }
      else if (view === 'client' || view === 'product') {
        if (selUser) { setView('team'); setSelDoctor(null); }
        else         { setView('all-teams'); setSelDoctor(null); }
      }
    } else if (idx === 2) {
      if (view === 'client' || view === 'product') { setView('client'); }
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 28 }}>⏳</div>
      <div style={{ fontSize: 14, color: '#888' }}>Loading dashboard...</div>
    </div>
  );

  const closeAllPanels = () => { setShowSalesPanel(false); setShowInvestPanel(false); setShowROIPanel(false); };

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>

      {/* HERO HEADER */}
      <div style={{
        background: 'linear-gradient(135deg, #0f2027 0%, #203a43 40%, #2c5364 100%)',
        padding: '22px 28px 0', color: '#fff',
        position: 'relative', overflow: 'hidden',
        borderRadius: '0 0 28px 28px',
        boxShadow: '0 8px 32px rgba(15,32,39,0.45)',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -40, width: 180, height: 180,
          borderRadius: '50%', background: 'rgba(61,140,64,0.18)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 10, right: 120, width: 80, height: 80,
          borderRadius: '50%', background: 'rgba(245,184,0,0.12)', pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
              Fortel Life Sciences · CRM
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.5px' }}>
              {me && me.name ? `Welcome, ${me.name.split(' ')[0]} 👋` : 'Dashboard'}
            </div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 10, padding: '6px 14px', textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#F5B800' }}>{MONTH_NAMES[CUR_MONTH]} {CUR_YEAR}</div>
            <div style={{ fontSize: 10, opacity: 0.5 }}>Today</div>
          </div>
        </div>

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.12)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', overflow: 'hidden' }}>
            <button onClick={() => goMonth(-1)}
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18, padding: '8px 14px', lineHeight: 1, opacity: 0.85 }}>
              ‹
            </button>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', minWidth: 90, textAlign: 'center', padding: '0 4px' }}>
              {MONTH_NAMES[selMonth]} {selYear}
            </span>
            <button onClick={() => goMonth(+1)}
              style={{ background: 'none', border: 'none', color: '#fff',
                cursor: (selYear === CUR_YEAR && selMonth === CUR_MONTH) ? 'not-allowed' : 'pointer',
                fontSize: 18, padding: '8px 14px', lineHeight: 1,
                opacity: (selYear === CUR_YEAR && selMonth === CUR_MONTH) ? 0.25 : 0.85 }}>
              ›
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: '7px 12px', border: '1px solid rgba(255,255,255,0.2)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 700, letterSpacing: 0.5 }}>FROM</span>
            <input type="date" value={startDate} max={endDate}
              onChange={e => setStartDate(e.target.value)}
              style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.3)', color: '#fff', fontSize: 12, padding: '2px 4px', outline: 'none', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 700, letterSpacing: 0.5 }}>TO</span>
            <input type="date" value={endDate} min={startDate} max={todayStr()}
              onChange={e => setEndDate(e.target.value)}
              style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.3)', color: '#fff', fontSize: 12, padding: '2px 4px', outline: 'none', cursor: 'pointer' }}
            />
          </div>

          <button onClick={() => {
            setSelYear(CUR_YEAR); setSelMonth(CUR_MONTH);
            setStartDate(monthStart(CUR_YEAR, CUR_MONTH));
            setEndDate(todayStr());
          }} style={{ background: 'rgba(245,184,0,0.25)', border: '1px solid rgba(245,184,0,0.4)', borderRadius: 8, color: '#F5B800', fontSize: 11, fontWeight: 700, padding: '7px 12px', cursor: 'pointer' }}>
            This Month
          </button>
        </div>
        <div style={{ fontSize: 11, opacity: 0.4, marginTop: 4 }}>{startDate} to {endDate}</div>

        {/* Region chips */}
        {allRegions.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', alignSelf: 'center', marginRight: 4 }}>Region</span>
            {[{ label: 'All', value: null }, ...allRegions.map(r => ({ label: r, value: r }))].map(({ label, value }) => {
              const active = selRegion === value;
              const regionAccents = { 'Tamil Nadu': '#F97316', 'Kerala': '#10B981', 'Telangana': '#8B5CF6', 'Karnataka': '#EF4444', 'Maharashtra': '#3B82F6' };
              const ac = regionAccents[value] || '#F5B800';
              return (
                <button key={label}
                  onClick={() => { setSelRegion(value); setSelCity(null); setShowAllCities(false); setView('overview'); setSelState(value); }}
                  style={{ padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    border: active ? `2px solid ${ac}` : '2px solid rgba(255,255,255,0.15)',
                    background: active ? ac : 'rgba(255,255,255,0.08)',
                    color: active ? '#fff' : 'rgba(255,255,255,0.75)',
                    boxShadow: active ? `0 2px 12px ${ac}55` : 'none',
                  }}>
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {/* City chips */}
        {cityList.length > 0 && (() => {
          const top5 = cityList.slice(0, 5);
          const rest = cityList.slice(5);
          return (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', marginRight: 4 }}>City</span>
              <button onClick={() => setSelCity(null)}
                style={{ padding: '3px 11px', borderRadius: 20, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                  border: selCity === null ? '2px solid #3D8C40' : '2px solid rgba(255,255,255,0.12)',
                  background: selCity === null ? '#3D8C40' : 'rgba(255,255,255,0.07)',
                  color: '#fff' }}>All</button>
              {top5.map(([city, cnt]) => (
                <button key={city} onClick={() => setSelCity(selCity === normCity(city) ? null : normCity(city))}
                  style={{ padding: '3px 11px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    border: selCity === normCity(city) ? '2px solid #3D8C40' : '2px solid rgba(255,255,255,0.12)',
                    background: selCity === normCity(city) ? '#3D8C40' : 'rgba(255,255,255,0.07)',
                    color: selCity === normCity(city) ? '#fff' : 'rgba(255,255,255,0.7)' }}>
                  {city} <span style={{ opacity: 0.6 }}>({cnt})</span>
                </button>
              ))}
              {rest.length > 0 && (
                <select onChange={e => { if (e.target.value) setSelCity(e.target.value); e.target.value = ''; }}
                  defaultValue=""
                  style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    background: 'rgba(255,255,255,0.1)', color: '#fff', border: '2px solid rgba(255,255,255,0.15)' }}>
                  <option value="" style={{ color: '#000' }}>+{rest.length} more...</option>
                  {rest.map(([city, cnt]) => (
                    <option key={city} value={city} style={{ color: '#000' }}>{city} ({cnt})</option>
                  ))}
                </select>
              )}
            </div>
          );
        })()}

        {/* Metric cards */}
        {(() => {
          const CARD_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#0F6E56'];
          const roiStatus = fmtROIStatus(totalSales, totalInvested, overallROI);
          const cards = [
            ...(hasReports ? [
              { icon: '◈', label: 'Team', val: totalTeams, action: () => { closeAllPanels(); setView('all-teams'); setSelUser(null); } },
            ] : []),
            { icon: '✦', label: 'Clients',    val: totalDocs,             action: () => { closeAllPanels(); setView('all-clients'); setClientSearch(''); setClientsVisible(8); }, prescribed: clientStats?.prescribed, notPrescribed: clientStats?.not_prescribed },
            { icon: '◆', label: 'Sales',      val: fmtInr(totalSales),    action: () => { setView('overview'); setShowInvestPanel(false); setShowROIPanel(false); setShowSalesPanel(s => !s); setSelProduct(null); setShowAllProducts(false); setShowAllProdDoctors(false); } },
            { icon: '◈', label: 'Investment', val: fmtInr(totalInvested), action: () => { setView('overview'); setShowSalesPanel(false); setShowROIPanel(false); setShowInvestPanel(s => !s); setShowAllInvest(false); } },
            { icon: '◇', label: 'ROI',        val: fmtROIValue(totalSales, totalInvested, overallROI),      action: () => { setView('overview'); setShowSalesPanel(false); setShowInvestPanel(false); setShowROIPanel(s => !s); }, sub: roiStatus },
          ];
          return (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cards.length}, 1fr)`, gap: 12, marginTop: 20, position: 'relative', zIndex: 2 }}>
              {cards.map((m, i) => {
                const c = CARD_COLORS[i % CARD_COLORS.length];
                return (
                  <div key={i} onClick={m.action || undefined}
                    style={{
                      background: `linear-gradient(135deg, ${c}ee 0%, ${c}bb 100%)`,
                      borderRadius: 14, padding: '14px 16px',
                      cursor: m.action ? 'pointer' : 'default',
                      boxShadow: `0 4px 20px ${c}55`,
                      border: `1px solid ${c}44`,
                      color: '#fff',
                    }}
                    onMouseEnter={e => { if (m.action) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 28px ${c}77`; } }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = `0 4px 20px ${c}55`; }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>{m.label}</div>
                    {m.prescribed === undefined && <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.5px' }}>{m.val}</div>}
                    {m.sub && <div style={{ fontSize: 10, opacity: 0.85, marginTop: 4 }}>{m.sub}</div>}
                    {m.action && !m.sub && !m.prescribed && <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>tap to explore</div>}

                    {/* Clients card — 2-column layout */}
                    {m.prescribed !== undefined && (
                      <div style={{ display: 'flex', gap: 0, marginTop: 8 }}>
                        {/* Col 1 — total */}
                        <div style={{ flex: 1, borderRight: '1px solid rgba(255,255,255,0.25)', paddingRight: 10 }}>
                          <div style={{ fontSize: 26, fontWeight: 900 }}>{m.val}</div>
                          <div style={{ fontSize: 9, opacity: 0.55 }}>Total</div>
                          <div style={{ fontSize: 9, opacity: 0.4, marginTop: 8 }}>tap to explore</div>
                        </div>
                        {/* Col 2 — prescribed / not prescribed */}
                        <div style={{ flex: 1, paddingLeft: 10 }}>
                          <div style={{ paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.2)' }}>
                            <div style={{ fontSize: 18, fontWeight: 800 }}>{m.prescribed ?? '—'}</div>
                            <div style={{ fontSize: 9, opacity: 0.55 }}>Prescribed</div>
                          </div>
                          <div style={{ paddingTop: 6 }}>
                            <div style={{ fontSize: 18, fontWeight: 800 }}>{m.notPrescribed ?? '—'}</div>
                            <div style={{ fontSize: 9, opacity: 0.55 }}>Not Prescribed</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        <div style={{ height: 24 }} />
      </div>

      {/* MAIN BODY */}
      <div style={{ padding: '16px 28px 28px' }}>

        {view !== 'overview' && <Breadcrumb crumbs={crumbs} onGo={handleBreadcrumb} />}

        {/* OVERVIEW */}
        {view === 'overview' && (
          <div>

            {/* Sales panel */}
            {showSalesPanel && topProducts.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '0.5px solid #e5e7eb', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    Products by Sales{selRegion ? ` · ${selRegion}` : ''}{selCity ? ` › ${selCity}` : ''}
                  </div>
                  {selProduct && (
                    <button onClick={() => { setSelProduct(null); setProductDoctors([]); setShowAllProdDoctors(false); }}
                      style={{ fontSize: 11, color: '#3D8C40', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
                      Back to Products
                    </button>
                  )}
                </div>

                {!selProduct && (() => {
                  const visible = showAllProducts ? topProducts : topProducts.slice(0, 5);
                  const maxVal = topProducts[0] ? topProducts[0].total_sales : 1;
                  const colors = ['#3D8C40','#F5B800','#3B82F6','#8B5CF6','#EF4444'];
                  return (
                    <div>
                      {visible.map((p, i) => {
                        const pct = Math.round((p.total_sales / maxVal) * 100);
                        const c = colors[i % colors.length];
                        return (
                          <div key={p.product_id}
                            onClick={() => {
                              setSelProduct(p);
                              setShowAllProdDoctors(false);
                              setProductDoctorsLoading(true);
                              axios.get(`${API}/sales/product/${p.product_id}/doctors`, {
                                params: { year, month, start_date: startDate, end_date: endDate }
                              }).then(r => { setProductDoctors(r.data || []); }).finally(() => setProductDoctorsLoading(false));
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
                              borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                            onMouseLeave={e => e.currentTarget.style.background = ''}
                          >
                            <div style={{ width: 22, height: 22, borderRadius: '50%', background: c + '22',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 10, fontWeight: 800, color: c, flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{p.product_name}</div>
                              <div style={{ height: 4, borderRadius: 2, background: '#e5e7eb' }}>
                                <div style={{ height: '100%', width: `${pct}%`, borderRadius: 2, background: c }} />
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: c }}>{fmtInr(p.total_sales)}</div>
                              <div style={{ fontSize: 10, color: '#aaa' }}>Qty {p.total_qty}</div>
                            </div>
                            <div style={{ color: '#ccc', fontSize: 12 }}>›</div>
                          </div>
                        );
                      })}
                      {topProducts.length > 5 && (
                        <button onClick={() => setShowAllProducts(s => !s)}
                          style={{ marginTop: 10, padding: '6px 14px', borderRadius: 20, border: '1px solid #e5e7eb',
                            background: '#f9fafb', fontSize: 11, fontWeight: 600, color: '#666', cursor: 'pointer' }}>
                          {showAllProducts ? 'Show less' : `+ ${topProducts.length - 5} more products`}
                        </button>
                      )}
                    </div>
                  );
                })()}

                {selProduct && (
                  <div>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
                      Doctors prescribing <strong>{selProduct.product_name}</strong>
                    </div>
                    {productDoctorsLoading ? (
                      <div style={{ textAlign: 'center', color: '#aaa', padding: '20px 0' }}>Loading...</div>
                    ) : productDoctors.length === 0 ? (
                      <div style={{ textAlign: 'center', color: '#aaa', padding: '20px 0' }}>No data</div>
                    ) : (() => {
                      const visible = showAllProdDoctors ? productDoctors : productDoctors.slice(0, 5);
                      return (
                        <div>
                          {visible.map((d, i) => {
                            const maxVal = productDoctors[0] ? productDoctors[0].total_value : 1;
                            const pct = Math.round((d.total_value / maxVal) * 100);
                            const rankColors = ['#F59E0B','#6B7280','#92400E'];
                            const rc = rankColors[i] || '#3D8C40';
                            return (
                              <div key={d.doctor_id} style={{ display: 'flex', alignItems: 'center', gap: 12,
                                padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
                                <div style={{ width: 22, height: 22, borderRadius: '50%',
                                  background: i < 3 ? rc + '22' : '#f3f4f6',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 10, fontWeight: 800, color: i < 3 ? rc : '#6b7280', flexShrink: 0 }}>{i + 1}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>{d.doctor_name}</div>
                                  <div style={{ height: 3, borderRadius: 2, background: '#e5e7eb', marginTop: 4 }}>
                                    <div style={{ height: '100%', width: `${pct}%`, borderRadius: 2, background: '#3D8C40' }} />
                                  </div>
                                </div>
                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: '#3D8C40' }}>{fmtInr(d.total_value)}</div>
                                  <div style={{ fontSize: 10, color: '#aaa' }}>Qty {d.total_qty}</div>
                                </div>
                              </div>
                            );
                          })}
                          {productDoctors.length > 5 && (
                            <button onClick={() => setShowAllProdDoctors(s => !s)}
                              style={{ marginTop: 10, padding: '6px 14px', borderRadius: 20, border: '1px solid #e5e7eb',
                                background: '#f9fafb', fontSize: 11, fontWeight: 600, color: '#666', cursor: 'pointer' }}>
                              {showAllProdDoctors ? 'Show less' : `+ ${productDoctors.length - 5} more doctors`}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Investment panel */}
            {showInvestPanel && (
              <div style={{ background: 'linear-gradient(160deg,#fff 0%,#f0fdf4 100%)', borderRadius: 14, padding: '18px 20px', border: '1.5px solid #BBF7D0', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 18 }}>💰</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#065F46' }}>
                      Investment by Doctor{selRegion ? ` · ${selRegion}` : ''}{selCity ? ` › ${selCity}` : ''}
                    </div>
                    <div style={{ fontSize: 10, color: '#059669' }}>
                      Total: {fmtInr(totalInvested)} across {displayDoctors.filter(d => d.total_invested > 0).length} doctors
                    </div>
                  </div>
                </div>
                {(() => {
                  const invested = [...displayDoctors]
                    .filter(d => d.total_invested > 0)
                    .sort((a, b) => b.total_invested - a.total_invested);
                  if (invested.length === 0) return (
                    <div style={{ textAlign: 'center', color: '#aaa', padding: '20px 0' }}>No investment data for this selection</div>
                  );
                  const maxVal = invested[0] ? invested[0].total_invested : 1;
                  const visible = showAllInvest ? invested : invested.slice(0, 5);
                  return (
                    <div>
                      {visible.map((d, i) => {
                        const pct = Math.round((d.total_invested / maxVal) * 100);
                        const rankColors = ['#10B981','#059669','#047857','#6B7280','#9CA3AF'];
                        const c = rankColors[Math.min(i, rankColors.length - 1)];
                        return (
                          <div key={d.doctor_id} style={{ display: 'flex', alignItems: 'center', gap: 10,
                            padding: '9px 10px', borderRadius: 10, marginBottom: 4, borderLeft: `3px solid ${c}` }}
                            onMouseEnter={e => e.currentTarget.style.background = '#F0FDF4'}
                            onMouseLeave={e => e.currentTarget.style.background = ''}
                          >
                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: c,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 10, fontWeight: 900, color: '#fff', flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#065F46' }}>{d.doctor_name}</div>
                              <div title={investmentTooltip(d)} style={{ height: 12, borderRadius: 6, background: '#BBF7D0', marginTop: 4, overflow: 'hidden', position: 'relative' }}>
                                <div style={{ height: '100%', width: `${pct}%`, borderRadius: 6, background: c }} />
                                <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 9, lineHeight: 1, fontWeight: 900, color: pct > 35 ? '#fff' : '#065F46', textShadow: pct > 35 ? '0 1px 2px rgba(0,0,0,0.25)' : 'none', pointerEvents: 'none' }}>{fmtInr(d.total_invested)}</span>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 800, color: '#059669' }}>{fmtInr(d.total_invested)}</div>
                              <div style={{ fontSize: 10, color: '#aaa' }}>{d.city || ''}</div>
                            </div>
                          </div>
                        );
                      })}
                      {invested.length > 5 && (
                        <button onClick={() => setShowAllInvest(s => !s)}
                          style={{ marginTop: 8, padding: '5px 14px', borderRadius: 20, border: '1px solid #BBF7D0',
                            background: '#F0FDF4', fontSize: 11, fontWeight: 600, color: '#059669', cursor: 'pointer' }}>
                          {showAllInvest ? 'Show less' : `+ ${invested.length - 5} more doctors`}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ROI Panel */}
            {showROIPanel && (() => {
              const grades = ['Platinum', 'Gold', 'Silver', 'Bronze'];
              const gradeMap = {};
              grades.forEach(g => { gradeMap[g] = { count: 0, sales: 0, invested: 0 }; });
              displayDoctors.forEach(d => {
                const g = d.roi_grade || 'Bronze';
                if (gradeMap[g]) {
                  gradeMap[g].count    += 1;
                  gradeMap[g].sales    += d.actual_sales   || 0;
                  gradeMap[g].invested += d.total_invested || 0;
                }
              });
              const topROIDocs = [...displayDoctors]
                .filter(d => (d.actual_sales || 0) > 0 || (d.roi_multiple || 0) > 0)
                .sort((a, b) =>
                  (b.actual_sales || 0) - (a.actual_sales || 0) ||
                  (b.roi_multiple || 0) - (a.roi_multiple || 0)
                )
                .slice(0, 5);
              return (
                <div style={{ background: '#fff', borderRadius: 10, padding: '10px 14px', border: '1px solid #e0f2fe', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0369A1' }}>
                      ROI Breakdown{selRegion ? ` · ${selRegion}` : ''} <span style={{ fontWeight: 400, color: '#aaa', fontSize: 11 }}>· {fmtROIValue(totalSales, totalInvested, overallROI)} overall · {displayDoctors.length} doctors</span>
                    </div>
                    <button onClick={() => navigate('/investment-roi')}
                      style={{ fontSize: 10, fontWeight: 700, color: '#0369A1', background: '#E0F2FE', border: 'none', borderRadius: 20, padding: '3px 10px', cursor: 'pointer' }}>
                      Full ROI →
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: topROIDocs.length > 0 ? 10 : 0 }}>
                    {grades.map(g => {
                      const gd = gradeMap[g];
                      const roi = gd.invested > 0 ? (gd.sales / gd.invested).toFixed(1) : '—';
                      return (
                        <div key={g} style={{ flex: 1, background: GRADE_BG[g], border: `1px solid ${GRADE_COLOR[g]}33`, borderRadius: 8, padding: '6px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: GRADE_COLOR[g] }}>{g}</div>
                          <div style={{ fontSize: 16, fontWeight: 900, color: '#111', lineHeight: 1.2 }}>{gd.count}</div>
                          <div style={{ fontSize: 9, color: GRADE_COLOR[g], fontWeight: 600, marginTop: 2 }}>{fmtInr(gd.sales)} · {roi}x</div>
                        </div>
                      );
                    })}
                  </div>
                  {topROIDocs.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {topROIDocs.map((d, i) => (
                        <div key={d.doctor_id}
                          onClick={() => { setSelDoctor(d); setSelUser(allUsers.find(u => u.id === d.manager_id) || null); setView('product'); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 20, cursor: 'pointer', background: GRADE_BG[d.roi_grade] || '#f5f5f5', border: `1px solid ${GRADE_COLOR[d.roi_grade] || '#888'}33` }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: GRADE_COLOR[d.roi_grade] || '#888' }}>{fmtROIValue(d.actual_sales, d.total_invested, d.roi_multiple)}</span>
                          <span style={{ fontSize: 11, color: '#333', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.doctor_name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Investment vs Sales Returns Tracker */}
            {displayDoctors.filter(d => d.total_invested > 0).length > 0 && (() => {
              const chartDocs = [...displayDoctors]
                .filter(d => d.total_invested > 0)
                .sort((a, b) => b.total_invested - a.total_invested)
                .slice(0, 12);
              const maxVal = Math.max(...chartDocs.flatMap(d => [d.total_invested, d.actual_sales]), 1);
              const belowBE = chartDocs.filter(d => d.actual_sales < d.total_invested).length;
              return (
                <div style={{ background: '#fff', borderRadius: 14, border: '0.5px solid #e5e7eb', padding: '16px 20px', marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#111', display: 'flex', alignItems: 'center', gap: 10 }}>
                        Top Invested Doctors — Returns Tracker
                        {belowBE > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fef2f2', padding: '2px 9px', borderRadius: 20 }}>⚠ {belowBE} below break-even</span>}
                      </div>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Sorted by highest investment · click to drill in</div>
                    </div>
                    <div style={{ display: 'flex', gap: 16 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555' }}>
                        <span style={{ width: 12, height: 9, borderRadius: 2, background: '#f97316', display: 'inline-block' }} />Invested
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555' }}>
                        <span style={{ width: 12, height: 9, borderRadius: 2, background: '#0F6E56', display: 'inline-block' }} />Sales
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 32px' }}>
                    {chartDocs.map((doc, i) => {
                      const invPct   = (doc.total_invested / maxVal) * 100;
                      const salesPct = (doc.actual_sales   / maxVal) * 100;
                      const roi      = fmtROIValue(doc.actual_sales, doc.total_invested, doc.roi_multiple);
                      const good     = doc.actual_sales >= doc.total_invested;
                      const gc       = GRADE_COLOR[doc.roi_grade] || '#888';
                      const gb       = GRADE_BG[doc.roi_grade]    || '#f5f5f5';
                      return (
                        <div key={doc.doctor_id} style={{ cursor: 'pointer', paddingBottom: 8, borderBottom: '0.5px solid #f3f4f6' }}
                          onClick={() => {
                            const mgr = allUsers.find(u => u.id === doc.manager_id);
                            setSelUser(mgr || null); setSelDoctor(doc); setView('product');
                          }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                            <span style={{ fontSize: 10, color: '#bbb', width: 14, textAlign: 'right', flexShrink: 0 }}>{i+1}</span>
                            <span style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.doctor_name}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: gb, color: gc, flexShrink: 0 }}>{doc.roi_grade}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: good ? '#0F6E56' : '#dc2626', width: 56, textAlign: 'right', flexShrink: 0 }}>{roi}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                            <span style={{ fontSize: 9, color: '#f97316', width: 40, textAlign: 'right', flexShrink: 0 }}>Inv</span>
                            <div title={investmentTooltip(doc)} style={{ flex: 1, height: 12, background: '#f9fafb', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                              <div style={{ width: `${invPct}%`, height: '100%', background: '#f97316', borderRadius: 2 }} />
                              <span style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 9, lineHeight: 1, fontWeight: 900, color: invPct > 32 ? '#fff' : '#f97316', textShadow: invPct > 32 ? '0 1px 2px rgba(0,0,0,0.25)' : 'none', pointerEvents: 'none' }}>{fmtInr(doc.total_invested)}</span>
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#f97316', width: 52, textAlign: 'right', flexShrink: 0 }}>{fmtInr(doc.total_invested)}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 9, color: '#0F6E56', width: 40, textAlign: 'right', flexShrink: 0 }}>Sales</span>
                            <div style={{ flex: 1, height: 8, background: '#f9fafb', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                              <div style={{ width: `${salesPct}%`, height: '100%', background: '#0F6E56', borderRadius: 2 }} />
                              {invPct > 0 && <div style={{ position: 'absolute', left: `${invPct}%`, top: 0, bottom: 0, width: 1.5, background: '#f97316', opacity: 0.7 }} />}
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#0F6E56', width: 52, textAlign: 'right', flexShrink: 0 }}>{fmtInr(doc.actual_sales)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Top Doctors + Top Reps + Top Products */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>

              <div style={{ background: 'linear-gradient(160deg, #fff 0%, #fef9ec 100%)', borderRadius: 16, padding: '18px 20px', border: '1.5px solid #FEF3C7' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 18 }}>🏆</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#92400E' }}>Top Doctors</div>
                    <div style={{ fontSize: 10, color: '#B45309', opacity: 0.7 }}>{MONTH_NAMES[month]} · by sales</div>
                  </div>
                </div>
                {top5Doctors.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#aaa', padding: '24px 0', fontSize: 13 }}>No sales data yet</div>
                ) : top5Doctors.map((d, i) => {
                  const rankColors = ['#F59E0B','#9CA3AF','#B45309','#6B7280','#6B7280'];
                  const gradeColor = GRADE_COLOR[d.roi_grade] || '#888';
                  const gradeBg    = GRADE_BG[d.roi_grade]    || '#f5f5f5';
                  return (
                    <div key={d.doctor_id} onClick={() => {
                      setSelDoctor(d);
                      const mgr = allUsers.find(u => u.id === d.manager_id);
                      setSelUser(mgr || null);
                      if (d.state_code) setSelState(toStateName(d.state_code));
                      setView('product');
                    }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
                        borderRadius: 10, marginBottom: 4, cursor: 'pointer',
                        borderLeft: `3px solid ${rankColors[i]}` }}
                      onMouseEnter={e => e.currentTarget.style.background = '#FFFBEB'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >
                      <div style={{ width: 20, height: 20, borderRadius: '50%',
                        background: rankColors[i], display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 10, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
                        {i + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.doctor_name}</div>
                        <div style={{ fontSize: 10, color: '#B45309', opacity: 0.7 }}>{d.city || d.specialty || ''}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#D97706' }}>{fmtInr(d.actual_sales)}</div>
                        <Pill label={d.roi_grade} bg={gradeBg} color={gradeColor} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ background: 'linear-gradient(160deg, #fff 0%, #f0fdf4 100%)', borderRadius: 16, padding: '18px 20px', border: '1.5px solid #BBF7D0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 18 }}>⭐</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#065F46' }}>Top Reps</div>
                    <div style={{ fontSize: 10, color: '#059669', opacity: 0.8 }}>{MONTH_NAMES[month]} · by revenue</div>
                  </div>
                </div>
                {(() => {
                  const repMap = {};
                  displayDoctors.forEach(d => {
                    if (!d.manager_id) return;
                    if (!repMap[d.manager_id]) repMap[d.manager_id] = { manager_id: d.manager_id, name: d.manager_name || '—', sales: 0, count: 0 };
                    repMap[d.manager_id].sales += d.actual_sales || 0;
                    repMap[d.manager_id].count += 1;
                  });
                  const top5Reps = Object.values(repMap).sort((a, b) => b.sales - a.sales).slice(0, 5);
                  if (top5Reps.length === 0) return <div style={{ textAlign: 'center', color: '#aaa', padding: '24px 0', fontSize: 13 }}>No sales data yet</div>;
                  const rankColors = ['#10B981','#9CA3AF','#6B7280','#6B7280','#6B7280'];
                  return top5Reps.map((r, i) => {
                    const u = allUsers.find(u => u.id === r.manager_id);
                    return (
                      <div key={r.manager_id} onClick={() => { if (u) { setSelUser(u); setSelState(null); setView('team'); } }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
                          borderRadius: 10, marginBottom: 4, cursor: u ? 'pointer' : 'default',
                          borderLeft: `3px solid ${rankColors[i]}` }}
                        onMouseEnter={e => { if (u) e.currentTarget.style.background = '#F0FDF4'; }}
                        onMouseLeave={e => e.currentTarget.style.background = ''}
                      >
                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: rankColors[i], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, color: '#fff', flexShrink: 0 }}>{i + 1}</div>
                        <Avatar name={r.name} color="#10B981" size={28} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{r.name}</div>
                          <div style={{ fontSize: 10, color: '#059669', opacity: 0.8 }}>{r.count} clients</div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: '#059669' }}>{fmtInr(r.sales)}</div>
                          <div style={{ fontSize: 10, color: '#aaa' }}>sales</div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              <div style={{ background: 'linear-gradient(160deg, #fff 0%, #faf5ff 100%)', borderRadius: 16, padding: '18px 20px', border: '1.5px solid #E9D5FF' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 18 }}>💊</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#4C1D95' }}>Top Products</div>
                    <div style={{ fontSize: 10, color: '#7C3AED', opacity: 0.8 }}>{MONTH_NAMES[month]} · by value</div>
                  </div>
                </div>
                {topProducts.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#aaa', padding: '24px 0', fontSize: 13 }}>No sales data yet</div>
                ) : (() => {
                  const colors = ['#7C3AED','#A855F7','#6D28D9','#8B5CF6','#C084FC'];
                  const maxVal = topProducts[0] ? topProducts[0].total_sales : 1;
                  const visible = showMoreProducts ? topProducts : topProducts.slice(0, 5);
                  return (
                    <div>
                      {visible.map((p, i) => {
                        const pct = Math.round((p.total_sales / maxVal) * 100);
                        const c = colors[i % colors.length];
                        return (
                          <div key={p.product_id} style={{ display: 'flex', alignItems: 'center', gap: 10,
                            padding: '9px 10px', borderRadius: 10, marginBottom: 4, borderLeft: `3px solid ${c}` }}
                            onMouseEnter={e => e.currentTarget.style.background = '#FAF5FF'}
                            onMouseLeave={e => e.currentTarget.style.background = ''}
                          >
                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, color: '#fff', flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#4C1D95' }}>{p.product_name}</div>
                              <div style={{ height: 3, borderRadius: 2, background: '#E9D5FF', marginTop: 4 }}>
                                <div style={{ height: '100%', width: `${pct}%`, borderRadius: 2, background: c }} />
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 800, color: c }}>{fmtInr(p.total_sales)}</div>
                              <div style={{ fontSize: 10, color: '#7C3AED', opacity: 0.6 }}>Qty {p.total_qty}</div>
                            </div>
                          </div>
                        );
                      })}
                      {topProducts.length > 5 && (
                        <button onClick={() => setShowMoreProducts(s => !s)}
                          style={{ marginTop: 6, padding: '5px 12px', borderRadius: 20, border: '1px solid #E9D5FF',
                            background: '#FAF5FF', fontSize: 11, fontWeight: 600, color: '#7C3AED', cursor: 'pointer' }}>
                          {showMoreProducts ? 'Show less' : `+ ${topProducts.length - 5} more`}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* At-Risk Doctors */}
            <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '0.5px solid #e5e7eb' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                At-Risk Doctors
                <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>CA below 60% or Bronze grade</span>
                <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: '#DC2626',
                  background: '#FEE2E2', padding: '3px 10px', borderRadius: 20 }}>{atRisk.length}</span>
              </div>
              {atRisk.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#aaa', padding: '24px 0', fontSize: 13 }}>No at-risk doctors this month</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                  {atRisk.map(d => (
                    <div key={d.doctor_id} onClick={() => {
                      setSelDoctor(d);
                      const mgr = allUsers.find(u => u.id === d.manager_id);
                      setSelUser(mgr || null);
                      if (d.state_code) setSelState(toStateName(d.state_code));
                      setView('product');
                    }}
                      style={{ background: '#FFF8F8', border: '1px solid #FCA5A5', borderLeft: '3px solid #DC2626',
                        borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px #DC262633'}
                      onMouseLeave={e => e.currentTarget.style.boxShadow = ''}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{d.doctor_name}</div>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                        {d.specialty}{d.city ? ` · ${d.city}` : ''}
                        {d.manager_name ? ` · Rep: ${d.manager_name}` : ''}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                        <CABar pct={d.ca_percent} />
                        <Pill label={d.roi_grade || 'Bronze'} bg={GRADE_BG[d.roi_grade]} color={GRADE_COLOR[d.roi_grade]} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* REGION VIEW */}
        {view === 'region' && selState && (() => {
          const regionData = {};
          displayDoctors.forEach(d => {
            const sName = toStateName(d.state_code);
            if (!regionData[sName]) regionData[sName] = { cities: {} };
            const city = (d.city || '').trim();
            if (city) regionData[sName].cities[city] = (regionData[sName].cities[city] || 0) + 1;
          });
          const rd = regionData[selState];
          if (!rd) return null;
          const { color, light } = stateStyle(selState);
          const allCities = Object.entries(rd.cities || {}).sort((a, b) => b[1] - a[1]);
          const visibleCities = showAllCities ? allCities : allCities.slice(0, 5);
          return (
            <div>
              {allCities.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Cities in {selState}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {visibleCities.map(([city, cnt]) => (
                      <button key={city}
                        onClick={() => setSelCity(selCity === normCity(city) ? null : normCity(city))}
                        style={{ padding: '4px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                          background: selCity === normCity(city) ? color : light,
                          color: selCity === normCity(city) ? '#fff' : color }}>
                        {city} ({cnt})
                      </button>
                    ))}
                    {allCities.length > 5 && (
                      <button onClick={() => setShowAllCities(s => !s)}
                        style={{ padding: '4px 10px', borderRadius: 20, border: '1px solid #ddd', background: '#f3f4f6', fontSize: 11, fontWeight: 600, color: '#666', cursor: 'pointer' }}>
                        {showAllCities ? 'Show less' : `+${allCities.length - 5} more`}
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Teams in {selState}</div>
              <TeamDrill stateName={selState} users={allUsers} docCounts={docCounts}
                onSelect={u => { setSelUser(u); setView('team'); }} />
            </div>
          );
        })()}

        {/* ALL TEAMS */}
        {view === 'all-teams' && (
          <div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
              {allUsers.filter(u => u.role !== 'admin').length} team members · click a card to see their clients
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {allUsers.filter(u => u.role !== 'admin').map(u => {
                const cnt      = docCounts[u.id] || 0;
                const repSales = allDoctors.filter(d => d.manager_id === u.id).reduce((a,d) => a + (d.actual_sales||0), 0);
                const sName    = toStateName((u.state||'').split(',')[0].trim());
                const { color, light } = stateStyle(sName);
                return (
                  <div key={u.id} onClick={() => { if (cnt > 0) { setSelUser(u); setView('team'); } }}
                    style={{ background: '#fff', borderRadius: 12, padding: '16px 18px',
                      border: '0.5px solid #e5e7eb', borderLeft: `4px solid ${color}`,
                      cursor: cnt > 0 ? 'pointer' : 'default' }}
                    onMouseEnter={e => { if (cnt > 0) e.currentTarget.style.boxShadow = `0 2px 12px ${color}33`; }}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = ''}
                  >
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                      <Avatar name={u.name} color={color} size={40} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: '#888' }}>{u.custom_role_name || u.role}{u.city ? ` · ${u.city}` : ''}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#3D8C40' }}>{fmtInr(repSales)}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                        background: cnt > 0 ? light : '#f5f5f5', color: cnt > 0 ? color : '#aaa' }}>
                        {cnt} clients
                      </div>
                    </div>
                    {u.reports_to_name && (
                      <div style={{ fontSize: 10, color: '#bbb', marginTop: 8, borderTop: '0.5px solid #f0f0f0', paddingTop: 6 }}>
                        Reports to: {u.reports_to_name}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ALL CLIENTS */}
        {view === 'all-clients' && (
          <div>
            <input value={clientSearch} onChange={e => { setClientSearch(e.target.value); setClientsVisible(8); }}
              placeholder="Search client, hospital, city, rep..."
              style={{ width: '100%', padding: '10px 16px', borderRadius: 12, border: '0.5px solid #ddd',
                fontSize: 13, marginBottom: 16, boxSizing: 'border-box' }}
            />
            {(() => {
              const filtered = allDoctors.filter(d =>
                !clientSearch ||
                (d.doctor_name||'').toLowerCase().includes(clientSearch.toLowerCase()) ||
                (d.hospital||'').toLowerCase().includes(clientSearch.toLowerCase()) ||
                (d.city||'').toLowerCase().includes(clientSearch.toLowerCase()) ||
                (d.manager_name||'').toLowerCase().includes(clientSearch.toLowerCase())
              );
              const visible   = filtered.slice(0, clientsVisible);
              const remaining = filtered.length - clientsVisible;
              return (
                <div>
                  <div style={{ fontSize: 12, color: '#aaa', marginBottom: 12 }}>
                    Showing {Math.min(clientsVisible, filtered.length)} of {filtered.length} clients
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                    {visible.map(d => {
                      const sStyle = stateStyle(toStateName(d.state_code));
                      return (
                        <div key={d.doctor_id} onClick={() => {
                          const mgr = allUsers.find(u => u.id === d.manager_id);
                          setSelUser(mgr || null); setSelDoctor(d); setView('product');
                        }}
                          style={{ background: '#fff', border: '0.5px solid #e5e7eb',
                            borderLeft: `3px solid ${sStyle.color}`, borderRadius: 10,
                            padding: '12px 14px', cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.boxShadow = `0 2px 8px ${sStyle.color}22`}
                          onMouseLeave={e => e.currentTarget.style.boxShadow = ''}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{d.doctor_name}</div>
                          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
                            {d.specialty}{d.city ? ` · ${d.city}` : ''}
                          </div>
                          {d.hospital && (
                            <div style={{ fontSize: 11, color: '#bbb', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {d.hospital}
                            </div>
                          )}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            borderTop: '0.5px solid #f0f0f0', paddingTop: 8 }}>
                            <div style={{ fontSize: 11, color: '#aaa' }}>{d.manager_name || ''}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#3D8C40' }}>{fmtInr(d.actual_sales)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {remaining > 0 && (
                    <button onClick={() => setClientsVisible(v => v + 8)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        width: '100%', marginTop: 10, padding: '9px 0',
                        background: 'linear-gradient(90deg,#f0fdf4,#eff6ff)',
                        border: '1px dashed #d1d5db', borderRadius: 10, cursor: 'pointer',
                        fontSize: 12, fontWeight: 600, color: '#374151' }}>
                      Show {Math.min(remaining, 8)} more <span style={{ fontWeight: 400, color: '#9ca3af' }}>· {remaining} remaining</span>
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* TEAM VIEW */}
        {view === 'team' && selUser && (
          <ClientList
            repUser={selUser}
            onSelect={d => { setSelDoctor({ doctor_id: d.id, doctor_name: d.name, ...d }); setView('client'); }}
          />
        )}

        {/* CLIENT / PRODUCT VIEW */}
        {(view === 'client' || view === 'product') && selDoctor && (
          <ProductView doctor={selDoctor} repUser={selUser} year={year} month={month} />
        )}

      </div>
    </div>
  );
}
