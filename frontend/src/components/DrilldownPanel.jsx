import React, { useState, useEffect, useMemo } from 'react';
import { roiAPI } from '../api';

// ── Fortel brand tokens (from styles.css) ──────────────────────
const C = {
  page: '#F5F4F0', surface: '#FFFFFF', surface2: '#FAFAF8',
  border: '#E8E6DF', border2: '#D4D0C4',
  text1: '#1A1A1A', text2: '#5C5A52', text3: '#9E9B8E',
  gold: '#F5B800', goldDark: '#A07A00',
  green: '#3D8C40', greenDark: '#2A6B2D', greenBg: '#EAF5EA', greenBorder: '#A8D5AA',
  amber: '#E08C00', amberBg: '#FFF8D6', amberBorder: '#F5D060',
  red: '#D93025', redBg: '#FFF0EF', redBorder: '#F4A9A5',
};

// Product colours for charts/legends (stable order)
const PRODUCT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#d55181', '#4a3aa7', '#008300', '#B4B2A9'];

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function inr(v) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (Math.abs(n) >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

// ── Status pill ────────────────────────────────────────────────
function StatusPill({ status }) {
  const s = (status || '').toLowerCase();
  let bg = C.surface2, bd = C.border, fg = C.text2;
  if (s.includes('breach')) { bg = C.redBg; bd = C.redBorder; fg = C.red; }
  else if (s.includes('risk')) { bg = C.amberBg; bd = C.amberBorder; fg = C.amber; }
  else if (s.includes('track') || s.includes('achiev')) { bg = C.greenBg; bd = C.greenBorder; fg = C.greenDark; }
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: bg, border: `1px solid ${bd}`, color: fg, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

// ── Zero-dependency stacked bar chart (weekly × product) ───────
function StackedWeeklyChart({ weeks, series }) {
  const W = 460, H = 150, padL = 34, padB = 20, padT = 8;
  const plotW = W - padL - 8, plotH = H - padB - padT;
  const totals = weeks.map((_, wi) => series.reduce((s, ser) => s + (ser.data[wi] || 0), 0));
  const max = Math.max(1, ...totals);
  const bw = Math.min(42, (plotW / weeks.length) * 0.6);
  const step = plotW / weeks.length;
  const ticks = [0, max / 2, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Weekly regional sales by product" style={{ maxHeight: 170 }}>
      {ticks.map((t, i) => {
        const y = padT + plotH - (t / max) * plotH;
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - 8} y2={y} stroke={C.border} strokeWidth="1" />
            <text x={padL - 5} y={y + 3} textAnchor="end" fontSize="9" fill={C.text3}>{inr(t)}</text>
          </g>
        );
      })}
      {weeks.map((wk, wi) => {
        const x = padL + step * wi + (step - bw) / 2;
        let yBase = padT + plotH;
        return (
          <g key={wi}>
            {series.map((ser, si) => {
              const val = ser.data[wi] || 0;
              const h = (val / max) * plotH;
              yBase -= h;
              return <rect key={si} x={x} y={yBase} width={bw} height={h} fill={ser.color} />;
            })}
            <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill={C.text3}>{wk}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Zero-dependency simple bar chart (monthly sales trend) ─────
function MonthlyTrendChart({ points }) {
  const W = 440, H = 140, padL = 34, padB = 20, padT = 8;
  const plotW = W - padL - 8, plotH = H - padB - padT;
  const max = Math.max(1, ...points.map(p => p.value));
  const bw = Math.min(30, (plotW / Math.max(points.length, 1)) * 0.55);
  const step = plotW / Math.max(points.length, 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly sales trend" style={{ maxHeight: 150 }}>
      {[0, max / 2, max].map((t, i) => {
        const y = padT + plotH - (t / max) * plotH;
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - 8} y2={y} stroke={C.border} strokeWidth="1" />
            <text x={padL - 5} y={y + 3} textAnchor="end" fontSize="9" fill={C.text3}>{inr(t)}</text>
          </g>
        );
      })}
      {points.map((p, i) => {
        const x = padL + step * i + (step - bw) / 2;
        const h = (p.value / max) * plotH;
        const y = padT + plotH - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={h} fill={C.green} rx="2" />
            <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill={C.text3}>{p.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Doctor expansion: fetch full detail on demand ──────────────
function DoctorDetail({ doctorId, viewerId, year, month, asOf, accent, onOpen360 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    roiAPI.doctorFull(doctorId, year, month, viewerId, asOf)
      .then(res => { if (alive) setData(res.data); })
      .catch(() => { if (alive) setError('Could not load doctor detail.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [doctorId, viewerId, year, month, asOf]);

  if (loading) return <div style={{ padding: 14, fontSize: 12, color: C.text3 }}>Loading detail…</div>;
  if (error) return <div style={{ padding: 14, fontSize: 12, color: C.red }}>{error}</div>;
  if (!data) return null;

  const trend = (data.monthly_trend || []).map(t => ({ label: t.label, value: t.sales }));
  const products = data.products_sales || [];
  const commitments = (data.recovery && data.recovery.commitments) || [];

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.getDate()} ${MONTH_NAMES[d.getMonth() + 1]} ${String(d.getFullYear()).slice(2)}`;
  };

  return (
    <div style={{ padding: '12px 12px 14px', background: C.surface2 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, marginBottom: 10 }}>
        <span style={{ color: C.text2 }}>Total invested <strong style={{ color: C.text1 }}>{inr(data.total_invested)}</strong></span>
        <span style={{ color: C.text2 }}>Sales · {MONTH_NAMES[month]} <strong style={{ color: C.text1 }}>{inr(data.actual_sales)}</strong></span>
        <span style={{ color: C.text2 }}>ROI <strong style={{ color: C.text1 }}>{data.roi_multiple ? `${data.roi_multiple}×` : '—'}</strong> · {data.roi_grade || '—'}</span>
      </div>

      {/* Per-investment recovery — each investment's own 6-month window */}
      {commitments.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: C.text2, marginBottom: 6 }}>Investment recovery · each investment tracks its own 6 months of sales</div>
          {commitments.map((c) => {
            const pct = Math.min(100, Math.round(Number(c.achievement_pct) || 0));
            const barColor = c.status === 'Breached' ? C.red : c.status === 'At Risk' ? C.amber : C.green;
            return (
              <div key={c.investment_id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 11px', marginBottom: 6, background: C.surface }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: C.text1, fontWeight: 500 }}>
                    {inr(c.amount)} invested · {fmtDate(c.investment_date)}
                  </span>
                  <StatusPill status={c.status} />
                </div>
                <div style={{ fontSize: 12, color: C.text2, margin: '3px 0 6px' }}>
                  Window {fmtDate(c.investment_date)} → {fmtDate(c.deadline)}
                  {typeof c.days_left === 'number' && c.days_left >= 0 ? ` · ${c.days_left} days left` : ' · closed'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: C.border, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: barColor }} />
                  </div>
                  <span style={{ fontSize: 12, color: C.text2, whiteSpace: 'nowrap' }}>
                    {inr(c.sales_captured)} / {inr(c.expected_sales)} ({pct}%)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {trend.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: C.text2, marginBottom: 2 }}>Monthly doctor sales · last {trend.length} months</div>
          <MonthlyTrendChart points={trend} />
        </div>
      )}

      {products.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: C.text2, marginBottom: 4 }}>Product-wise sales · {MONTH_NAMES[month]}</div>
          {products.map(p => (
            <div key={p.product_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ color: C.text1 }}>{p.product_name}</span>
              <span style={{ color: C.text2 }}>{Math.round(p.total_qty)} units · <strong style={{ color: C.text1 }}>{inr(p.total_sales)}</strong></span>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => onOpen360 && onOpen360()} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: accent, color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
        Open Doctor 360 →
      </button>
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────
const th = { textAlign: 'left', padding: '7px 6px', color: C.text3, fontWeight: 500, fontSize: 12, borderBottom: `1px solid ${C.border2}` };
const thR = { ...th, textAlign: 'right' };
const td = { padding: '8px 6px', color: C.text1, fontSize: 13, borderBottom: `1px solid ${C.border}` };
const tdR = { ...td, textAlign: 'right' };

function Crumbs({ path, onGo, rootLabel }) {
  const items = [rootLabel, ...path.map(p => p.label)];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexWrap: 'wrap' }}>
      {items.map((label, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: C.text3 }}>›</span>}
          {i < items.length - 1 ? (
            <button onClick={() => onGo(i)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: C.goldDark, fontWeight: 500, fontSize: 13 }}>{label}</button>
          ) : (
            <span style={{ color: C.text1, fontWeight: 500 }}>{label}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main panel
// ═══════════════════════════════════════════════════════════════
export default function DrilldownPanel({
  type, accent = '#2563eb', title, period, value, status,
  me, year, month, asOf,
  regionalRows = [], recoveryRows = [], doctorRows = [], scorecardRows = [],
  toStateName = (s) => s,
  onClose, onOpenDoctor, onOpenFull,
}) {
  const [path, setPath] = useState([]);      // drill path, e.g. [{key:'TG',label:'Telangana'}]
  const [openRow, setOpenRow] = useState(null); // expanded doctor id

  // Reset drill state when the card type changes
  useEffect(() => { setPath([]); setOpenRow(null); }, [type]);

  const goCrumb = (i) => { setPath(p => p.slice(0, i)); setOpenRow(null); };
  const descend = (crumb) => { setPath(p => [...p, crumb]); setOpenRow(null); };

  const accentColor = accent || '#2563eb';

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: '0 2px 10px rgba(26,26,26,0.06)', overflow: 'hidden', marginBottom: 18 }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: accentColor }}>{title}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 3 }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: C.text1 }}>{value}</span>
            {status && <StatusPill status={status} />}
          </div>
          {period && <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>{period}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {onOpenFull && (
            <button onClick={onOpenFull} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: C.gold, color: C.text1, border: 'none', cursor: 'pointer', fontWeight: 600 }}>Open full page →</button>
          )}
          <button onClick={onClose} aria-label="Close" style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: C.surface, color: C.text2, border: `1px solid ${C.border2}`, cursor: 'pointer' }}>Close</button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div style={{ padding: '10px 18px', borderBottom: `1px solid ${C.border}`, background: C.surface2 }}>
        <Crumbs path={path} onGo={goCrumb} rootLabel={title} />
      </div>

      {/* Body per type */}
      <div style={{ padding: '14px 18px' }}>
        {type === 'regional' && <RegionalBody rows={regionalRows} path={path} descend={descend} toStateName={toStateName} month={month} />}
        {type === 'doctor' && <DoctorSalesBody rows={doctorRows} path={path} descend={descend} openRow={openRow} setOpenRow={setOpenRow} me={me} year={year} month={month} asOf={asOf} accent={accentColor} onOpenDoctor={onOpenDoctor} />}
        {type === 'investment' && <RecoveryBody rows={recoveryRows} openRow={openRow} setOpenRow={setOpenRow} me={me} year={year} month={month} asOf={asOf} accent={accentColor} onOpenDoctor={onOpenDoctor} />}
        {type === 'execution' && <ExecutionBody rows={scorecardRows} openRow={openRow} setOpenRow={setOpenRow} />}
      </div>
    </div>
  );
}

// ── REGIONAL: State → City → Product×Week ──────────────────────
function RegionalBody({ rows, path, descend, toStateName, month }) {
  const level = path.length;

  // Level 0 — states
  const states = useMemo(() => {
    const m = {};
    rows.forEach(r => {
      const code = r.state_code || '—';
      if (!m[code]) m[code] = { code, value: 0, cities: new Set() };
      m[code].value += Number(r.value || 0);
      if (r.city) m[code].cities.add(r.city);
    });
    return Object.values(m).sort((a, b) => b.value - a.value);
  }, [rows]);

  // Level 1 — cities in selected state
  const cities = useMemo(() => {
    if (level < 1) return [];
    const code = path[0].key;
    const m = {};
    rows.filter(r => (r.state_code || '—') === code).forEach(r => {
      const city = r.city || '—';
      if (!m[city]) m[city] = { city, value: 0, products: new Set() };
      m[city].value += Number(r.value || 0);
      m[city].products.add(r.product_id);
    });
    return Object.values(m).sort((a, b) => b.value - a.value);
  }, [rows, path, level]);

  // Level 2 — product×week pivot for selected city
  const pivot = useMemo(() => {
    if (level < 2) return null;
    const code = path[0].key, city = path[1].key;
    const prods = {};
    const subset = rows.filter(r => (r.state_code || '—') === code && (r.city || '—') === city);
    subset.forEach(r => {
      const pid = r.product_id;
      if (!prods[pid]) prods[pid] = { product_id: pid, name: r.product_name, qty: 0, weeks: [0, 0, 0, 0], total: 0 };
      const wi = Math.min(Math.max((r.week || 1) - 1, 0), 3);
      prods[pid].weeks[wi] += Number(r.value || 0);
      prods[pid].qty += Number(r.quantity || 0);
      prods[pid].total += Number(r.value || 0);
    });
    const list = Object.values(prods).sort((a, b) => b.total - a.total);
    const weekTotals = [0, 1, 2, 3].map(wi => list.reduce((s, p) => s + p.weeks[wi], 0));
    const series = list.slice(0, 8).map((p, i) => ({ name: p.name, color: PRODUCT_COLORS[i % PRODUCT_COLORS.length], data: p.weeks }));
    return { list, weekTotals, series, grand: list.reduce((s, p) => s + p.total, 0), qty: list.reduce((s, p) => s + p.qty, 0) };
  }, [rows, path, level]);

  if (rows.length === 0) return <Empty text="No regional (stockist) sales recorded for this selection." />;

  if (level === 0) {
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>State</th><th style={thR}>Cities</th><th style={thR}>Value</th><th style={{ width: 24 }} /></tr></thead>
        <tbody>
          {states.map(s => (
            <tr key={s.code} onClick={() => descend({ key: s.code, label: toStateName(s.code) || s.code })} style={{ cursor: 'pointer' }}>
              <td style={{ ...td, fontWeight: 500 }}>{toStateName(s.code) || s.code}</td>
              <td style={tdR}>{s.cities.size}</td>
              <td style={{ ...tdR, fontWeight: 500 }}>{inr(s.value)}</td>
              <td style={{ ...td, color: C.text3 }}>›</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (level === 1) {
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>City / territory</th><th style={thR}>Products</th><th style={thR}>Value</th><th style={{ width: 24 }} /></tr></thead>
        <tbody>
          {cities.map(c => (
            <tr key={c.city} onClick={() => descend({ key: c.city, label: c.city })} style={{ cursor: 'pointer' }}>
              <td style={{ ...td, fontWeight: 500 }}>{c.city}</td>
              <td style={tdR}>{c.products.size}</td>
              <td style={{ ...tdR, fontWeight: 500 }}>{inr(c.value)}</td>
              <td style={{ ...td, color: C.text3 }}>›</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Level 2 — pivot + stacked chart
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.text1 }}>Weekly value by product</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: C.text2 }}>
          {pivot.series.map(s => (
            <span key={s.name}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: s.color, marginRight: 4 }} />{s.name}</span>
          ))}
        </div>
      </div>
      <StackedWeeklyChart weeks={['W1', 'W2', 'W3', 'W4']} series={pivot.series} />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: '28%' }}>Product</th>
            <th style={thR}>Qty</th>
            <th style={thR}>W1</th><th style={thR}>W2</th><th style={thR}>W3</th><th style={thR}>W4</th>
            <th style={thR}>MTD</th>
          </tr>
        </thead>
        <tbody>
          {pivot.list.map((p, i) => (
            <tr key={p.product_id}>
              <td style={{ ...td, fontWeight: 500 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: PRODUCT_COLORS[i % PRODUCT_COLORS.length], marginRight: 6 }} />{p.name}
              </td>
              <td style={tdR}>{Math.round(p.qty)}</td>
              {p.weeks.map((w, wi) => <td key={wi} style={{ ...tdR, color: w ? C.text1 : C.text3 }}>{w ? inr(w) : '—'}</td>)}
              <td style={{ ...tdR, fontWeight: 500 }}>{inr(p.total)}</td>
            </tr>
          ))}
          <tr style={{ background: C.surface2 }}>
            <td style={{ ...td, fontWeight: 600 }}>Total</td>
            <td style={{ ...tdR, fontWeight: 600 }}>{Math.round(pivot.qty)}</td>
            {pivot.weekTotals.map((w, wi) => <td key={wi} style={{ ...tdR, fontWeight: 600 }}>{w ? inr(w) : '—'}</td>)}
            <td style={{ ...tdR, fontWeight: 600 }}>{inr(pivot.grand)}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: C.text3, marginTop: 8 }}>Qty × rate = value, as entered by the rep · stockist (regional) sales — no doctor mapping</div>
    </div>
  );
}

// ── DOCTOR SALES: Rep → Doctor → detail ────────────────────────
function DoctorSalesBody({ rows, path, descend, openRow, setOpenRow, me, year, month, asOf, accent, onOpenDoctor }) {
  const level = path.length;

  const reps = useMemo(() => {
    const m = {};
    rows.forEach(d => {
      const id = d.manager_id || 0;
      const name = d.manager_name || 'Unassigned';
      if (!m[id]) m[id] = { id, name, value: 0, doctors: 0 };
      m[id].value += Number(d.actual_sales || 0);
      m[id].doctors += 1;
    });
    return Object.values(m).sort((a, b) => b.value - a.value);
  }, [rows]);

  const repDoctors = useMemo(() => {
    if (level < 1) return [];
    const id = path[0].key;
    return rows.filter(d => (d.manager_id || 0) === id)
      .sort((a, b) => Number(b.actual_sales || 0) - Number(a.actual_sales || 0));
  }, [rows, path, level]);

  if (rows.length === 0) return <Empty text="No doctors in this selection." />;

  if (level === 0) {
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Rep</th><th style={thR}>Doctors</th><th style={thR}>Sales</th><th style={{ width: 24 }} /></tr></thead>
        <tbody>
          {reps.map(r => (
            <tr key={r.id} onClick={() => descend({ key: r.id, label: r.name })} style={{ cursor: 'pointer' }}>
              <td style={{ ...td, fontWeight: 500 }}>{r.name}</td>
              <td style={tdR}>{r.doctors}</td>
              <td style={{ ...tdR, fontWeight: 500 }}>{inr(r.value)}</td>
              <td style={{ ...td, color: C.text3 }}>›</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Level 1 — doctors under rep, expandable
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr><th style={th}>Doctor</th><th style={th}>City</th><th style={thR}>Sales</th><th style={{ width: 24 }} /></tr></thead>
      <tbody>
        {repDoctors.map(d => {
          const did = d.doctor_id || d.id;
          const isOpen = openRow === did;
          return (
            <React.Fragment key={did}>
              <tr onClick={() => setOpenRow(isOpen ? null : did)} style={{ cursor: 'pointer', background: isOpen ? C.surface2 : 'transparent' }}>
                <td style={{ ...td, fontWeight: 500, borderLeft: isOpen ? `3px solid ${C.gold}` : '3px solid transparent' }}>{d.doctor_name}</td>
                <td style={{ ...td, color: C.text2 }}>{d.city || '—'}</td>
                <td style={{ ...tdR, fontWeight: 500 }}>{inr(d.actual_sales)}</td>
                <td style={{ ...td, color: C.text3 }}>{isOpen ? '⌄' : '›'}</td>
              </tr>
              {isOpen && (
                <tr><td colSpan={4} style={{ padding: 0, borderBottom: `1px solid ${C.border}` }}>
                  <DoctorDetail doctorId={did} viewerId={me?.id} year={year} month={month} asOf={asOf} accent={accent} onOpen360={() => onOpenDoctor && onOpenDoctor(d)} />
                </td></tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// ── INVESTMENT RECOVERY: flat gap-sorted doctor table ──────────
function RecoveryBody({ rows, openRow, setOpenRow, me, year, month, asOf, accent, onOpenDoctor }) {
  const sorted = useMemo(() =>
    [...rows].sort((a, b) => Number(b.shortfall || 0) - Number(a.shortfall || 0)),
  [rows]);

  if (rows.length === 0) return <Empty text="No active six-month investment commitments in this selection." />;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <thead>
        <tr>
          <th style={{ ...th, width: '26%' }}>Doctor</th>
          <th style={thR}>Invested</th><th style={thR}>Expected</th><th style={thR}>Recovered</th><th style={thR}>Gap</th>
          <th style={{ ...th, width: '15%' }}>Status</th><th style={{ width: 24 }} />
        </tr>
      </thead>
      <tbody>
        {sorted.map(r => {
          const did = r.doctor_id;
          const isOpen = openRow === did;
          const gap = Number(r.shortfall || 0);
          return (
            <React.Fragment key={did}>
              <tr onClick={() => setOpenRow(isOpen ? null : did)} style={{ cursor: 'pointer', background: isOpen ? C.surface2 : 'transparent' }}>
                <td style={{ ...td, fontWeight: 500, borderLeft: isOpen ? `3px solid ${C.gold}` : '3px solid transparent', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.doctor_name}</td>
                <td style={tdR}>{inr(r.total_invested)}</td>
                <td style={{ ...tdR, color: C.text2 }}>{inr(r.expected_sales)}</td>
                <td style={tdR}>{inr(r.sales_captured)}</td>
                <td style={{ ...tdR, color: gap > 0 ? C.red : C.greenDark, fontWeight: 500 }}>{gap > 0 ? `−${inr(gap)}` : inr(0)}</td>
                <td style={td}><StatusPill status={r.worst_status} /></td>
                <td style={{ ...td, color: C.text3 }}>{isOpen ? '⌄' : '›'}</td>
              </tr>
              {isOpen && (
                <tr><td colSpan={7} style={{ padding: 0, borderBottom: `1px solid ${C.border}` }}>
                  <DoctorDetail doctorId={did} viewerId={me?.id} year={year} month={month} asOf={asOf} accent={accent} onOpen360={() => onOpenDoctor && onOpenDoctor(r)} />
                </td></tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// ── EXECUTION: rep scorecard, worst first ──────────────────────
function ExecutionBody({ rows, openRow, setOpenRow }) {
  const sorted = useMemo(() =>
    [...rows].sort((a, b) => (a.score ?? 101) - (b.score ?? 101)),
  [rows]);

  if (rows.length === 0) return <Empty text="No people in this selection." />;

  const dot = (s) => s === 'red' ? C.red : s === 'amber' ? C.amber : s === 'green' ? C.green : C.text3;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}>Person</th>
          <th style={thR}>Visits</th><th style={thR}>Tasks</th><th style={thR}>Overdue</th><th style={thR}>Weekly</th><th style={thR}>Score</th>
          <th style={{ width: 24 }} />
        </tr>
      </thead>
      <tbody>
        {sorted.map(r => {
          const isOpen = openRow === r.user_id;
          const visitPct = r.doctor_count > 0 ? Math.round((r.visited_30d / r.doctor_count) * 100) : null;
          return (
            <React.Fragment key={r.user_id}>
              <tr onClick={() => setOpenRow(isOpen ? null : r.user_id)} style={{ cursor: 'pointer', background: isOpen ? C.surface2 : 'transparent' }}>
                <td style={{ ...td, fontWeight: 500 }}>
                  <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: dot(r.status), marginRight: 8 }} />{r.name}
                </td>
                <td style={tdR}>{visitPct == null ? '—' : `${visitPct}%`}</td>
                <td style={tdR}>{r.task_completed || 0}/{r.task_total || 0}</td>
                <td style={{ ...tdR, color: r.overdue_tasks > 0 ? C.red : C.text2 }}>{r.overdue_tasks || 0}</td>
                <td style={tdR}>{r.weekly_submitted || 0}/{r.weekly_expected || 0}</td>
                <td style={{ ...tdR, fontWeight: 600 }}>{r.score == null ? 'N/A' : r.score}</td>
                <td style={{ ...td, color: C.text3 }}>{isOpen ? '⌄' : '›'}</td>
              </tr>
              {isOpen && (
                <tr><td colSpan={7} style={{ padding: 0, borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ padding: '12px 14px', background: C.surface2 }}>
                    <div style={{ fontSize: 12, color: C.text2, marginBottom: 6 }}>Reasons flagged</div>
                    {(r.reasons && r.reasons.length > 0) ? r.reasons.map((reason, i) => (
                      <div key={i} style={{ fontSize: 13, color: C.text1, padding: '3px 0' }}>• {reason}</div>
                    )) : <div style={{ fontSize: 13, color: C.greenDark }}>No immediate concerns.</div>}
                  </div>
                </td></tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function Empty({ text }) {
  return <div style={{ padding: '22px 14px', border: `1px dashed ${C.border2}`, borderRadius: 10, textAlign: 'center', color: C.text2, fontSize: 13 }}>{text}</div>;
}
