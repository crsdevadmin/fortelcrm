import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { roiAPI } from '../api';

const API = 'http://localhost:8000';
const NOW   = new Date();
const YEAR  = NOW.getFullYear();
const MONTH = NOW.getMonth() + 1;
const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Colours by role ───────────────────────────────
const ROLE_PALETTE = {
  admin:          { color: '#7c3aed', label: 'Admin' },
  md:             { color: '#1d4ed8', label: 'MD' },
  director:       { color: '#0891b2', label: 'Director' },
  senior_manager: { color: '#065f46', label: 'Sr. Manager' },
  manager:        { color: '#166534', label: 'Manager' },
  rep:            { color: '#92400e', label: 'Sales Rep' },
  custom:         { color: '#6b7280', label: 'Executive' },
};
function rp(role) { return ROLE_PALETTE[role] || ROLE_PALETTE.custom; }

const INV_CAT_COLORS = { PD: '#1D9E75', RD: '#534AB7', CS: '#BA7517' };
const INV_CAT_LABELS = { PD: 'Professional Dev', RD: 'Relationship Dev', CS: 'Commercial Support' };

function fmtInr(v) {
  if (!v) return '₹0';
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000)   return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
}
function initials(name) {
  return (name || '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function Avatar({ name, color = '#888', size = 38 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color + '20', border: `1.5px solid ${color}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.32, fontWeight: 700, color, flexShrink: 0,
    }}>{initials(name)}</div>
  );
}

function Breadcrumb({ crumbs, onGo }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: '#ccc' }}>›</span>}
          <button onClick={() => onGo(i)} style={{
            background: 'none', border: 'none', padding: '2px 4px',
            fontSize: 13, fontWeight: i === crumbs.length - 1 ? 700 : 400,
            color: i < crumbs.length - 1 ? '#1D9E75' : 'var(--color-text-primary,#111)',
            cursor: i < crumbs.length - 1 ? 'pointer' : 'default',
            textDecoration: i < crumbs.length - 1 ? 'underline' : 'none',
          }}>{c}</button>
        </React.Fragment>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════
// TREE NODE — recursive
// ══════════════════════════════════════════════════
function TreeNode({ user, allUsers, docCounts, meId, depth, onDoctorCountClick }) {
  const [open, setOpen] = useState(depth < 2);
  const subordinates = allUsers.filter(u => u.reports_to_id === user.id);
  const hasChildren  = subordinates.length > 0;
  const isMe         = user.id === meId;
  const { color, label } = rp(user.role);
  const doctorCount  = docCounts[user.id] ?? 0;
  const displayRole  = user.custom_role_name || label;

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 20 }}>
      {/* Node card */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderRadius: 10, marginBottom: 6,
        background: isMe ? color + '10' : 'var(--color-background-primary,#fff)',
        border: isMe ? `2px solid ${color}` : `0.5px solid #e5e7eb`,
        borderLeft: `3px solid ${color}`,
        boxShadow: isMe ? `0 0 0 3px ${color}18` : 'none',
      }}>
        {/* Expand toggle */}
        {hasChildren ? (
          <button onClick={() => setOpen(o => !o)} style={{
            background: 'none', border: `1px solid ${color}55`, borderRadius: 4,
            width: 20, height: 20, cursor: 'pointer', fontSize: 10, color,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            padding: 0,
          }}>{open ? '▾' : '▸'}</button>
        ) : (
          <div style={{ width: 20, flexShrink: 0 }} />
        )}

        <Avatar name={user.name} color={color} size={36} />

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{user.name}</span>
            {isMe && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: color, color: '#fff' }}>YOU</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
            {displayRole}{user.city ? ` · ${user.city}` : ''}
            {user.phone ? ` · ${user.phone}` : ''}
          </div>
        </div>

        {/* Subordinate count pill */}
        {hasChildren && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
            background: color + '18', color, flexShrink: 0,
          }}>
            {subordinates.length} report{subordinates.length !== 1 ? 's' : ''}
          </span>
        )}

        {/* Doctor count — CLICKABLE */}
        <button
          onClick={() => onDoctorCountClick(user)}
          title={`View ${doctorCount} clients of ${user.name}`}
          style={{
            fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20,
            background: doctorCount > 0 ? '#E1F5EE' : '#f5f5f5',
            color: doctorCount > 0 ? '#085041' : '#aaa',
            border: doctorCount > 0 ? '0.5px solid #1D9E75' : '0.5px solid #ddd',
            cursor: doctorCount > 0 ? 'pointer' : 'default',
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          🏥 {doctorCount} clients
        </button>
      </div>

      {/* Children */}
      {open && hasChildren && (
        <div style={{
          borderLeft: `2px solid ${color}33`,
          marginLeft: 28, paddingLeft: 8, marginBottom: 4,
        }}>
          {subordinates.map(child => (
            <TreeNode
              key={child.id}
              user={child}
              allUsers={allUsers}
              docCounts={docCounts}
              meId={meId}
              depth={depth + 1}
              onDoctorCountClick={onDoctorCountClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════
// CLIENT LIST (Level 2)
// ══════════════════════════════════════════════════
function ClientList({ user: repUser, doctors, onDoctorClick }) {
  const [search, setSearch] = useState('');
  const { color } = rp(repUser.role);

  const filtered = doctors.filter(d =>
    !search ||
    (d.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (d.hospital || '').toLowerCase().includes(search.toLowerCase()) ||
    (d.city || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Avatar name={repUser.name} color={color} size={44} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{repUser.name}</div>
          <div style={{ fontSize: 12, color: '#888' }}>{repUser.custom_role_name || repUser.role} · {doctors.length} clients</div>
        </div>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="🔍 Search client, hospital, city..."
        style={{
          width: '100%', padding: '9px 14px', borderRadius: 10,
          border: '0.5px solid #ddd', fontSize: 13, marginBottom: 14, boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {filtered.map(d => (
          <div key={d.id} onClick={() => onDoctorClick(d)}
            style={{
              background: 'var(--color-background-primary,#fff)',
              border: `0.5px solid #e0e0e0`, borderLeft: `3px solid ${color}`,
              borderRadius: 10, padding: '13px 14px', cursor: 'pointer',
              transition: 'box-shadow 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = `0 2px 10px ${color}22`}
            onMouseLeave={e => e.currentTarget.style.boxShadow = ''}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
              {d.specialty || 'Doctor'}{d.city ? ` · ${d.city}` : ''}
            </div>
            {d.hospital && (
              <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                🏥 {d.hospital}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              borderTop: '0.5px solid #f0f0f0', paddingTop: 8, marginTop: 4 }}>
              <span style={{ fontSize: 10, color: '#aaa' }}>{d.client_code || d.category || ''}</span>
              {d.commercial_model && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                  background: '#EEEDFE', color: '#26215C' }}>{d.commercial_model}</span>
              )}
              <span style={{ fontSize: 11, color, fontWeight: 600 }}>View →</span>
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

// ══════════════════════════════════════════════════
// PRODUCT VIEW (Level 3)
// ══════════════════════════════════════════════════
function ProductView({ doctor, repUser }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setData(null); setLoading(true);
    roiAPI.doctorFull(doctor.id, YEAR, MONTH)
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [doctor.id]);

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#aaa' }}>Loading...</div>;

  const trendMax = Math.max(...(data?.monthly_trend || []).map(t => t.sales), 1);
  const caColors = { green: '#0F6E56', yellow: '#BA7517', red: '#D85A30' };
  const caColor  = caColors[data?.ca_status || 'red'];

  return (
    <div>
      {/* Doctor header */}
      <div style={{
        background: 'var(--color-background-secondary,#f5f5f5)',
        borderRadius: 12, padding: '16px 20px', marginBottom: 20,
        display: 'flex', gap: 14, alignItems: 'center',
      }}>
        <Avatar name={doctor.name} color="#1D9E75" size={48} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{doctor.name}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>
            {doctor.specialty}{doctor.hospital ? ` · ${doctor.hospital}` : ''}
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
            {doctor.city}{doctor.client_code ? ` · ${doctor.client_code}` : ''}
          </div>
        </div>
        {repUser && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: '#aaa' }}>Rep</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{repUser.name}</div>
          </div>
        )}
      </div>

      {/* ROI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Total invested', val: fmtInr(data?.total_invested), color: undefined },
          { label: `Business (${MONTHS[MONTH]})`, val: fmtInr(data?.actual_sales), color: '#0F6E56' },
          { label: 'ROI', val: `${data?.roi_multiple || 0}×`, color: undefined },
          { label: 'Achievement', val: `${data?.ca_percent || 0}%`, color: caColor },
        ].map((s, i) => (
          <div key={i} style={{
            background: 'var(--color-background-primary,#fff)',
            border: '0.5px solid #eee', borderRadius: 10, padding: '12px 14px',
          }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: s.color || 'var(--color-text-primary,#111)' }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Products */}
        <div style={{ background: 'var(--color-background-primary,#fff)', border: '0.5px solid #eee', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
            Product-wise · {MONTHS[MONTH]} {YEAR}
          </div>
          {data?.products_sales?.length > 0 ? data.products_sales.map((p, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', borderRadius: 8, marginBottom: 6,
              background: 'var(--color-background-secondary,#f7f7f5)',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.product_name}</div>
                <div style={{ fontSize: 11, color: '#888' }}>Qty: {p.total_qty}</div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F6E56' }}>{fmtInr(p.total_sales)}</div>
            </div>
          )) : (
            <div style={{ textAlign: 'center', color: '#aaa', padding: '24px 0', fontSize: 13 }}>
              No sales this month
            </div>
          )}
        </div>

        {/* Investments */}
        <div style={{ background: 'var(--color-background-primary,#fff)', border: '0.5px solid #eee', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Investment breakdown</div>
          {Object.keys(data?.investment_by_category || {}).length > 0
            ? Object.entries(data.investment_by_category).map(([cat, catData]) => (
              <div key={cat} style={{ marginBottom: 10 }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', padding: '6px 10px',
                  borderRadius: '6px 6px 0 0',
                  background: INV_CAT_COLORS[cat] + '18',
                  borderLeft: `3px solid ${INV_CAT_COLORS[cat]}`,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: INV_CAT_COLORS[cat] }}>
                    {cat} – {INV_CAT_LABELS[cat]}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: INV_CAT_COLORS[cat] }}>
                    {fmtInr(catData.total)}
                  </span>
                </div>
                {catData.items.map((item, j) => (
                  <div key={j} style={{
                    display: 'flex', justifyContent: 'space-between', fontSize: 12,
                    padding: '5px 10px', background: '#fafafa', borderBottom: '0.5px solid #f0f0f0',
                  }}>
                    <span style={{ color: '#555' }}>{item.sub_category}</span>
                    <span style={{ fontWeight: 600 }}>{fmtInr(item.amount)}</span>
                  </div>
                ))}
              </div>
            ))
          : (
            <div style={{ textAlign: 'center', color: '#aaa', padding: '24px 0', fontSize: 13 }}>
              No investments recorded
            </div>
          )}
        </div>
      </div>

      {/* Monthly trend */}
      {data?.monthly_trend?.length > 0 && (
        <div style={{ background: 'var(--color-background-primary,#fff)', border: '0.5px solid #eee', borderRadius: 12, padding: '16px 18px', marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Monthly business trend</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 80 }}>
            {data.monthly_trend.map((t, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ fontSize: 10, color: '#888' }}>{fmtInr(t.sales)}</div>
                <div style={{
                  width: '100%', borderRadius: '4px 4px 0 0',
                  height: `${Math.max((t.sales / trendMax) * 56, 2)}px`,
                  background: t.month === MONTH && t.year === YEAR ? '#1D9E75' : '#9FE1CB',
                }} />
                <div style={{ fontSize: 10, color: '#888' }}>{t.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════
export default function MyTeam() {
  const { user: me } = useAuth();
  const [allUsers,   setAllUsers]   = useState([]);
  const [docCounts,  setDocCounts]  = useState({});   // { userId: count }
  const [loading,    setLoading]    = useState(true);

  // Drill state
  const [view,       setView]       = useState('tree');   // tree | clients | products
  const [selUser,    setSelUser]    = useState(null);
  const [clients,    setClients]    = useState([]);
  const [clientLoad, setClientLoad] = useState(false);
  const [selDoctor,  setSelDoctor]  = useState(null);

  // ── Load users + doctor counts ─────────────────
  useEffect(() => {
    if (!me?.id) return;
    axios.get(`${API}/users/`, { params: { viewer_id: me.id } }).then(async r => {
      const users = r.data || [];
      setAllUsers(users);

      // Load all doctors once, count per manager_id
      const doctorRes = await axios.get(`${API}/doctors/`, {
        params: { include_inactive: false, viewer_id: me.id },
      }).catch(() => ({ data: [] }));

      const counts = {};
      (doctorRes.data || []).forEach(d => {
        if (d.manager_id) counts[d.manager_id] = (counts[d.manager_id] || 0) + 1;
      });
      setDocCounts(counts);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [me?.id]);

  // ── Find tree root ─────────────────────────────
  // Root = user with no manager, or top of current user's chain
  const roots = allUsers.filter(u => !u.reports_to_id);

  // ── Click doctor count badge → client list ─────
  const handleDoctorCountClick = useCallback((user) => {
    if ((docCounts[user.id] || 0) === 0) return;
    setSelUser(user);
    setView('clients');
    setClientLoad(true);
    setClients([]);
    axios.get(`${API}/doctors/`, { params: { manager_id: user.id, include_inactive: false } })
      .then(r => { setClients(r.data || []); setClientLoad(false); })
      .catch(() => setClientLoad(false));
  }, [docCounts]);

  // ── Click doctor → products ────────────────────
  const handleDoctorClick = useCallback((doctor) => {
    setSelDoctor(doctor);
    setView('products');
  }, []);

  // ── Breadcrumb nav ─────────────────────────────
  const crumbs = {
    tree:     ['Hierarchy'],
    clients:  ['Hierarchy', `${selUser?.name || ''} (${clients.length} clients)`],
    products: ['Hierarchy', `${selUser?.name || ''}`, selDoctor?.name || ''],
  };

  const handleBreadcrumb = (idx) => {
    if (idx === 0) { setView('tree'); setSelUser(null); setSelDoctor(null); }
    if (idx === 1) { setView('clients'); setSelDoctor(null); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-tertiary,#f7f7f5)' }}>
      {/* Header */}
      <div style={{
        background: 'var(--color-background-primary,#fff)',
        borderBottom: '0.5px solid #eee', padding: '16px 24px',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>My Hierarchy</div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
          Reporting tree → click <span style={{ color: '#0F6E56', fontWeight: 600 }}>🏥 clients</span> on any person to drill in
        </div>
      </div>

      <div style={{ padding: '20px 24px' }}>

        {/* Breadcrumb */}
        {view !== 'tree' && (
          <Breadcrumb crumbs={crumbs[view]} onGo={handleBreadcrumb} />
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>Loading hierarchy...</div>
        ) : view === 'tree' ? (
          <div style={{
            background: 'var(--color-background-primary,#fff)',
            border: '0.5px solid #eee', borderRadius: 14, padding: 20,
          }}>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 16 }}>
              Click <strong>▸</strong> to expand · Click <strong style={{ color: '#0F6E56' }}>🏥 X clients</strong> to view their mapped clients
            </div>
            {roots.length > 0 ? roots.map(root => (
              <TreeNode
                key={root.id}
                user={root}
                allUsers={allUsers}
                docCounts={docCounts}
                meId={me?.id}
                depth={0}
                onDoctorCountClick={handleDoctorCountClick}
              />
            )) : (
              <div style={{ color: '#aaa', textAlign: 'center', padding: 40 }}>No hierarchy data found</div>
            )}
          </div>

        ) : view === 'clients' ? (
          <div style={{
            background: 'var(--color-background-primary,#fff)',
            border: '0.5px solid #eee', borderRadius: 14, padding: 20,
          }}>
            {clientLoad ? (
              <div style={{ textAlign: 'center', padding: 48, color: '#aaa' }}>Loading clients...</div>
            ) : (
              <ClientList
                user={selUser}
                doctors={clients}
                onDoctorClick={handleDoctorClick}
              />
            )}
          </div>

        ) : view === 'products' && selDoctor ? (
          <ProductView doctor={selDoctor} repUser={selUser} />
        ) : null}

      </div>
    </div>
  );
}
