import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import { roiAPI, investmentsAPI, salesAPI } from '../api';

const SHOW_INDIVIDUAL_DOCTOR_CARDS = true;
import { useAuth } from '../context/AuthContext';
import EnterSales from './EnterSales';
import { useLocation, useNavigate } from 'react-router-dom';
import { draftKey, readDraft, removeDraft, writeDraft } from '../utils/draftStorage';

const API = process.env.REACT_APP_API_URL || '';

const NOW = new Date();
const CUR_YEAR  = NOW.getFullYear();
const CUR_MONTH = NOW.getMonth() + 1;

const MONTHS = ['', 'January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
const monthDate = (year, month, day = 1) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const NORMALIZE_STATE = s => (s || '').replace(/\s+/g, '').toLowerCase();
const STATE_NAMES = {
  tn: 'Tamil Nadu', tamilnadu: 'Tamil Nadu',
  kl: 'Kerala', kerala: 'Kerala',
  ka: 'Karnataka', karnataka: 'Karnataka',
  ts: 'Telangana', telangana: 'Telangana',
  ap: 'Andhra Pradesh', andhrapradesh: 'Andhra Pradesh',
  mh: 'Maharashtra', maharashtra: 'Maharashtra',
  dl: 'Delhi', delhi: 'Delhi',
};
const toStateName = code => STATE_NAMES[NORMALIZE_STATE(code)] || code || '';
const CHENNAI_AREAS = new Set([
  'adyar', 'alwarpet', 'aminjikarai', 'ayanambakkam', 'chetpet', 'chromepet',
  'guindy', 'pallikaranai', 'porur', 'tambaram', 'velachery', 'vellore',
]);
const HYDERABAD_AREAS = new Set(['gachibowli', 'nallagandla', 'lakdikapul', 'redhills', 'red hills']);
const TAMIL_NADU_REGIONAL_CITIES = ['Chennai', 'Madurai', 'Coimbatore 1', 'Coimbatore 2'];
const REGIONAL_TERRITORY_STATES = {
  Chennai: 'Tamil Nadu',
  Madurai: 'Tamil Nadu',
  'Coimbatore 1': 'Tamil Nadu',
  'Coimbatore 2': 'Tamil Nadu',
  Hyderabad: 'Telangana',
  Cochin: 'Kerala',
};
const MADURAI_REGIONAL_AREAS = new Set([
  'madurai', 'trichy', 'tiruchirappalli', 'tirnalveli', 'tirunelveli',
  'trivanduram', 'trivandrum', 'thiruvananthapuram', 'nagarkoil', 'nagercoil',
  'kuturkorin', 'tuticorin', 'thoothukudi', 'kulasegaram', 'kulasekaram',
  'tanjavoor', 'thanjavur', 'thinducal', 'dindigul',
]);
const COIMBATORE_REGIONAL_AREAS = new Set([
  'coimbatore', 'salem', 'erode', 'namakal', 'namakkal',
  'tharmapuri', 'dharmapuri', 'thirupur', 'tiruppur',
]);
const tamilNaduRegionalCity = (rawCity, ownerId) => {
  const city = (rawCity || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (city === 'chennai' || CHENNAI_AREAS.has(city)) return 'Chennai';
  if (MADURAI_REGIONAL_AREAS.has(city)) return 'Madurai';
  if (COIMBATORE_REGIONAL_AREAS.has(city)) return Number(ownerId) === 9 ? 'Coimbatore 2' : 'Coimbatore 1';
  return '';
};
const tamilNaduRegionalCityForUser = user => {
  return tamilNaduRegionalCity(user?.city, user?.id);
};
const regionalTerritoryForUser = user => {
  const tamilNaduTerritory = tamilNaduRegionalCityForUser(user);
  if (tamilNaduTerritory) return tamilNaduTerritory;
  const city = (user?.city || '').trim().toLowerCase();
  if (city === 'hyderabad') return 'Hyderabad';
  if (city === 'cochin' || city === 'kochi') return 'Cochin';
  return '';
};
const groupedCityName = doctor => {
  const rawCity = (doctor.city || '').trim();
  const cityKey = rawCity.toLowerCase().replace(/\s+/g, ' ');
  const stateName = toStateName(doctor.state_code || '');
  const pincode = String(doctor.pincode || '').trim();
  if (stateName === 'Tamil Nadu' && (pincode.startsWith('600') || CHENNAI_AREAS.has(cityKey))) return 'Chennai';
  if (stateName === 'Telangana' && (pincode.startsWith('500') || HYDERABAD_AREAS.has(cityKey))) return 'Hyderabad';
  return rawCity;
};
const groupedRegionalSalesCityName = doctor => {
  const groupedCity = groupedCityName(doctor);
  if (toStateName(doctor.state_code || '') !== 'Tamil Nadu') return groupedCity;
  return tamilNaduRegionalCity(groupedCity, doctor.manager_id);
};

const GRADE_COLORS = {
  Platinum: { bg: '#E1F5EE', border: '#1D9E75', text: '#085041', dot: '#1D9E75' },
  Gold:     { bg: '#FAEEDA', border: '#BA7517', text: '#412402', dot: '#BA7517' },
  Silver:   { bg: '#EEEDFE', border: '#534AB7', text: '#26215C', dot: '#534AB7' },
  Bronze:   { bg: '#F1EFE8', border: '#888780', text: '#2C2C2A', dot: '#888780' },
};

const CA_COLORS = {
  green:  { text: '#0F6E56', bg: '#1D9E75' },
  yellow: { text: '#BA7517', bg: '#EF9F27' },
  red:    { text: '#D85A30', bg: '#D85A30' },
};

const MODEL_COLORS = {
  U1: { bg: '#E6F1FB', text: '#042C53' },
  U2: { bg: '#E6F1FB', text: '#042C53' },
  P1: { bg: '#EAF3DE', text: '#173404' },
  P2: { bg: '#EAF3DE', text: '#173404' },
  N1: { bg: '#EEEDFE', text: '#26215C' },
  D1: { bg: '#FAEEDA', text: '#412402' },
  R1: { bg: '#FAECE7', text: '#4A1B0C' },
};

const INV_CATEGORY_LABELS = { PD: 'Professional Development', RD: 'Relationship Dev', CS: 'Commercial Support' };
const INV_CATEGORY_COLORS  = { PD: '#1D9E75', RD: '#534AB7', CS: '#BA7517' };

function investmentCategorySummary(rows) {
  const grouped = {};
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const category = row.category || 'PD';
    const subCategory = row.sub_category && row.sub_category !== 'Other' ? row.sub_category : '';
    const key = `${category}__${subCategory}`;
    if (!grouped[key]) grouped[key] = { category, sub_category: subCategory, amount: 0 };
    grouped[key].amount += Number(row.amount) || 0;
  });
  return Object.values(grouped).sort((a, b) => b.amount - a.amount);
}

function fmtInr(val) {
  if (!val) return '₹0';
  if (val >= 100000) return `₹${(val/100000).toFixed(1)}L`;
  if (val >= 1000)   return `₹${(val/1000).toFixed(1)}K`;
  return `₹${Math.round(val)}`;
}

function fmtROIValue(sales, invested, roi) {
  if ((invested || 0) > 0) return `${roi || 0}×`;
  if ((sales || 0) > 0) return 'Sales only';
  return '0×';
}

function investmentTooltip(doc) {
  const total = fmtInr(doc.total_invested || 0);
  const rows = Array.isArray(doc.investment_months) ? doc.investment_months : [];
  if (!rows.length) return `Six-month investment: ${total}`;
  return [`Six-month investment: ${total}`, ...rows.map(r => `${r.label}: ${fmtInr(r.amount || 0)}`)].join('\n');
}

function InvestmentBar({ doc, pct, value, color = '#f97316', labelColor = '#f97316' }) {
  const [activeDot, setActiveDot] = useState(null);
  const rows = Array.isArray(doc.investment_months) ? doc.investment_months : [];
  const total = value ?? doc.total_invested ?? 0;
  const barPct = Math.max(0, Math.min(100, pct || 0));
  return (
    <div
      onMouseLeave={() => setActiveDot(null)}
      style={{ height: 12, borderRadius: 3, background: '#f9fafb', overflow: 'visible', position: 'relative', cursor: 'pointer' }}
    >
      <div style={{ width: `${barPct}%`, height: '100%', background: color, borderRadius: 3 }} />
      <span style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 9, lineHeight: 1, fontWeight: 900, color: barPct > 32 ? '#fff' : labelColor, textShadow: barPct > 32 ? '0 1px 2px rgba(0,0,0,0.25)' : 'none', pointerEvents: 'none' }}>{fmtInr(total)}</span>
      {rows.map((r, idx) => {
        const dotLeft = rows.length === 1
          ? Math.max(12, Math.min(88, barPct / 2))
          : Math.max(8, Math.min(96, ((idx + 1) / rows.length) * barPct));
        return (
          <span
            key={`${r.year}-${r.month}-${idx}`}
            title={`${r.label}: ${fmtInr(r.amount || 0)}`}
            onMouseEnter={() => setActiveDot(idx)}
            onClick={e => { e.stopPropagation(); setActiveDot(activeDot === idx ? null : idx); }}
            style={{
              position: 'absolute',
              left: `${dotLeft}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#fff',
              border: '1.5px solid #f97316',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.75)',
              cursor: 'help',
            }}
          >
            {activeDot === idx && (
              <span style={{ position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 50, minWidth: 112, padding: '7px 9px', borderRadius: 8, background: '#111827', color: '#fff', boxShadow: '0 10px 28px rgba(0,0,0,0.22)', pointerEvents: 'none', textAlign: 'center' }}>
                <span style={{ display: 'block', fontSize: 10, color: '#d1d5db', marginBottom: 3 }}>{r.label}</span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 900 }}>{fmtInr(r.amount || 0)}</span>
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function SalesBar({ doc, pct, markerPct = 0 }) {
  const [activeDot, setActiveDot] = useState(null);
  const rows = Array.isArray(doc.sales_months) ? doc.sales_months : [];
  const barPct = Math.max(0, Math.min(100, pct || 0));
  return (
    <div onMouseLeave={() => setActiveDot(null)} style={{ height: 10, background: '#f9fafb', borderRadius: 3, overflow: 'visible', position: 'relative', cursor: 'pointer' }}>
      <div style={{ width: `${barPct}%`, height: '100%', background: '#0F6E56', borderRadius: 3 }} />
      {markerPct > 0 && <div style={{ position: 'absolute', left: `${markerPct}%`, top: 0, bottom: 0, width: 1.5, background: '#f97316', opacity: 0.7 }} />}
      {rows.map((r, idx) => {
        const dotLeft = rows.length === 1
          ? Math.max(12, Math.min(88, barPct / 2))
          : Math.max(8, Math.min(96, ((idx + 1) / rows.length) * barPct));
        return (
          <span
            key={`${r.year}-${r.month}-${idx}`}
            title={`${r.label}: ${fmtInr(r.amount || 0)}`}
            onMouseEnter={() => setActiveDot(idx)}
            onClick={e => { e.stopPropagation(); setActiveDot(activeDot === idx ? null : idx); }}
            style={{ position: 'absolute', left: `${dotLeft}%`, top: '50%', transform: 'translate(-50%, -50%)', width: 7, height: 7, borderRadius: '50%', background: '#fff', border: '1.5px solid #0F6E56', boxShadow: '0 0 0 1px rgba(255,255,255,0.75)', cursor: 'help' }}
          >
            {activeDot === idx && (
              <span style={{ position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 50, minWidth: 112, padding: '7px 9px', borderRadius: 8, background: '#111827', color: '#fff', boxShadow: '0 10px 28px rgba(0,0,0,0.22)', pointerEvents: 'none', textAlign: 'center' }}>
                <span style={{ display: 'block', fontSize: 10, color: '#d1d5db', marginBottom: 3 }}>{r.label}</span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 900 }}>{fmtInr(r.amount || 0)}</span>
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function CaBadge({ status, pct }) {
  const c = CA_COLORS[status] || CA_COLORS.red;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: c.text }}>
      {status === 'green' ? '🟢' : status === 'yellow' ? '🟡' : '🔴'} {pct}%
    </span>
  );
}

function GradeBadge({ grade }) {
  const c = GRADE_COLORS[grade] || GRADE_COLORS.Bronze;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
      background: c.bg, color: c.text, border: `0.5px solid ${c.border}`,
    }}>{grade}</span>
  );
}

function ModelBadge({ model }) {
  if (!model) return null;
  const c = MODEL_COLORS[model] || { bg: '#F1EFE8', text: '#2C2C2A' };
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
      background: c.bg, color: c.text,
    }}>{model}</span>
  );
}

function CommitmentStatusBadge({ status }) {
  const map = {
    Achieved: { bg: '#E1F5EE', text: '#085041', border: '#1D9E75' },
    'On Track': { bg: '#E6F1FB', text: '#042C53', border: '#60a5fa' },
    'At Risk': { bg: '#FAEEDA', text: '#412402', border: '#BA7517' },
    Breached: { bg: '#FAECE7', text: '#4A1B0C', border: '#D85A30' },
  };
  const c = map[status] || map['At Risk'];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 76, fontSize: 10, fontWeight: 800, padding: '3px 8px',
      borderRadius: 5, background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      whiteSpace: 'nowrap',
    }}>
      {status}
    </span>
  );
}

function StatCard({ label, value, sub, color, icon }) {
  return (
    <div style={{
      background: 'var(--color-background-secondary,#f5f5f5)',
      borderRadius: 12, padding: '14px 18px', minWidth: 0,
    }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{icon} {label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: color || 'var(--color-text-primary,#111)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function DoctorCard({ d, onClick, selected }) {
  const gc = GRADE_COLORS[d.roi_grade] || GRADE_COLORS.Bronze;
  const cc = CA_COLORS[d.ca_status]   || CA_COLORS.red;
  const investmentCategories = investmentCategorySummary(d.investment_categories);
  return (
    <div
      onClick={() => onClick(d)}
      style={{
        background: 'var(--color-background-primary,#fff)',
        border: selected ? `2px solid ${gc.border}` : `0.5px solid ${gc.border}44`,
        borderLeft: `3px solid ${gc.border}`,
        borderRadius: 12, padding: '14px 16px', cursor: 'pointer',
        transition: 'box-shadow 0.15s, border 0.15s',
        boxShadow: selected ? `0 0 0 2px ${gc.border}33` : 'none',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {d.doctor_name}
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
            {d.specialty || 'Doctor'} · {d.city || d.state_code}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0, marginLeft: 8 }}>
          <GradeBadge grade={d.roi_grade} />
          <ModelBadge model={d.commercial_model} />
        </div>
      </div>

      {/* Numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: '#888' }}>6M Investment</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtInr(d.total_invested)}</div>
          {investmentCategories.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
              {investmentCategories.slice(0, 2).map(item => (
                <span key={`${item.category}-${item.sub_category}`} title={INV_CATEGORY_LABELS[item.category] || item.category}
                  style={{ fontSize: 8, fontWeight: 800, color: INV_CATEGORY_COLORS[item.category] || '#6b7280' }}>
                  {item.category}{item.sub_category ? ` · ${item.sub_category}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888' }}>6M Business</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0F6E56' }}>{fmtInr(d.actual_sales)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888' }}>Expected</div>
          <div style={{ fontSize: 12 }}>{fmtInr(d.expected_sales)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888' }}>ROI</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: gc.dot }}>{fmtROIValue(d.actual_sales, d.total_invested, d.roi_multiple)}</div>
        </div>
      </div>

      {/* Achievement bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
          <span style={{ color: '#888' }}>Achievement</span>
          <CaBadge status={d.ca_status} pct={d.ca_percent} />
        </div>
        <div style={{ height: 5, borderRadius: 3, background: '#eee', overflow: 'hidden' }}>
          <div style={{
            height: 5, borderRadius: 3,
            width: `${Math.min(d.ca_percent, 100)}%`,
            background: cc.bg,
            transition: 'width 0.4s',
          }} />
        </div>
      </div>
    </div>
  );
}

function DrillPanel({ doctorId, year, month, viewerId, onClose, onAddInvestment, onAddBusiness }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    if (!doctorId) return;
    setData(null);
    roiAPI.doctorFull(doctorId, year, month, viewerId)
      .then(r => setData(r.data))
      .catch(() => {});
  }, [doctorId, year, month, viewerId]);

  if (!data) return (
    <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Loading...</div>
  );

  const gc = GRADE_COLORS[data.roi_grade] || GRADE_COLORS.Bronze;
  const cc = CA_COLORS[data.ca_status]    || CA_COLORS.red;
  const trendMax = Math.max(...(data.monthly_trend || []).map(t => t.sales), 1);
  const drillInvestmentCategories = Object.entries(data.investment_by_category || {})
    .filter(([, categoryData]) => Number(categoryData?.total) > 0)
    .sort((a, b) => Number(b[1].total) - Number(a[1].total));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Panel header */}
      <div style={{
        padding: '16px 20px', borderBottom: '0.5px solid #eee',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{data.doctor_name}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            {data.specialty} · {data.hospital ? `${data.hospital} · ` : ''}{data.city}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <GradeBadge grade={data.roi_grade} />
            <ModelBadge model={data.commercial_model} />
            <CaBadge status={data.ca_status} pct={data.ca_percent} />
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', fontSize: 20, cursor: 'pointer',
          color: '#888', padding: '0 4px', lineHeight: 1,
        }}>×</button>
      </div>

      {/* Quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '12px 20px' }}>
        <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#888' }}>Invested</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtInr(data.total_invested)}</div>
          {drillInvestmentCategories.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
              {drillInvestmentCategories.map(([category]) => (
                <span key={category} title={INV_CATEGORY_LABELS[category] || category}
                  style={{ fontSize: 8, fontWeight: 800, color: INV_CATEGORY_COLORS[category] || '#6b7280' }}>{category}</span>
              ))}
            </div>
          )}
        </div>
        <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#888' }}>This Month</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0F6E56' }}>{fmtInr(data.actual_sales)}</div>
        </div>
        <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#888' }}>ROI</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: gc.dot }}>{fmtROIValue(data.actual_sales, data.total_invested, data.roi_multiple)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, padding: '0 20px', borderBottom: '0.5px solid #eee' }}>
        {['overview', 'investment', 'business'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 14px', fontSize: 12, fontWeight: tab === t ? 600 : 400,
            background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: tab === t ? `2px solid ${gc.border}` : '2px solid transparent',
            color: tab === t ? gc.border : '#888',
            textTransform: 'capitalize',
          }}>{t}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

        {tab === 'overview' && (
          <div>
            {/* Achievement bar */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: '#888' }}>Commitment Achievement</span>
                <CaBadge status={data.ca_status} pct={data.ca_percent} />
              </div>
              <div style={{ height: 8, borderRadius: 4, background: '#eee', overflow: 'hidden' }}>
                <div style={{
                  height: 8, borderRadius: 4,
                  width: `${Math.min(data.ca_percent, 100)}%`,
                  background: cc.bg,
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginTop: 4 }}>
                <span>Actual: {fmtInr(data.actual_sales)}</span>
                <span>Target: {fmtInr(data.expected_sales)}</span>
              </div>
            </div>

            {/* Monthly trend */}
            {data.monthly_trend && data.monthly_trend.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Monthly trend</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 70 }}>
                  {data.monthly_trend.map((t, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <div style={{ fontSize: 9, color: '#888' }}>{fmtInr(t.sales)}</div>
                      <div style={{
                        width: '100%', borderRadius: '3px 3px 0 0',
                        height: `${Math.max((t.sales / trendMax) * 50, 2)}px`,
                        background: t.month === month && t.year === year ? gc.border : `${gc.border}66`,
                      }} />
                      <div style={{ fontSize: 9, color: '#888' }}>{t.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Commercial model info */}
            <div style={{ background: '#f9f9f9', borderRadius: 8, padding: 12, fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Account classification</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '0.5px solid #eee' }}>
                <span style={{ color: '#888' }}>Model</span>
                <span>{data.commercial_model ? `${data.commercial_model} – ${data.commercial_label}` : 'Not set'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '0.5px solid #eee' }}>
                <span style={{ color: '#888' }}>Expected multiple</span>
                <span>{data.expected_multiple}×</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '0.5px solid #eee' }}>
                <span style={{ color: '#888' }}>All-time business</span>
                <span style={{ fontWeight: 600, color: '#0F6E56' }}>{fmtInr(data.all_time_sales)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: '#888' }}>Category</span>
                <span>{data.category || '—'}</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'investment' && (
          <div>
            <button onClick={() => onAddInvestment(data)} style={{
              width: '100%', marginBottom: 16, padding: '10px',
              background: '#E1F5EE', border: '0.5px solid #1D9E75',
              borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#085041',
            }}>+ Add Investment</button>

            {/* Grouped by Commercial Model (U1–R1) */}
            {Object.keys(data.investment_by_model || {}).length === 0 ? (
              <div style={{ textAlign: 'center', color: '#888', padding: 24, fontSize: 13 }}>
                No investments recorded yet
              </div>
            ) : (
              Object.entries(data.investment_by_model)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([model, mData]) => {
                  const mc = MODEL_COLORS[model] || { text: '#374151', bg: '#f9fafb', border: '#e5e7eb' };
                  return (
                    <div key={model} style={{ marginBottom: 14, borderRadius: 10, overflow: 'hidden', border: `1px solid ${mc.border || '#e5e7eb'}` }}>
                      {/* Model header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: mc.bg }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, background: mc.text, color: '#fff', padding: '2px 6px', borderRadius: 4 }}>{model}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: mc.text }}>{mData.label}</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: mc.text }}>{fmtInr(mData.total)}</span>
                      </div>
                      {/* Activity breakdown */}
                      {mData.items.map((item, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', fontSize: 12, borderTop: '0.5px solid #f0f0f0', background: '#fff' }}>
                          <span style={{ color: '#555', flex: 1 }}>
                            {item.sub_category}
                            {item.category && <span style={{ fontSize: 10, color: INV_CATEGORY_COLORS[item.category] || '#888', fontWeight: 600, marginLeft: 6 }}>{item.category}</span>}
                            <span style={{ color: '#bbb', marginLeft: 4 }}>×{item.count}</span>
                          </span>
                          <span style={{ fontWeight: 600 }}>{fmtInr(item.amount)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })
            )}

            {/* Recent investment entries */}
            {data.investments && data.investments.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Recent Entries</div>
                {data.investments.slice(0, 8).map(inv => {
                  const mc = MODEL_COLORS[inv.commercial_model_type] || {};
                  return (
                    <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '0.5px solid #f3f4f6', fontSize: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 2 }}>
                          {inv.commercial_model_type && (
                            <span style={{ fontSize: 10, fontWeight: 800, background: mc.text || '#374151', color: '#fff', padding: '1px 5px', borderRadius: 3 }}>{inv.commercial_model_type}</span>
                          )}
                          {inv.sub_category && <span style={{ color: '#555' }}>{inv.sub_category}</span>}
                          {inv.category && <span style={{ fontSize: 10, color: INV_CATEGORY_COLORS[inv.category] || '#888', fontWeight: 600 }}>{inv.category}</span>}
                        </div>
                        {inv.purpose && <div style={{ fontSize: 11, color: '#aaa', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{inv.purpose}</div>}
                        <div style={{ fontSize: 10, color: '#bbb', marginTop: 1 }}>{inv.submitted_at}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontWeight: 700 }}>{fmtInr(inv.amount)}</div>
                        <div style={{ fontSize: 10, color: inv.is_approved ? '#0F6E56' : '#BA7517', marginTop: 2 }}>
                          {inv.is_approved ? '✓ Approved' : '⏳ Pending'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'business' && (
          <div>
            <button onClick={() => onAddBusiness(data)} style={{
              width: '100%', marginBottom: 16, padding: '10px',
              background: '#EEEDFE', border: `0.5px solid #534AB7`,
              borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#26215C',
            }}>+ Add Business Entry</button>

            <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Product-wise · {MONTHS[month]} {year}</div>
            {data.products_sales && data.products_sales.length > 0 ? (
              data.products_sales.map((p, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px', borderRadius: 8, marginBottom: 6,
                  background: 'var(--color-background-secondary,#f5f5f5)',
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.product_name}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>Qty: {p.total_qty}</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0F6E56' }}>{fmtInr(p.total_sales)}</div>
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', color: '#888', padding: 24, fontSize: 13 }}>
                No business recorded this month
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AddInvestmentModal({ doctor, year, month, onClose, onSaved }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    category: 'PD', sub_category: '', amount: '', purpose: '',
    expected_multiple: 5,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const SUB_CATS = {
    PD: ['Conference Registration', 'Travel Support', 'Hotel / Stay', 'CME Sponsorship', 'Speaker Program'],
    RD: ['Advisory Board', 'Round Table', 'Doctor Meeting'],
    CS: ['Commercial Support', 'Sample', 'Gift'],
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.amount || !form.category) { setError('Amount and category are required'); return; }
    setSaving(true); setError('');
    try {
      await investmentsAPI.submit({
        doctor_id: doctor.doctor_id,
        associate_id: user?.id || 1,
        year, month, week: 1,
        category: form.category,
        sub_category: form.sub_category || null,
        amount: Number(form.amount),
        expected_multiple: Number(form.expected_multiple) || 5,
        purpose: form.purpose || null,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: 28, width: 440, maxWidth: '90vw',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Add Investment</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
          Doctor: <strong>{doctor?.doctor_name}</strong> · {MONTHS[month]} {year}
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Category *</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value, sub_category: '' }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '0.5px solid #ddd', fontSize: 13 }}>
                <option value="PD">PD – Professional Development</option>
                <option value="RD">RD – Relationship Development</option>
                <option value="CS">CS – Commercial Support</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Sub-category</label>
              <select value={form.sub_category} onChange={e => setForm(f => ({ ...f, sub_category: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '0.5px solid #ddd', fontSize: 13 }}>
                <option value="">Select...</option>
                {(SUB_CATS[form.category] || []).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Amount (₹) *</label>
              <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="e.g. 15000"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '0.5px solid #ddd', fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Expected multiple</label>
              <input type="number" value={form.expected_multiple} onChange={e => setForm(f => ({ ...f, expected_multiple: e.target.value }))}
                min={1} max={20} step={0.5}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '0.5px solid #ddd', fontSize: 13 }} />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Purpose / notes</label>
            <textarea value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
              rows={2} placeholder="e.g. ASCO 2026 conference registration"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '0.5px solid #ddd', fontSize: 13, resize: 'vertical' }} />
          </div>
          {error && <div style={{ color: '#D85A30', fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: '10px', borderRadius: 8, border: '0.5px solid #ddd',
              background: 'none', cursor: 'pointer', fontSize: 13,
            }}>Cancel</button>
            <button type="submit" disabled={saving} style={{
              flex: 2, padding: '10px', borderRadius: 8, border: 'none',
              background: '#1D9E75', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}>{saving ? 'Saving...' : 'Add Investment'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddBusinessModal({ doctor, year, month, onClose, onSaved }) {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [saleDate, setSaleDate] = useState(monthDate(year, month, 1));
  const [entries, setEntries] = useState([{ product_id: '', value: '', quantity: '' }]);
  const [savedSales, setSavedSales] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadSavedSales = useCallback(() => {
    if (!user?.id || !doctor?.doctor_id) return;
    axios.get(`${API}/sales/my-sales`, { params: { associate_id: user.id, year, month } })
      .then(res => {
        const rows = [];
        (res.data || []).forEach(day => {
          (day.doctors || [])
            .filter(d => d.doctor_id === doctor.doctor_id)
            .forEach(d => {
              (d.products || [])
                .filter(product => String(product.associate_id) === String(user.id))
                .forEach(product => rows.push({
                  ...product,
                  date: day.date,
                  doctor_name: d.doctor_name,
                }));
            });
        });
        setSavedSales(rows);
      })
      .catch(() => setSavedSales([]));
  }, [user?.id, doctor?.doctor_id, year, month]);

  useEffect(() => {
    axios.get(`${API}/products/`).then(r => setProducts(r.data)).catch(() => {});
    loadSavedSales();
  }, [loadSavedSales]);

  const addRow = () => setEntries(e => [...e, { product_id: '', value: '', quantity: '' }]);
  const updRow = (i, field, val) => setEntries(e => e.map((r, idx) => idx === i ? { ...r, [field]: val } : r));

  const editSavedSale = row => {
    setSaleDate(row.date || monthDate(year, month, 1));
    setEntries([{ product_id: String(row.product_id), value: String(row.value || ''), quantity: String(row.quantity || '') }]);
    setError('');
  };

  const deleteSavedSale = async row => {
    if (!row?.entry_id) return;
    if (!window.confirm(`Delete ${row.product_name} sale entry?`)) return;
    setSaving(true);
    setError('');
    try {
      await salesAPI.deleteEntry(row.entry_id, user.id);
      await loadSavedSales();
      onSaved();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to delete sale entry');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const valid = entries.filter(r => r.product_id && r.value);
    if (!valid.length) { setError('Add at least one product entry with value'); return; }
    setSaving(true); setError('');
    try {
      await salesAPI.submit({
        doctor_id: doctor.doctor_id,
        associate_id: user?.id || 1,
        sale_date: saleDate,
        entries: valid.map(r => ({
          product_id: parseInt(r.product_id),
          value: parseFloat(r.value),
          quantity: parseFloat(r.quantity || 0),
        })),
      });
      await loadSavedSales();
      onSaved();
      setEntries([{ product_id: '', value: '', quantity: '' }]);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: 28, width: 500, maxWidth: '90vw',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Add Business Entry</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
          Doctor: <strong>{doctor?.doctor_name}</strong> · {MONTHS[month]} {year}
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Sale Date</label>
            <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)}
              min={monthDate(year, month, 1)} max={monthDate(year, month, new Date(year, month, 0).getDate())}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '0.5px solid #ddd', fontSize: 13 }} />
          </div>
          {entries.map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
              <select value={row.product_id} onChange={e => updRow(i, 'product_id', e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 8, border: '0.5px solid #ddd', fontSize: 13 }}>
                <option value="">Product</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="number" value={row.quantity} onChange={e => updRow(i, 'quantity', e.target.value)}
                placeholder="Qty" style={{ padding: '8px 10px', borderRadius: 8, border: '0.5px solid #ddd', fontSize: 13 }} />
              <input type="number" value={row.value} onChange={e => updRow(i, 'value', e.target.value)}
                placeholder="₹ Value" style={{ padding: '8px 10px', borderRadius: 8, border: '0.5px solid #ddd', fontSize: 13 }} />
            </div>
          ))}
          <button type="button" onClick={addRow} style={{
            width: '100%', padding: '7px', marginBottom: 16,
            borderRadius: 8, border: '0.5px dashed #bbb', background: 'none',
            cursor: 'pointer', fontSize: 12, color: '#888',
          }}>+ Add another product</button>
          <div style={{ border: '1px solid #eef2f7', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ padding: '9px 11px', background: '#f9fafb', fontSize: 12, fontWeight: 800, color: '#374151' }}>
              Existing Sales Entries
            </div>
            {savedSales.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: '#9ca3af' }}>No saved sales for this doctor in {MONTHS[month]}.</div>
            ) : savedSales.map(row => (
              <div key={row.entry_id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center', padding: '9px 11px', borderTop: '1px solid #f3f4f6' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.product_name}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{row.date} · Qty {row.quantity} · {fmtInr(row.value)}</div>
                </div>
                <button type="button" onClick={() => editSavedSale(row)}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                  Edit
                </button>
                <button type="button" onClick={() => deleteSavedSale(row)}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                  Delete
                </button>
              </div>
            ))}
          </div>
          {error && <div style={{ color: '#D85A30', fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: '10px', borderRadius: 8, border: '0.5px solid #ddd',
              background: 'none', cursor: 'pointer', fontSize: 13,
            }}>Cancel</button>
            <button type="submit" disabled={saving} style={{
              flex: 2, padding: '10px', borderRadius: 8, border: 'none',
              background: '#534AB7', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}>{saving ? 'Saving...' : 'Save Business Entry'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const COMMERCIAL_MODELS = [
  { code: 'U1', label: 'Upfront Investment Account',  desc: 'Investment made first, expected business multiple later',   color: '#1d4ed8', bg: '#EFF6FF', border: '#BFDBFE' },
  { code: 'U2', label: 'Strategic Upfront Account',   desc: 'High-value account with long-term growth potential',        color: '#0891b2', bg: '#ECFEFF', border: '#A5F3FC' },
  { code: 'P1', label: 'Performance-Linked Account',  desc: 'Support linked to actual sales generated',                  color: '#065f46', bg: '#F0FDF4', border: '#A7F3D0' },
  { code: 'P2', label: 'Growth Incentive Account',    desc: 'Support increases as business increases',                    color: '#166534', bg: '#DCFCE7', border: '#BBF7D0' },
  { code: 'N1', label: 'Natural Prescriber',          desc: 'Prescribes without significant investment',                 color: '#7c3aed', bg: '#F5F3FF', border: '#DDD6FE' },
  { code: 'D1', label: 'Development Account',         desc: 'New doctor under evaluation',                               color: '#d97706', bg: '#FFFBEB', border: '#FDE68A' },
  { code: 'R1', label: 'At-Risk Account',             desc: 'Declining business or high competitor threat',              color: '#dc2626', bg: '#FEF2F2', border: '#FECACA' },
];

const CM_MAP = Object.fromEntries(COMMERCIAL_MODELS.map(m => [m.code, m]));

const COMMERCIAL_MODEL_LABELS = Object.fromEntries(COMMERCIAL_MODELS.map(m => [m.code, m.label]));

const ALL_SUB_CATS = [
  'Conference Registration', 'Travel Support', 'Hotel / Stay', 'CME Sponsorship',
  'Speaker Program', 'Advisory Board', 'Round Table', 'Doctor Meeting',
  'Commercial Support', 'Sample', 'Gift',
];

const EMPTY_INV = { doctor_id: '', commercial_model_type: '', sub_category: '', week: 1, amount: '', purpose: '', expected_multiple: 5 };

const toNum = value => Number(value || 0);
const doctorActivityValue = doc => Math.max(toNum(doc.actual_sales), toNum(doc.total_invested), toNum(doc.expected_sales));
const sortByActivity = (a, b) =>
  doctorActivityValue(b) - doctorActivityValue(a) ||
  toNum(b.actual_sales) - toNum(a.actual_sales) ||
  toNum(b.total_invested) - toNum(a.total_invested);

function normalizeSpendData(data = {}) {
  const byCategory = data.by_category || {};
  const categoryBreakdown = data.category_breakdown || ['PD', 'RD', 'CS'].reduce((acc, cat) => {
    acc[cat] = { total: toNum(byCategory[cat]), count: byCategory[cat] ? 1 : 0 };
    return acc;
  }, {});

  return {
    ...data,
    category_breakdown: categoryBreakdown,
    sub_activity_breakdown: data.sub_activity_breakdown || Object.entries(data.by_model || {}).map(([activity, total]) => ({
      activity,
      total: toNum(total),
    })),
    per_doctor_category: Array.isArray(data.per_doctor_category) ? data.per_doctor_category : [],
  };
}

function normalizeRiskData(data = {}) {
  const topDoctors = data.top_doctors || (data.doctors || []).map((doc, index) => ({
    doctor_id: doc.doctor_id,
    doctor_name: doc.doctor_name,
    commercial_model: doc.commercial_model,
    roi_grade: doc.roi_grade || 'Bronze',
    sales: toNum(doc.sales || doc.amount),
    pct_of_total: toNum(doc.pct),
    cumulative_pct: toNum(doc.cumulative_pct || doc.pct),
    rank: index + 1,
  }));

  return {
    ...data,
    top5_pct: toNum(data.top5_pct ?? data.top3_pct ?? data.top_doctor_pct),
    top10_pct: toNum(data.top10_pct ?? data.top3_pct ?? data.top_doctor_pct),
    total_sales: toNum(data.total_sales ?? data.grand_total),
    doctor_count: toNum(data.doctor_count || topDoctors.length),
    top_doctors: topDoctors,
  };
}

function RegionalSalesPanel({ year, month, initialStateCode = 'ALL', initialCity = 'ALL' }) {
  const { user: me } = useAuth();
  const [salesYear, setSalesYear] = useState(year);
  const [salesMonth, setSalesMonth] = useState(month);
  const [week, setWeek] = useState(1);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [stateCode, setStateCode] = useState(initialStateCode || 'ALL');
  const [city, setCity] = useState(initialCity || 'ALL');
  const [regionalSelectionTouched, setRegionalSelectionTouched] = useState(initialStateCode !== 'ALL' || initialCity !== 'ALL');
  const [rows, setRows] = useState({});
  const [editingRegionalRows, setEditingRegionalRows] = useState({});
  const [dirtyRegionalRows, setDirtyRegionalRows] = useState({});
  const [history, setHistory] = useState([]);
  const [consolidated, setConsolidated] = useState({ qty: 0, value: 0 });
  const [monthlyConsolidated, setMonthlyConsolidated] = useState({ qty: 0, value: 0 });
  const [weekContext, setWeekContext] = useState({
    previousWeek: { qty: 0, value: 0 },
    earlierWeeks: { qty: 0, value: 0 },
    weeksByProduct: {},
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [regionalPdfs, setRegionalPdfs] = useState([]);
  const [regionalPdfBusy, setRegionalPdfBusy] = useState(false);
  const [regionalPdfError, setRegionalPdfError] = useState('');
  // Every product line read from the uploaded files, so the user can see the
  // full contents of the report — including products not in the Product Master.
  const [extractedReport, setExtractedReport] = useState(null);
  const [regionalDraftStatus, setRegionalDraftStatus] = useState('');
  const pendingRegionalDraftRestore = useRef('');
  const previousRegionalDraftKey = useRef('');
  const [regionalAccess, setRegionalAccess] = useState({
    direct_territories: [],
    visible_territories: [],
    can_view_all: false,
    can_manage_multiple: false,
  });
  const isLegacyJulyWeeklyMonth = salesYear === 2026 && salesMonth === 7;
  const isCumulativeWeeklyMonth = salesYear > 2026 || (salesYear === 2026 && salesMonth >= 8);
  const isWeeklyRegionalMonth = isLegacyJulyWeeklyMonth || isCumulativeWeeklyMonth;
  const activeSalesWeek = isWeeklyRegionalMonth ? week : 0;
  const regionalStateFilter = stateCode === 'ALL' ? '' : stateCode;
  const regionalCityFilter = city === 'ALL' ? '' : city;
  const isAggregateRegionalView = stateCode === 'ALL' || city === 'ALL';
  const fallbackTerritory = regionalTerritoryForUser(me);
  const visibleRegionalTerritories = useMemo(
    () => regionalAccess.visible_territories?.length
      ? regionalAccess.visible_territories
      : fallbackTerritory ? [fallbackTerritory] : [],
    [regionalAccess.visible_territories, fallbackTerritory]
  );
  const visibleRegionalTerritorySet = new Set(visibleRegionalTerritories);
  const canUseAggregateRegionalView = regionalAccess.can_view_all || regionalAccess.can_manage_multiple;
  const shouldDefaultToEntryLocation = !canUseAggregateRegionalView;
  const regionalDraftKey = me?.id && !isAggregateRegionalView
    ? draftKey('regional-sales', [me.id, salesYear, salesMonth, activeSalesWeek, stateCode, city])
    : '';

  useEffect(() => {
    if (previousRegionalDraftKey.current === regionalDraftKey) return;
    previousRegionalDraftKey.current = regionalDraftKey;
    setDirtyRegionalRows({});
    setEditingRegionalRows({});
    setRegionalDraftStatus('');
  }, [regionalDraftKey]);

  useEffect(() => {
    if (!regionalDraftKey) return;
    if (loading) {
      pendingRegionalDraftRestore.current = regionalDraftKey;
      return;
    }
    if (pendingRegionalDraftRestore.current !== regionalDraftKey) return;
    pendingRegionalDraftRestore.current = '';
    const draft = readDraft(regionalDraftKey);
    if (!draft?.rows || !draft?.dirtyRows) return;
    setRows(current => ({ ...current, ...draft.rows }));
    setDirtyRegionalRows(draft.dirtyRows);
    setEditingRegionalRows(draft.editingRows || {});
    setRegionalDraftStatus('Unsaved draft restored from this device');
  }, [regionalDraftKey, loading]);

  useEffect(() => {
    if (!regionalDraftKey || Object.keys(dirtyRegionalRows).length === 0) return undefined;
    const timer = setTimeout(() => {
      const draftRows = Object.fromEntries(
        Object.keys(dirtyRegionalRows).map(productId => [productId, rows[productId]])
      );
      if (writeDraft(regionalDraftKey, { rows: draftRows, dirtyRows: dirtyRegionalRows, editingRows: editingRegionalRows })) {
        setRegionalDraftStatus('Draft saved on this device');
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [regionalDraftKey, rows, dirtyRegionalRows, editingRegionalRows]);

  useEffect(() => {
    if (!me?.id) return;
    axios.get(`${API}/users/${me.id}/regional-territories/access`)
      .then(response => setRegionalAccess(response.data || {}))
      .catch(() => setRegionalAccess({
        direct_territories: fallbackTerritory ? [fallbackTerritory] : [],
        visible_territories: fallbackTerritory ? [fallbackTerritory] : [],
        can_view_all: ['admin', 'md'].includes(me?.role),
        can_manage_multiple: ['admin', 'md', 'director', 'senior_manager', 'manager'].includes(me?.role),
      }));
  }, [me?.id, me?.role, fallbackTerritory]);

  const loadRegional = useCallback(() => {
    if (!me?.id) return;
    setLoading(true);
    setError('');
    Promise.all([
      axios.get(`${API}/products/`),
      axios.get(`${API}/doctors/`, { params: { viewer_id: me.id, include_inactive: false } }),
      salesAPI.regional(me.id, salesYear, salesMonth, activeSalesWeek, regionalStateFilter, regionalCityFilter),
      salesAPI.regional(me.id, salesYear, salesMonth, null, regionalStateFilter, regionalCityFilter),
      salesAPI.regional(me.id, null, null, null, regionalStateFilter, regionalCityFilter),
    ]).then(([productRes, doctorRes, regionalRes, monthRes, consolidatedRes]) => {
      const productList = productRes.data || [];
      const doctorList = doctorRes.data || [];
      const monthRows = monthRes.data || [];
      const consolidatedRows = consolidatedRes.data || [];
      setMonthlyConsolidated({
        qty: monthRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0),
        value: monthRows.reduce((sum, row) => sum + (Number(row.value) || 0), 0),
      });
      const previousWeekRows = isWeeklyRegionalMonth
        ? monthRows.filter(row => Number(row.week) === activeSalesWeek - 1)
        : [];
      const earlierWeekRows = isWeeklyRegionalMonth
        ? monthRows.filter(row => Number(row.week) > 0 && Number(row.week) < activeSalesWeek)
        : [];
      const weeksByProduct = earlierWeekRows.reduce((acc, row) => {
        const weekNumber = Number(row.week);
        acc[weekNumber] = acc[weekNumber] || {};
        const current = acc[weekNumber][row.product_id] || { qty: 0, value: 0 };
        current.qty += Number(row.quantity) || 0;
        current.value += Number(row.value) || 0;
        acc[weekNumber][row.product_id] = current;
        return acc;
      }, {});
      setWeekContext({
        previousWeek: {
          qty: previousWeekRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0),
          value: previousWeekRows.reduce((sum, row) => sum + (Number(row.value) || 0), 0),
        },
        earlierWeeks: {
          qty: earlierWeekRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0),
          value: earlierWeekRows.reduce((sum, row) => sum + (Number(row.value) || 0), 0),
        },
        weeksByProduct,
      });
      setConsolidated({
        qty: consolidatedRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0),
        value: consolidatedRows.reduce((sum, row) => sum + (Number(row.value) || 0), 0),
      });
      const locationList = Object.values(doctorList.reduce((acc, doctor) => {
        const st = (doctor.state_code || me.state || '').trim();
        const ct = (groupedRegionalSalesCityName(doctor) || '').trim();
        if (!st || !ct) return acc;
        const stateName = toStateName(st);
        const key = `${stateName}__${ct}`.toLowerCase();
        acc[key] = acc[key] || { state_code: st, state_name: stateName, city: ct, count: 0 };
        acc[key].count += 1;
        return acc;
      }, {})).sort((a, b) => `${a.state_name} ${a.city}`.localeCompare(`${b.state_name} ${b.city}`));
      setLocations(locationList);
      if (shouldDefaultToEntryLocation && !regionalSelectionTouched && stateCode === 'ALL' && city === 'ALL' && locationList.length) {
        const defaultLocation = locationList[0];
        const defaultCity = regionalAccess.direct_territories?.[0]
          || visibleRegionalTerritories[0]
          || regionalTerritoryForUser(me)
          || defaultLocation.city;
        setStateCode(REGIONAL_TERRITORY_STATES[defaultCity] || defaultLocation.state_code);
        setCity(defaultCity);
        setProducts(productList);
        setRows(productList.reduce((acc, product) => {
          acc[product.id] = { quantity: '', value: '', price: product.rate || '' };
          return acc;
        }, {}));
        setHistory([]);
        return;
      }
      const savedRows = regionalRes.data || [];
      const byProduct = {};
      savedRows.forEach(row => {
        const current = byProduct[row.product_id] || { quantity: 0, value: 0, existing: false, count: 0, id: null };
        const quantity = Number(row.quantity) || 0;
        const value = Number(row.value) || quantity * (Number(row.price) || 0);
        byProduct[row.product_id] = {
          quantity: current.quantity + quantity,
          value: current.value + value,
          existing: true,
          count: current.count + 1,
          id: current.count === 0 ? row.id : null,
        };
      });
      setProducts(productList);
      setRows(productList.reduce((acc, product) => {
        const saved = byProduct[product.id];
        const weeklyQuantity = saved?.quantity || 0;
        const weeklyValue = saved?.value || 0;
        const previousProduct = earlierWeekRows
          .filter(row => row.product_id === product.id)
          .reduce((totals, row) => ({
            qty: totals.qty + (Number(row.quantity) || 0),
            value: totals.value + (Number(row.value) || 0),
          }), { qty: 0, value: 0 });
        const price = weeklyQuantity ? saved.value / weeklyQuantity : product.rate || '';
        acc[product.id] = {
          quantity: isCumulativeWeeklyMonth ? (previousProduct.qty + weeklyQuantity) || '' : weeklyQuantity || '',
          value: isCumulativeWeeklyMonth ? (previousProduct.value + weeklyValue) || '' : '',
          price,
          existing: Boolean(saved?.existing),
          id: saved?.count === 1 ? saved.id : null,
        };
        return acc;
      }, {}));
      setEditingRegionalRows({});
      setDirtyRegionalRows({});
      setHistory(savedRows);
    }).catch(() => setError('Unable to load regional sales.'))
      .finally(() => setLoading(false));
  }, [me?.id, me?.state, me?.city, me?.role, salesYear, salesMonth, activeSalesWeek, isWeeklyRegionalMonth, isCumulativeWeeklyMonth, regionalStateFilter, regionalCityFilter, shouldDefaultToEntryLocation, regionalSelectionTouched, stateCode, city, regionalAccess, visibleRegionalTerritories]);

  useEffect(() => { loadRegional(); }, [loadRegional]);

  const loadRegionalPdfs = useCallback(() => {
    if (!me?.id || !isCumulativeWeeklyMonth || stateCode === 'ALL' || city === 'ALL') {
      setRegionalPdfs([]);
      return;
    }
    salesAPI.regionalWeekPdfs({
      viewer_id: me.id,
      associate_id: me.id,
      state_code: stateCode,
      city,
      year: salesYear,
      month: salesMonth,
      week,
    }).then(response => {
      setRegionalPdfs(Array.isArray(response.data) ? response.data : []);
      setRegionalPdfError('');
    }).catch(error => {
      setRegionalPdfs([]);
      setRegionalPdfError(error?.response?.data?.detail || 'Unable to load weekly PDFs.');
    });
  }, [me?.id, isCumulativeWeeklyMonth, stateCode, city, salesYear, salesMonth, week]);

  useEffect(() => { loadRegionalPdfs(); }, [loadRegionalPdfs]);

  const updateRow = (productId, field, value) => {
    setRows(prev => ({
      ...prev,
      [productId]: { ...(prev[productId] || {}), [field]: value },
    }));
    setDirtyRegionalRows(prev => ({ ...prev, [productId]: true }));
  };

  const entries = products.map(product => {
    const row = rows[product.id] || {};
    const cumulativeQuantity = Number(row.quantity) || 0;
    const previousProduct = Object.values(weekContext.weeksByProduct || {}).reduce((totals, weekProducts) => {
      const previous = weekProducts?.[product.id] || {};
      totals.qty += Number(previous.qty) || 0;
      totals.value += Number(previous.value) || 0;
      return totals;
    }, { qty: 0, value: 0 });
    const belowPrevious = isCumulativeWeeklyMonth && cumulativeQuantity < previousProduct.qty;
    const quantity = isCumulativeWeeklyMonth
      ? belowPrevious ? 0 : Math.max(0, cumulativeQuantity - previousProduct.qty)
      : cumulativeQuantity;
    const price = Number(row.price) || Number(product.rate) || 0;
    const value = quantity * price;
    const cumulativeValue = isCumulativeWeeklyMonth
      ? previousProduct.value + value
      : value;
    return {
      product,
      cumulativeQuantity,
      cumulativeValue,
      previousQuantity: previousProduct.qty,
      previousValue: previousProduct.value,
      quantity,
      price,
      value,
      belowPrevious,
    };
  });
  const totalQty = entries.reduce((sum, row) => sum + row.quantity, 0);
  const totalValue = entries.reduce((sum, row) => sum + row.value, 0);
  const entryByProduct = new Map(entries.map(entry => [entry.product.id, entry]));
  const showPreviousWeekProductData = isWeeklyRegionalMonth && week > 1;
  const previousWeekNumbers = showPreviousWeekProductData
    ? Array.from({ length: week - 1 }, (_, index) => index + 1)
    : [];
  const regionalGridTemplate = isCumulativeWeeklyMonth
    ? `minmax(190px, 1.5fr) ${previousWeekNumbers.map(() => '125px').join(' ')} 120px 135px 110px 140px 86px`
    : showPreviousWeekProductData
      ? `minmax(190px, 1.5fr) ${previousWeekNumbers.map(() => '125px').join(' ')} 120px 120px 130px 86px`
      : 'minmax(190px, 1.5fr) 120px 120px 130px 86px';
  const regionalGridMinWidth = isCumulativeWeeklyMonth
    ? 780 + (previousWeekNumbers.length * 125)
    : showPreviousWeekProductData ? 650 + (previousWeekNumbers.length * 125) : 650;
  const regionalHeaders = isCumulativeWeeklyMonth
    ? ['Product', ...previousWeekNumbers.map(previousWeek => `Week ${previousWeek}`), 'Cumulative Qty', 'Rate', 'Cumulative Value', `Week ${week} Result`, 'Action']
    : isLegacyJulyWeeklyMonth
      ? ['Product', ...previousWeekNumbers.map(previousWeek => `Week ${previousWeek}`), `Week ${week} Qty`, 'Rate', `Week ${week} Total`, 'Action']
      : ['Product', 'Qty', 'Rate', 'Total', 'Action'];
  const pendingRows = entries.filter(row => {
    const saved = rows[row.product.id] || {};
    return Boolean(dirtyRegionalRows[row.product.id]) || (!saved.existing && row.quantity > 0);
  });
  const allStateOptions = Object.values(locations.reduce((acc, loc) => {
    const name = loc.state_name || toStateName(loc.state_code);
    acc[name] = acc[name] || { state_code: loc.state_code, state_name: name, count: 0 };
    acc[name].count += loc.count || 1;
    return acc;
  }, {})).sort((a, b) => a.state_name.localeCompare(b.state_name));
  const visibleRegionalStateNames = new Set(
    visibleRegionalTerritories.map(territory => REGIONAL_TERRITORY_STATES[territory]).filter(Boolean)
  );
  const availableStateOptions = Object.values(visibleRegionalTerritories.reduce((acc, territory) => {
    const stateName = REGIONAL_TERRITORY_STATES[territory];
    if (stateName && !acc[stateName]) {
      acc[stateName] = allStateOptions.find(option => option.state_name === stateName)
        || { state_code: stateName, state_name: stateName, count: 0 };
    }
    return acc;
  }, allStateOptions.reduce((acc, option) => ({ ...acc, [option.state_name]: option }), {})))
    .sort((a, b) => a.state_name.localeCompare(b.state_name));
  const stateOptions = regionalAccess.can_view_all
    ? availableStateOptions
    : availableStateOptions.filter(option => visibleRegionalStateNames.has(option.state_name));
  const cityCounts = locations
    .filter(loc => stateCode === 'ALL' || toStateName(loc.state_code) === toStateName(stateCode))
    .reduce((acc, loc) => {
      if (loc.city) acc[loc.city] = (acc[loc.city] || 0) + (loc.count || 1);
      return acc;
    }, {});
  const cityEntries = stateCode === 'ALL'
    ? []
    : toStateName(stateCode) === 'Tamil Nadu'
      ? TAMIL_NADU_REGIONAL_CITIES
        .filter(cityName => regionalAccess.can_view_all || visibleRegionalTerritorySet.has(cityName))
        .map(cityName => [cityName, null])
      : visibleRegionalTerritories
        .filter(territory => REGIONAL_TERRITORY_STATES[territory] === toStateName(stateCode))
        .map(territory => [territory, cityCounts[territory] ?? null]);
  const topCities = cityEntries.slice(0, 5);
  const extraCities = cityEntries.slice(5);
  const goSalesMonth = delta => {
    let y = salesYear;
    let m = salesMonth + delta;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    if (y > CUR_YEAR || (y === CUR_YEAR && m > CUR_MONTH)) return;
    setSalesYear(y);
    setSalesMonth(m);
  };

  const saveRegionalSales = async () => {
    if (!me?.id) return;
    if (stateCode === 'ALL' || city === 'ALL' || !stateCode || !city) {
      setError('Select state and city before saving regional sales.');
      return;
    }
    const payloadRows = entries
      .filter(row => {
        const saved = rows[row.product.id] || {};
        return Boolean(dirtyRegionalRows[row.product.id]) || (!saved.existing && row.quantity > 0);
      })
      .map(row => ({
        id: rows[row.product.id]?.id || undefined,
        product_id: row.product.id,
        quantity: row.quantity,
        price: row.quantity > 0 ? row.price : 0,
      }));
    if (!payloadRows.length) {
      setError(isCumulativeWeeklyMonth ? 'Enter cumulative quantity for at least one product.' : 'Enter quantity for at least one product.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await salesAPI.submitRegional({ associate_id: me.id, state_code: stateCode, city, year: salesYear, month: salesMonth, week: activeSalesWeek, entries: payloadRows });
      setMessage(`${res.data?.entries_saved || 0} ${isWeeklyRegionalMonth ? `Week ${week}` : 'full-month'} regional sales rows saved.`);
      if (regionalDraftKey) removeDraft(regionalDraftKey);
      setRegionalDraftStatus('');
      setEditingRegionalRows({});
      setDirtyRegionalRows({});
      loadRegional();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to save regional sales.');
    } finally {
      setSaving(false);
    }
  };

  const uploadRegionalWeekPdfs = async files => {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length || !me?.id) return;
    if (pendingRows.length > 0) {
      setRegionalPdfError('Save the current regional sales entries before uploading more reports.');
      return;
    }
    setRegionalPdfBusy(true);
    setRegionalPdfError('');
    try {
      const extractedByProduct = {};
      const matchedLines = [];
      const unmatchedLines = [];
      let sourceTotalSum = 0;
      let matchedTotalSum = 0;
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append('associate_id', me.id);
        formData.append('state_code', stateCode);
        formData.append('city', city);
        formData.append('year', salesYear);
        formData.append('month', salesMonth);
        formData.append('week', week);
        formData.append('file', file);
        const response = await salesAPI.uploadRegionalWeekPdf(formData);
        const parsedEntries = Array.isArray(response.data?.parsed_entries) ? response.data.parsed_entries : [];
        const unmatchedItems = Array.isArray(response.data?.unmatched_items) ? response.data.unmatched_items : [];
        sourceTotalSum += Number(response.data?.source_total) || 0;
        matchedTotalSum += Number(response.data?.matched_total) || 0;
        parsedEntries.forEach(entry => {
          const productId = Number(entry.product_id);
          const current = extractedByProduct[productId] || { quantity: 0, price: 0 };
          extractedByProduct[productId] = {
            quantity: current.quantity + (Number(entry.quantity) || 0),
            price: Number(entry.price) || current.price,
          };
          matchedLines.push({ ...entry, file: file.name });
        });
        unmatchedItems.forEach(item => unmatchedLines.push({ ...item, file: file.name }));
      }
      setExtractedReport(
        (matchedLines.length || unmatchedLines.length)
          ? { matched: matchedLines, unmatched: unmatchedLines, sourceTotal: sourceTotalSum, matchedTotal: matchedTotalSum, files: selectedFiles.length }
          : null
      );
      const extractedEntries = Object.entries(extractedByProduct);
      if (extractedEntries.length) {
        setRows(prev => extractedEntries.reduce((next, [productId, entry]) => ({
          ...next,
          [productId]: {
            ...(next[productId] || {}),
            quantity: entry.quantity,
            price: entry.price || next[productId]?.price || '',
          },
        }), { ...prev }));
        setDirtyRegionalRows(prev => extractedEntries.reduce((next, [productId]) => ({
          ...next,
          [productId]: true,
        }), prev));
      }
      setMessage(extractedEntries.length
        ? `${selectedFiles.length} Week ${week} report${selectedFiles.length === 1 ? '' : 's'} uploaded. ${extractedEntries.length} product row${extractedEntries.length === 1 ? '' : 's'} filled from the report; review and save them.`
        : `${selectedFiles.length} report${selectedFiles.length === 1 ? '' : 's'} uploaded, but no product rows could be read. Check the report columns or use a clearer image.`);
      loadRegionalPdfs();
    } catch (error) {
      setRegionalPdfError(error?.response?.data?.detail || 'Unable to upload and validate the weekly report.');
    } finally {
      setRegionalPdfBusy(false);
    }
  };

  const resetRegionalMonth = async () => {
    if (!me?.id || isAggregateRegionalView) return;
    const confirmation = window.prompt(
      `Warning: all regional sales data for ${city}, ${toStateName(stateCode)} in ${MONTHS[salesMonth]} ${salesYear} will be reset to zero. This cannot be undone.\n\nType RESET MONTH to continue.`
    );
    if (confirmation === null) return;
    if (confirmation.trim().toUpperCase() !== 'RESET MONTH') {
      setError('Reset cancelled. Type RESET MONTH exactly to confirm.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await salesAPI.regional(me.id, salesYear, salesMonth, null, regionalStateFilter, regionalCityFilter);
      const monthRows = (res.data || []).filter(row => Number(row.quantity) > 0 || Number(row.value) > 0);
      const byWeek = monthRows.reduce((acc, row) => {
        const wk = Number(row.week) || 0;
        acc[wk] = acc[wk] || [];
        acc[wk].push({ id: row.id, product_id: row.product_id, quantity: 0, price: 0 });
        return acc;
      }, {});
      const weeks = Object.keys(byWeek).map(Number);
      if (!weeks.length) {
        setMessage(`No regional sales found to reset for ${MONTHS[salesMonth]} ${salesYear}.`);
        return;
      }
      await Promise.all(weeks.map(wk => salesAPI.submitRegional({
        associate_id: me.id,
        state_code: stateCode,
        city,
        year: salesYear,
        month: salesMonth,
        week: wk,
        entries: byWeek[wk],
      })));
      setMessage(`Regional sales reset for ${city}, ${toStateName(stateCode)} · ${MONTHS[salesMonth]} ${salesYear}.`);
      if (regionalDraftKey) removeDraft(regionalDraftKey);
      setRegionalDraftStatus('');
      setRows(prev => Object.fromEntries(Object.entries(prev).map(([productId, row]) => [productId, {
        ...row,
        quantity: '',
        value: '',
        price: row.price || '',
        existing: false,
        id: null,
      }])));
      setEditingRegionalRows({});
      setDirtyRegionalRows({});
      loadRegional();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to reset regional sales for this month.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '16px 24px 40px' }}>
      <div style={{
        background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
        borderRadius: '0 0 20px 20px',
        padding: '18px 22px 20px',
        color: '#fff',
        margin: '-16px -24px 14px',
        boxShadow: '0 8px 28px rgba(15,32,39,0.32)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -44, right: -40, width: 180, height: 180,
          borderRadius: '50%', background: 'rgba(61,140,64,0.18)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 8, right: 126, width: 78, height: 78,
          borderRadius: '50%', background: 'rgba(245,184,0,0.12)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>Regional Sales</div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 3 }}>Product-wise sales by region · week-wise quantity and price</div>
            {regionalDraftStatus && <div style={{ fontSize: 10, color: '#86efac', fontWeight: 800, marginTop: 4 }}>✓ {regionalDraftStatus}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button onClick={resetRegionalMonth} disabled={saving || loading || isAggregateRegionalView}
              title={isAggregateRegionalView ? 'Select a specific state and city to reset regional sales.' : 'Reset the selected month after typed confirmation'}
              style={{ padding: '9px 15px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.28)', background: (saving || isAggregateRegionalView) ? 'rgba(255,255,255,0.12)' : 'rgba(248,113,113,0.22)', color: '#fff', cursor: (saving || isAggregateRegionalView) ? 'default' : 'pointer', fontWeight: 900 }}>
              Reset Month
            </button>
            <button onClick={saveRegionalSales} disabled={saving || loading || isAggregateRegionalView || pendingRows.length === 0}
              title={isAggregateRegionalView ? 'Select a specific state and city to save regional sales.' : pendingRows.length === 0 ? 'Click Edit on a saved row or enter a new row before saving.' : 'Save regional sales'}
              style={{ padding: '9px 15px', borderRadius: 9, border: 'none', background: (saving || isAggregateRegionalView || pendingRows.length === 0) ? '#9ca3af' : '#0F6E56', color: '#fff', cursor: (saving || isAggregateRegionalView || pendingRows.length === 0) ? 'default' : 'pointer', fontWeight: 900 }}>
              {saving ? 'Saving...' : 'Save Regional Sales'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.12)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', overflow: 'hidden' }}>
              <button onClick={() => goSalesMonth(-1)}
                style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18, padding: '8px 14px', lineHeight: 1, opacity: 0.85 }}>
                ‹
              </button>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', minWidth: 112, textAlign: 'center', padding: '0 4px' }}>
                {MONTHS[salesMonth]} {salesYear}
              </span>
              <button onClick={() => goSalesMonth(1)}
                disabled={salesYear === CUR_YEAR && salesMonth === CUR_MONTH}
                style={{ background: 'none', border: 'none', color: '#fff',
                  cursor: (salesYear === CUR_YEAR && salesMonth === CUR_MONTH) ? 'not-allowed' : 'pointer',
                  fontSize: 18, padding: '8px 14px', lineHeight: 1,
                  opacity: (salesYear === CUR_YEAR && salesMonth === CUR_MONTH) ? 0.25 : 0.85 }}>
                ›
              </button>
            </div>
            <span style={{ width: '100%' }} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', width: '100%', maxWidth: '100%' }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase', marginRight: 2 }}>Region</span>
              {canUseAggregateRegionalView && (
                <button onClick={() => {
                  setRegionalSelectionTouched(true);
                  setStateCode('ALL');
                  setCity('ALL');
                }}
                  style={{
                    padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                    border: stateCode === 'ALL' ? '2px solid #F5B800' : '2px solid rgba(255,255,255,0.15)',
                    background: stateCode === 'ALL' ? '#F5B800' : 'rgba(255,255,255,0.08)',
                    color: stateCode === 'ALL' ? '#0B1E10' : 'rgba(255,255,255,0.75)',
                    boxShadow: stateCode === 'ALL' ? '0 2px 12px rgba(245,184,0,0.35)' : 'none',
                  }}>
                  All
                </button>
              )}
              {stateOptions.map(st => {
                const active = toStateName(stateCode) === st.state_name;
                const regionAccents = { 'Tamil Nadu': '#F97316', 'Kerala': '#10B981', 'Telangana': '#8B5CF6', 'Karnataka': '#EF4444', 'Maharashtra': '#3B82F6' };
                const ac = regionAccents[st.state_name] || '#F5B800';
                return (
                  <button key={st.state_name} onClick={() => {
                    const firstCity = visibleRegionalTerritories.find(
                      territory => REGIONAL_TERRITORY_STATES[territory] === st.state_name
                    ) || locations.find(loc => toStateName(loc.state_code) === st.state_name)?.city || '';
                    setRegionalSelectionTouched(true);
                    setStateCode(st.state_code);
                    setCity(canUseAggregateRegionalView ? 'ALL' : firstCity);
                  }}
                    style={{
                      padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                      border: active ? `2px solid ${ac}` : '2px solid rgba(255,255,255,0.15)',
                      background: active ? ac : 'rgba(255,255,255,0.08)',
                      color: active ? '#fff' : 'rgba(255,255,255,0.75)',
                      boxShadow: active ? `0 2px 12px ${ac}55` : 'none',
                    }}>
                    {st.state_name}
                  </button>
                );
              })}
              <div style={{ display: 'flex', gap: 5, flexWrap: 'nowrap', alignItems: 'center', overflowX: 'auto', whiteSpace: 'nowrap', width: '100%', paddingBottom: 2 }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase', marginRight: 2, flex: '0 0 auto' }}>City</span>
                {canUseAggregateRegionalView && (
                  <button onClick={() => {
                    setRegionalSelectionTouched(true);
                    setCity('ALL');
                  }}
                    style={{
                      padding: '4px 11px', borderRadius: 20, fontSize: 10, fontWeight: 800, cursor: 'pointer',
                      border: city === 'ALL' ? '2px solid #F5B800' : '2px solid rgba(255,255,255,0.12)',
                      background: city === 'ALL' ? '#F5B800' : 'rgba(255,255,255,0.07)',
                      color: city === 'ALL' ? '#0B1E10' : 'rgba(255,255,255,0.7)',
                      flex: '0 0 auto',
                    }}>
                    All
                  </button>
                )}
                {topCities.map(([ct, count]) => {
                  const active = city === ct;
                  return (
                    <button key={ct} onClick={() => {
                      setRegionalSelectionTouched(true);
                      setCity(ct);
                    }}
                      style={{
                        padding: '4px 11px', borderRadius: 20, fontSize: 10, fontWeight: 800, cursor: 'pointer',
                        border: active ? '2px solid #3D8C40' : '2px solid rgba(255,255,255,0.12)',
                        background: active ? '#3D8C40' : 'rgba(255,255,255,0.07)',
                        color: active ? '#fff' : 'rgba(255,255,255,0.7)',
                        flex: '0 0 auto',
                      }}>
                      {ct} {count !== null && <span style={{ opacity: 0.65 }}>({count})</span>}
                    </button>
                  );
                })}
                {extraCities.length > 0 && (
                  <select value="" onChange={e => {
                    if (e.target.value) {
                      setRegionalSelectionTouched(true);
                      setCity(e.target.value);
                    }
                  }}
                    style={{ padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800, cursor: 'pointer', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '2px solid rgba(255,255,255,0.15)', flex: '0 0 auto' }}>
                    <option value="" style={{ color: '#000' }}>+{extraCities.length} more...</option>
                    {extraCities.map(([ct, count]) => <option key={ct} value={ct} style={{ color: '#000' }}>{ct} ({count})</option>)}
                  </select>
                )}
              </div>
            </div>
            <span style={{ width: '100%' }} />
            {isWeeklyRegionalMonth ? (
              <>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase', marginRight: 2 }}>Week</span>
                {[1, 2, 3, 4].map(w => (
                  <button key={w} onClick={() => setWeek(w)}
                    style={{ padding: '5px 14px', borderRadius: 20, fontSize: 11, border: week === w ? '2px solid #F5B800' : '2px solid rgba(255,255,255,0.12)', background: week === w ? '#F5B800' : 'rgba(255,255,255,0.07)', cursor: 'pointer', fontWeight: 800, color: week === w ? '#0B1E10' : 'rgba(255,255,255,0.72)', boxShadow: week === w ? '0 2px 12px rgba(245,184,0,0.3)' : 'none' }}>
                    Week {w}
                  </button>
                ))}
              </>
            ) : (
              <div style={{ padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 800, border: '2px solid rgba(245,184,0,0.35)', background: 'rgba(245,184,0,0.16)', color: '#F5B800' }}>
                Full month entry
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          {[
            ['Consolidated Sales', fmtInr(consolidated.value), '#8B5CF6'],
            [`${MONTHS[salesMonth]} · All Weeks`, fmtInr(monthlyConsolidated.value), '#0F766E'],
            ['Products', products.length, '#3B82F6'],
            ['Total Qty', totalQty.toLocaleString('en-IN'), '#10B981'],
            ['Total Value', fmtInr(totalValue), '#F59E0B'],
          ].map(([label, value, color]) => (
            <div key={label} style={{
              background: `linear-gradient(135deg, ${color}ee 0%, ${color}bb 100%)`,
              border: `1px solid ${color}44`,
              borderRadius: 14,
              padding: '13px 16px',
              minWidth: 140,
              color: '#fff',
              boxShadow: `0 4px 20px ${color}55`,
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', width: 52, height: 52, borderRadius: '50%', right: -14, top: -18, background: 'rgba(255,255,255,0.16)' }} />
              <div style={{ fontSize: 10, opacity: 0.78, fontWeight: 800, textTransform: 'uppercase', position: 'relative' }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 900, position: 'relative' }}>{value}</div>
            </div>
          ))}
        </div>
        </div>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, padding: 12, marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 10, padding: 12, marginBottom: 12 }}>{message}</div>}
      {!loading && !locations.length && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          No state/city found in the customer master for your visible doctors.
        </div>
      )}
      {!loading && locations.length > 0 && isAggregateRegionalView && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13, fontWeight: 700 }}>
          Consolidated view is read-only. Select a specific region and city to enter sales.
        </div>
      )}
      {!loading && isWeeklyRegionalMonth && !isAggregateRegionalView && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13 }}>
          {isCumulativeWeeklyMonth ? (
            <>Enter only the <strong>cumulative quantity</strong> shown in the Week {week} PDF. The Product Master rate fills automatically, the value is calculated for you, and earlier weeks are subtracted product-wise.</>
          ) : (
            <>July data remains unchanged. Enter and edit the <strong>Week {week} quantity and rate</strong> directly; no cumulative subtraction is applied.</>
          )}
        </div>
      )}
      {!loading && isWeeklyRegionalMonth && week > 1 && !isAggregateRegionalView && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 12 }}>
          {[
            {
              label: `Week ${week - 1} saved`,
              qty: weekContext.previousWeek.qty,
              value: weekContext.previousWeek.value,
              background: '#eff6ff',
              border: '#bfdbfe',
              color: '#1e40af',
            },
            {
              label: `Weeks 1–${week - 1} total`,
              qty: weekContext.earlierWeeks.qty,
              value: weekContext.earlierWeeks.value,
              background: '#f5f3ff',
              border: '#ddd6fe',
              color: '#6d28d9',
            },
            {
              label: `Through Week ${week}`,
              qty: weekContext.earlierWeeks.qty + totalQty,
              value: weekContext.earlierWeeks.value + totalValue,
              background: '#ecfdf5',
              border: '#a7f3d0',
              color: '#047857',
            },
          ].map(item => (
            <div key={item.label} style={{ background: item.background, border: `1px solid ${item.border}`, borderRadius: 12, padding: '11px 13px' }}>
              <div style={{ fontSize: 10, fontWeight: 900, color: item.color, textTransform: 'uppercase', letterSpacing: 0.5 }}>{item.label}</div>
              <div style={{ marginTop: 5, fontSize: 14, fontWeight: 900, color: item.color }}>{item.qty.toLocaleString('en-IN')} qty · {fmtInr(item.value)}</div>
            </div>
          ))}
        </div>
      )}
      {entries.some(entry => entry.belowPrevious) && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13 }}>
          Some cumulative quantities are below the earlier-weeks total. Their current-week result has been set to zero.
        </div>
      )}
      {!loading && isCumulativeWeeklyMonth && !isAggregateRegionalView && (
        <div style={{ marginBottom: 12, padding: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#111827' }}>Week {week} Sales Reports</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>Upload PDF, Excel, JPG, PNG, or WebP reports. Extracted quantities and rates are filled below for review and saving.</div>
            </div>
            <label style={{ padding: '8px 13px', borderRadius: 9, background: regionalPdfBusy || pendingRows.length > 0 ? '#9ca3af' : '#1d4ed8', color: '#fff', fontSize: 11, fontWeight: 900, cursor: regionalPdfBusy || pendingRows.length > 0 ? 'default' : 'pointer' }}>
              {regionalPdfBusy ? 'Uploading…' : '+ Upload Files'}
              <input type="file" accept="application/pdf,.pdf,.xlsx,.xls,image/png,image/jpeg,image/webp" multiple disabled={regionalPdfBusy || pendingRows.length > 0}
                onChange={event => {
                  uploadRegionalWeekPdfs(event.target.files);
                  event.target.value = '';
                }}
                style={{ display: 'none' }} />
            </label>
          </div>
          {regionalPdfError && <div style={{ marginTop: 9, color: '#dc2626', fontSize: 11, fontWeight: 700 }}>{regionalPdfError}</div>}

          {extractedReport && (
            <div style={{ marginTop: 11, border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 11px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: '#111827' }}>
                  Products read from {extractedReport.files} file{extractedReport.files === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: 10, color: '#6b7280' }}>
                  Report total {fmtInr(extractedReport.sourceTotal)} · Matched {fmtInr(extractedReport.matchedTotal)}
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: '#fff' }}>
                      <th style={{ textAlign: 'left', padding: '6px 9px', color: '#6b7280', fontWeight: 700, borderBottom: '1px solid #e5e7eb' }}>Product in file</th>
                      <th style={{ textAlign: 'left', padding: '6px 9px', color: '#6b7280', fontWeight: 700, borderBottom: '1px solid #e5e7eb' }}>Mapped to</th>
                      <th style={{ textAlign: 'right', padding: '6px 9px', color: '#6b7280', fontWeight: 700, borderBottom: '1px solid #e5e7eb' }}>Qty</th>
                      <th style={{ textAlign: 'right', padding: '6px 9px', color: '#6b7280', fontWeight: 700, borderBottom: '1px solid #e5e7eb' }}>Price</th>
                      <th style={{ textAlign: 'right', padding: '6px 9px', color: '#6b7280', fontWeight: 700, borderBottom: '1px solid #e5e7eb' }}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extractedReport.matched.map((row, index) => (
                      <tr key={`m-${index}`} style={{ background: '#fff' }}>
                        <td style={{ padding: '6px 9px', color: '#111827', borderBottom: '1px solid #f3f4f6' }}>{row.source_name || row.product_name}</td>
                        <td style={{ padding: '6px 9px', color: '#047857', borderBottom: '1px solid #f3f4f6' }}>{row.product_name}</td>
                        <td style={{ padding: '6px 9px', textAlign: 'right', color: '#111827', borderBottom: '1px solid #f3f4f6' }}>{row.quantity}</td>
                        <td style={{ padding: '6px 9px', textAlign: 'right', color: '#111827', borderBottom: '1px solid #f3f4f6' }}>{fmtInr(row.price)}</td>
                        <td style={{ padding: '6px 9px', textAlign: 'right', color: '#111827', borderBottom: '1px solid #f3f4f6' }}>{fmtInr(row.value != null ? row.value : (Number(row.quantity) || 0) * (Number(row.price) || 0))}</td>
                      </tr>
                    ))}
                    {extractedReport.unmatched.map((row, index) => (
                      <tr key={`u-${index}`} style={{ background: '#fff7ed' }}>
                        <td style={{ padding: '6px 9px', color: '#111827', borderBottom: '1px solid #f3f4f6' }}>{row.source_name}</td>
                        <td style={{ padding: '6px 9px', color: '#c2410c', fontWeight: 700, borderBottom: '1px solid #f3f4f6' }}>Not in Product Master</td>
                        <td style={{ padding: '6px 9px', textAlign: 'right', color: '#111827', borderBottom: '1px solid #f3f4f6' }}>{row.quantity}</td>
                        <td style={{ padding: '6px 9px', textAlign: 'right', color: '#111827', borderBottom: '1px solid #f3f4f6' }}>{fmtInr(row.price)}</td>
                        <td style={{ padding: '6px 9px', textAlign: 'right', color: '#111827', borderBottom: '1px solid #f3f4f6' }}>{fmtInr(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {extractedReport.unmatched.length > 0 && (
                <div style={{ padding: '8px 11px', background: '#fff7ed', borderTop: '1px solid #fed7aa', fontSize: 10, color: '#9a3412' }}>
                  {extractedReport.unmatched.length} product{extractedReport.unmatched.length === 1 ? '' : 's'} in the report {extractedReport.unmatched.length === 1 ? 'is' : 'are'} not in the Product Master, so {extractedReport.unmatched.length === 1 ? 'it is' : 'they are'} not saved. {fmtInr(extractedReport.sourceTotal - extractedReport.matchedTotal)} of the report total is excluded.
                </div>
              )}
            </div>
          )}

          {regionalPdfs.length > 0 && (
            <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>
              {regionalPdfs.map(pdf => (
                <div key={pdf.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 10px', background: pdf.matches ? '#ecfdf5' : '#fff7ed', border: `1px solid ${pdf.matches ? '#a7f3d0' : '#fed7aa'}`, borderRadius: 9, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 900, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pdf.filename}</div>
                    <div style={{ fontSize: 10, color: pdf.matches ? '#047857' : '#c2410c', marginTop: 2 }}>
                      {pdf.matches ? 'Matched' : pdf.validation_status === 'unverified' ? 'Unverified — labelled total not found' : 'Mismatch'} · Report {pdf.pdf_total == null ? 'total not found' : fmtInr(pdf.pdf_total)} · Entered {fmtInr(pdf.entered_total)}
                    </div>
                  </div>
                  <button onClick={async () => {
                    const response = await salesAPI.downloadRegionalWeekPdf(me.id, pdf.id);
                    const url = URL.createObjectURL(response.data);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = pdf.filename || `regional-sales-week-${week}.pdf`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                    style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', textDecoration: 'none', fontSize: 10, fontWeight: 900 }}>
                    Download
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: regionalGridTemplate, minWidth: regionalGridMinWidth, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: 11, fontWeight: 900, color: '#4b5563', textTransform: 'uppercase' }}>
          {regionalHeaders.map(label => <div key={label} style={{ padding: '10px 12px' }}>{label}</div>)}
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Loading products...</div>
        ) : products.map(product => {
          const row = rows[product.id] || {};
          const calculated = entryByProduct.get(product.id) || { quantity: 0, value: 0, price: 0, belowPrevious: false };
          const quantity = calculated.quantity;
          const price = calculated.price;
          const editing = Boolean(editingRegionalRows[product.id]);
          const isLockedSavedRow = Boolean(row.existing) && !editing;
          const inputDisabled = isAggregateRegionalView || isLockedSavedRow;
          return (
            <div key={product.id} style={{ display: 'grid', gridTemplateColumns: regionalGridTemplate, minWidth: regionalGridMinWidth, alignItems: 'center', borderBottom: '1px solid #f3f4f6', background: isLockedSavedRow ? '#f9fafb' : '#fff' }}>
              <div style={{ padding: '10px 12px', minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name}</div>
                {(product.pack || product.composition) && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{[product.pack, product.composition].filter(Boolean).join(' | ')}</div>}
              </div>
              {previousWeekNumbers.map(previousWeek => {
                const previousProduct = weekContext.weeksByProduct?.[previousWeek]?.[product.id] || { qty: 0, value: 0 };
                return (
                  <div key={previousWeek} style={{ padding: '8px 12px', background: '#f8fafc', borderRight: '1px solid #eef2f7' }}>
                    <div style={{ fontSize: 13, fontWeight: 900, color: previousProduct.qty > 0 ? '#1e40af' : '#9ca3af' }}>{previousProduct.qty.toLocaleString('en-IN')} qty</div>
                    <div style={{ marginTop: 2, fontSize: 11, fontWeight: 700, color: previousProduct.value > 0 ? '#475569' : '#9ca3af' }}>{fmtInr(previousProduct.value)}</div>
                  </div>
                );
              })}
              <div style={{ padding: '10px 12px' }}>
                <input type="number" min="0" value={row.quantity || ''} onChange={e => updateRow(product.id, 'quantity', e.target.value)}
                  disabled={inputDisabled}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 9px', border: calculated.belowPrevious ? '1px solid #f59e0b' : '1px solid #d1d5db', borderRadius: 8, fontSize: 13, background: inputDisabled ? '#f3f4f6' : '#fff', color: inputDisabled ? '#6b7280' : '#111827' }} />
              </div>
              <div style={{ padding: '10px 12px' }}>
                <input type="number" min="0" value={row.price || ''}
                  onChange={e => updateRow(product.id, 'price', e.target.value)}
                  disabled={inputDisabled}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 9px', border: calculated.belowPrevious ? '1px solid #f59e0b' : '1px solid #d1d5db', borderRadius: 8, fontSize: 13, background: inputDisabled ? '#f3f4f6' : '#fff', color: inputDisabled ? '#6b7280' : '#111827' }} />
              </div>
              {isCumulativeWeeklyMonth && (
                <div style={{ padding: '10px 12px', color: calculated.cumulativeValue > 0 ? '#111827' : '#9ca3af' }}>
                  <div style={{ fontSize: 13, fontWeight: 900 }}>{fmtInr(calculated.cumulativeValue)}</div>
                  <div style={{ marginTop: 2, fontSize: 10, fontWeight: 700, color: '#6b7280' }}>calculated</div>
                </div>
              )}
              <div style={{ padding: '10px 12px', color: quantity || calculated.value ? '#0F6E56' : '#9ca3af' }}>
                {isCumulativeWeeklyMonth ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 900 }}>{quantity.toLocaleString('en-IN')} qty</div>
                    <div style={{ marginTop: 2, fontSize: 11, fontWeight: 800 }}>{fmtInr(calculated.value)}</div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, fontWeight: 900 }}>{fmtInr(quantity * price)}</div>
                )}
              </div>
              <div style={{ padding: '10px 12px' }}>
                {row.existing && !isAggregateRegionalView ? (
                  <button type="button"
                    onClick={() => setEditingRegionalRows(prev => ({ ...prev, [product.id]: !prev[product.id] }))}
                    disabled={saving}
                    style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: editing ? '1px solid #bbf7d0' : '1px solid #bfdbfe', background: editing ? '#f0fdf4' : '#eff6ff', color: editing ? '#166534' : '#1d4ed8', fontSize: 11, fontWeight: 900, cursor: saving ? 'default' : 'pointer' }}>
                    {editing ? 'Done' : 'Edit'}
                  </button>
                ) : (
                  <span style={{ color: '#d1d5db', fontSize: 12 }}>-</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {history.length > 0 && (
        <div style={{ marginTop: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 10 }}>Saved rows for {city === 'ALL' ? 'All cities' : city || 'City'}, {stateCode === 'ALL' ? 'All regions' : stateCode || 'State'} · {isWeeklyRegionalMonth ? `Week ${week}` : 'Full month'}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {history.filter(row => Number(row.quantity) > 0).slice(0, 16).map(row => (
              <div key={row.id} style={{ border: '1px solid #eef2f7', borderRadius: 8, padding: '8px 10px', background: '#f9fafb' }}>
                <div style={{ fontSize: 12, fontWeight: 800 }}>{row.product_name}</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{row.city}, {row.state_code} · {row.quantity} qty x {fmtInr(row.price)} = {fmtInr(row.value)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ROIDashboard({ defaultTab = 'roi' }) {
  const { user: me } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const initialRouteParams = new URLSearchParams(location.search);
  const requestedYear = Number(initialRouteParams.get('year'));
  const requestedMonth = Number(initialRouteParams.get('month'));
  const initialYear = Number.isInteger(requestedYear) && requestedYear >= 2020 ? requestedYear : CUR_YEAR;
  const initialMonth = Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12 ? requestedMonth : CUR_MONTH;
  const initialRegion = initialRouteParams.get('region') || 'ALL';
  const initialCity = initialRouteParams.get('city') || 'ALL';
  const requestedScope = initialRouteParams.get('scope');
  const routeScope = ['overall', 'mine', 'team'].includes(requestedScope) ? requestedScope : 'overall';
  const [year, setYear]     = useState(initialYear);
  const [month, setMonth]   = useState(initialMonth);
  const [doctors, setDoctors]   = useState([]);
  const [summary, setSummary]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [gradeFilter, setGradeFilter] = useState('All');
  const [modelFilter, setModelFilter] = useState('All');
  const [roiStateCode, setRoiStateCode] = useState(initialRegion);
  const [roiCity, setRoiCity] = useState(initialCity);
  const [activityFilter, setActivityFilter] = useState('all');
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [addInvDoctor,  setAddInvDoctor]  = useState(null);
  const [addBizDoctor,  setAddBizDoctor]  = useState(null);
  const [refreshKey,    setRefreshKey]    = useState(0);
  const [workTab,       setWorkTab]       = useState(defaultTab);

  const goRoiMonth = (delta) => {
    let nextYear = year;
    let nextMonth = month + delta;
    if (nextMonth < 1) { nextMonth = 12; nextYear -= 1; }
    if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
    if (nextYear > CUR_YEAR || (nextYear === CUR_YEAR && nextMonth > CUR_MONTH)) return;
    setYear(nextYear);
    setMonth(nextMonth);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (['roi', 'my_sales', 'regional_sales'].includes(tab)) {
      setWorkTab(tab);
    } else {
      setWorkTab(defaultTab);
    }
    const routeYear = Number(params.get('year'));
    const routeMonth = Number(params.get('month'));
    if (Number.isInteger(routeYear) && routeYear >= 2020) setYear(routeYear);
    if (Number.isInteger(routeMonth) && routeMonth >= 1 && routeMonth <= 12) setMonth(routeMonth);
    setRoiStateCode(params.get('region') || 'ALL');
    setRoiCity(params.get('city') || 'ALL');
  }, [defaultTab, location.search]);

  // Inline investment form
  const [showForm,    setShowForm]    = useState(false);
  const [showGuide,   setShowGuide]   = useState(false);
  const [expandDoctors, setExpandDoctors] = useState(false);
  const [invForm,     setInvForm]     = useState(EMPTY_INV);
  const [myDoctors,   setMyDoctors]   = useState([]);
  const [docSearch,   setDocSearch]   = useState('');
  const [selDoc,      setSelDoc]      = useState(null);
  const [invSaving,   setInvSaving]   = useState(false);
  const [invError,    setInvError]    = useState('');
  const [invSuccess,  setInvSuccess]  = useState('');
  const [investmentDraftStatus, setInvestmentDraftStatus] = useState('');
  const [myInvestments, setMyInvestments] = useState([]);
  const [editingInvestmentId, setEditingInvestmentId] = useState(null);
  const [deletingInvestmentId, setDeletingInvestmentId] = useState(null);
  const investmentFormRef = useRef(null);
  const investmentAmountRef = useRef(null);
  const investmentDraftLoadedRef = useRef(false);
  const investmentDraftKey = me?.id ? draftKey('investment', [me.id]) : '';

  useEffect(() => {
    if (!investmentDraftKey || investmentDraftLoadedRef.current) return;
    investmentDraftLoadedRef.current = true;
    const draft = readDraft(investmentDraftKey);
    if (!draft?.invForm) return;
    setInvForm({ ...EMPTY_INV, ...draft.invForm });
    setSelDoc(draft.selDoc || null);
    setShowForm(true);
    setInvestmentDraftStatus('Unsaved draft restored from this device');
  }, [investmentDraftKey]);

  useEffect(() => {
    const hasDraftData = invForm.doctor_id || invForm.amount || invForm.purpose || invForm.commercial_model_type;
    if (!investmentDraftKey || !showForm || editingInvestmentId || !hasDraftData) return undefined;
    const timer = setTimeout(() => {
      if (writeDraft(investmentDraftKey, { invForm, selDoc })) {
        setInvestmentDraftStatus('Draft saved on this device');
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [investmentDraftKey, showForm, editingInvestmentId, invForm, selDoc]);

  useEffect(() => {
    if (!editingInvestmentId) return;
    investmentFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    investmentAmountRef.current?.focus();
    investmentAmountRef.current?.select();
  }, [editingInvestmentId]);

  // Analytics panels
  const [spendData,    setSpendData]    = useState(null);
  const [riskData,     setRiskData]     = useState(null);
  const [commitmentData, setCommitmentData] = useState(null);
  const [analyticsTab, setAnalyticsTab] = useState('allocation'); // 'allocation' | 'spend' | 'risk'

  const load = useCallback(() => {
    if (!me?.id) return;
    setLoading(true);
    const params = { viewer_id: me.id };
    if (search)       params.search = search;
    if (gradeFilter !== 'All') params.grade = gradeFilter;
    if (modelFilter !== 'All') params.commercial_model = modelFilter;

    Promise.all([
      roiAPI.allDoctors(year, month, params),
      roiAPI.gradeSummary(year, month, params),
    ]).then(([dr, sr]) => {
      setDoctors(Array.isArray(dr.data) ? [...dr.data].sort(sortByActivity) : []);
      setSummary(Array.isArray(sr.data) ? sr.data : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [year, month, search, gradeFilter, modelFilter, refreshKey, me?.id]);

  useEffect(() => { load(); }, [load]);

  // Load doctors for inline form
  useEffect(() => {
    if (!me?.id) return;
    axios.get(`${API}/doctors/`, { params: { viewer_id: me.id, include_inactive: false } })
      .then(r => setMyDoctors(r.data))
      .catch(() => axios.get(`${API}/doctors/`).then(r => setMyDoctors(r.data)));
  }, [me?.id]);

  const loadMyInvestments = useCallback(() => {
    if (!me?.id) return;
    investmentsAPI.my(me.id, year, month)
      .then(response => setMyInvestments(Array.isArray(response.data) ? response.data : []))
      .catch(() => setMyInvestments([]));
  }, [me?.id, year, month]);

  useEffect(() => { loadMyInvestments(); }, [loadMyInvestments, refreshKey]);

  // Load analytics panels
  useEffect(() => {
    if (!me?.id) return;
    const params = { viewer_id: me.id };
    if (search) params.search = search;
    if (modelFilter !== 'All') params.commercial_model = modelFilter;
    roiAPI.spendAnalysis(year, month, { viewer_id: me.id })
      .then(r => setSpendData(normalizeSpendData(r.data))).catch(() => {});
    roiAPI.concentrationRisk(year, month, { viewer_id: me.id })
      .then(r => setRiskData(normalizeRiskData(r.data))).catch(() => {});
    roiAPI.commitmentRecovery(params)
      .then(r => setCommitmentData(r.data)).catch(() => setCommitmentData(null));
  }, [year, month, search, modelFilter, refreshKey, me?.id]);

  const matchesRouteScope = doctor => routeScope === 'mine'
    ? Number(doctor.manager_id) === Number(me?.id)
    : routeScope === 'team'
      ? Number(doctor.manager_id) !== Number(me?.id)
      : true;
  const scopedMyDoctors = myDoctors.filter(matchesRouteScope);
  const roiLocations = Object.values(scopedMyDoctors.reduce((acc, doctor) => {
    const stateCode = (doctor.state_code || '').trim();
    const cityName = groupedCityName(doctor);
    if (!stateCode || !cityName) return acc;
    const stateName = toStateName(stateCode);
    const key = `${stateName}__${cityName}`.toLowerCase();
    acc[key] = acc[key] || { state_code: stateCode, state_name: stateName, city: cityName, count: 0 };
    acc[key].count += 1;
    return acc;
  }, {})).sort((a, b) => `${a.state_name} ${a.city}`.localeCompare(`${b.state_name} ${b.city}`));

  const roiStateOptions = Object.values(roiLocations.reduce((acc, loc) => {
    acc[loc.state_name] = acc[loc.state_name] || { state_code: loc.state_code, state_name: loc.state_name, count: 0 };
    acc[loc.state_name].count += loc.count;
    return acc;
  }, {})).sort((a, b) => a.state_name.localeCompare(b.state_name));

  const roiCityOptions = Object.entries(roiLocations
    .filter(loc => roiStateCode === 'ALL' || loc.state_name === toStateName(roiStateCode))
    .reduce((acc, loc) => {
      acc[loc.city] = (acc[loc.city] || 0) + loc.count;
      return acc;
    }, {})).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topRoiCities = roiCityOptions.slice(0, 5);
  const extraRoiCities = roiCityOptions.slice(5);

  const doctorLocationMap = new Map(myDoctors.map(doctor => [doctor.id, doctor]));
  const matchesRoiLocation = doctor => {
    const locationDoctor = doctorLocationMap.get(doctor.doctor_id || doctor.id) || doctor;
    return matchesRouteScope(locationDoctor)
      && (roiStateCode === 'ALL' || toStateName(locationDoctor.state_code) === toStateName(roiStateCode))
      && (roiCity === 'ALL' || groupedCityName(locationDoctor) === roiCity);
  };
  const visibleMyInvestments = myInvestments.filter(investment => matchesRoiLocation({ doctor_id: investment.doctor_id }));

  const filteredFormDocs = scopedMyDoctors.filter(d =>
    matchesRoiLocation(d) && (
      !docSearch || d.name.toLowerCase().includes(docSearch.toLowerCase()) ||
      (d.city || '').toLowerCase().includes(docSearch.toLowerCase())
    )
  ).slice(0, 8);

  const selectDoc = (doc) => {
    setSelDoc(doc);
    setInvForm(f => ({ ...f, doctor_id: doc.id, expected_multiple: doc.expected_multiple || 5, commercial_model_type: f.commercial_model_type || doc.commercial_model || '' }));
    setDocSearch('');
  };

  const resetInvestmentForm = () => {
    if (investmentDraftKey) removeDraft(investmentDraftKey);
    setInvestmentDraftStatus('');
    setInvForm(EMPTY_INV);
    setSelDoc(null);
    setDocSearch('');
    setEditingInvestmentId(null);
    setShowForm(false);
    setInvError('');
  };

  const editInvestment = investment => {
    const doctor = myDoctors.find(row => row.id === investment.doctor_id) || {
      id: investment.doctor_id,
      name: investment.doctor_name,
      city: '',
      specialty: '',
      commercial_model: investment.doctor_commercial_model,
    };
    setEditingInvestmentId(investment.id);
    setSelDoc(doctor);
    setInvForm({
      doctor_id: investment.doctor_id,
      commercial_model_type: investment.commercial_model_type || investment.doctor_commercial_model || '',
      sub_category: investment.sub_category || '',
      week: investment.week || 1,
      amount: String(investment.amount ?? ''),
      purpose: investment.purpose || '',
      expected_multiple: investment.expected_multiple || 5,
    });
    setShowForm(true);
    setInvError('');
    setInvSuccess('');
  };

  const deleteInvestment = async investment => {
    if (!window.confirm(`Delete the ₹${Number(investment.amount || 0).toLocaleString('en-IN')} investment for ${investment.doctor_name}?`)) return;
    setDeletingInvestmentId(investment.id);
    setInvError('');
    setInvSuccess('');
    try {
      await investmentsAPI.delete(investment.id, me.id);
      if (editingInvestmentId === investment.id) {
        setEditingInvestmentId(null);
        setInvForm(EMPTY_INV);
        setSelDoc(null);
        setDocSearch('');
      }
      setInvSuccess(`Investment deleted for ${investment.doctor_name}.`);
      loadMyInvestments();
      setRefreshKey(key => key + 1);
      setTimeout(() => setInvSuccess(''), 4000);
    } catch (error) {
      setInvError(error?.response?.data?.detail || 'Unable to delete this investment.');
    } finally {
      setDeletingInvestmentId(null);
    }
  };

  const submitInvestment = async (e) => {
    e.preventDefault();
    if (!invForm.doctor_id || !invForm.amount) { setInvError('Doctor and amount are required'); return; }
    if (!invForm.commercial_model_type) { setInvError('Please select an investment type (U1–R1)'); return; }
    setInvSaving(true); setInvError('');
    try {
      const payload = {
        doctor_id: invForm.doctor_id,
        associate_id: me?.id || 1,
        year, month,
        week: invForm.week || 1,
        commercial_model_type: invForm.commercial_model_type,
        sub_category: invForm.sub_category || null,
        amount: Number(invForm.amount),
        expected_multiple: Number(invForm.expected_multiple) || 5,
        purpose: invForm.purpose || null,
      };
      if (editingInvestmentId) {
        await investmentsAPI.update(editingInvestmentId, payload);
        setInvSuccess(`Investment updated for ${selDoc?.name}. It will require approval again.`);
      } else {
        await investmentsAPI.submit(payload);
        setInvSuccess(`Investment of ₹${Number(invForm.amount).toLocaleString()} added for ${selDoc?.name}`);
      }
      resetInvestmentForm();
      loadMyInvestments();
      setTimeout(() => setInvSuccess(''), 4000);
      setRefreshKey(k => k + 1);
    } catch (err) {
      setInvError(err?.response?.data?.detail || 'Failed to save');
    } finally { setInvSaving(false); }
  };

  const selectedMonthIndex = (year * 12) + (month - 1);
  const sixMonthStart = new Date(year, month - 6, 1);
  const sixMonthStartYear = sixMonthStart.getFullYear();
  const sixMonthStartMonth = sixMonthStart.getMonth() + 1;
  const sixMonthWindowLabel = sixMonthStartYear === year
    ? `${MONTHS[sixMonthStartMonth]}–${MONTHS[month]} ${year}`
    : `${MONTHS[sixMonthStartMonth]} ${sixMonthStartYear}–${MONTHS[month]} ${year}`;
  const isInSixMonthWindow = row => {
    const rowMonthIndex = (Number(row.year) * 12) + (Number(row.month) - 1);
    return rowMonthIndex >= selectedMonthIndex - 5 && rowMonthIndex <= selectedMonthIndex;
  };
  const doctorsForSelectedMonth = doctors.map(doc => {
    const sixMonthInvestmentRows = (doc.investment_months || []).filter(isInSixMonthWindow);
    const sixMonthInvestmentCategories = (doc.investment_categories || []).filter(isInSixMonthWindow);
    const sixMonthSalesRows = (doc.sales_months || []).filter(isInSixMonthWindow);
    const sixMonthInvestment = sixMonthInvestmentRows
      .reduce((sum, row) => sum + toNum(row.amount), 0);
    const sales = sixMonthSalesRows.reduce((sum, row) => sum + toNum(row.amount), 0);
    const expectedMultiple = toNum(doc.expected_multiple) || 5;
    const expectedSales = sixMonthInvestment * expectedMultiple;
    const roiMultiple = sixMonthInvestment > 0 ? Math.round((sales / sixMonthInvestment) * 100) / 100 : 0;
    const roiGrade = sixMonthInvestment <= 0 || roiMultiple < 3
      ? 'Bronze'
      : roiMultiple > 8 ? 'Platinum' : roiMultiple >= 5 ? 'Gold' : 'Silver';
    const caPercent = expectedSales > 0 ? Math.round((sales / expectedSales) * 100) : 0;
    return {
      ...doc,
      cumulative_invested: toNum(doc.total_invested),
      investment_months: sixMonthInvestmentRows,
      investment_categories: sixMonthInvestmentCategories,
      sales_months: sixMonthSalesRows,
      total_invested: sixMonthInvestment,
      actual_sales: sales,
      total_sales: sales,
      expected_sales: expectedSales,
      roi_multiple: roiMultiple,
      roi_grade: roiGrade,
      ca_percent: caPercent,
      ca_status: caPercent >= 100 ? 'green' : caPercent >= 80 ? 'yellow' : 'red',
    };
  });

  const locationDoctors = doctorsForSelectedMonth.filter(matchesRoiLocation);
  const displayDoctors = locationDoctors.filter(doc => {
    if (activityFilter === 'prescribed') return toNum(doc.actual_sales) > 0;
    if (activityFilter === 'not_prescribed') return toNum(doc.actual_sales) <= 0;
    return true;
  });

  const summaryTotals = (() => {
    const sourceRows = displayDoctors;
    const totalSales = sourceRows.reduce((sum, row) => sum + toNum(row.total_sales ?? row.actual_sales), 0);
    const totalInvested = sourceRows.reduce((sum, row) => sum + toNum(row.total_invested), 0);
    const expectedSales = displayDoctors.reduce((sum, row) => sum + toNum(row.expected_sales), 0);
    return {
      total_sales: totalSales,
      total_invested: totalInvested,
      overall_roi_multiple: totalInvested > 0 ? (totalSales / totalInvested).toFixed(1) : 0,
      overall_ca_percent: expectedSales > 0 ? Math.round((displayDoctors.reduce((sum, row) => sum + toNum(row.actual_sales), 0) / expectedSales) * 100) : 0,
    };
  })();

  const activityStats = (() => {
    const stats = {
      total: locationDoctors.length,
      prescribedInvested: 0,
      prescribedNotInvested: 0,
      notPrescribedInvested: 0,
      notPrescribedNotInvested: 0,
    };
    locationDoctors.forEach(doc => {
      const hasSales = toNum(doc.actual_sales) > 0;
      const hasInvestment = toNum(doc.total_invested) > 0;
      if (hasSales && hasInvestment) stats.prescribedInvested += 1;
      else if (hasSales) stats.prescribedNotInvested += 1;
      else if (hasInvestment) stats.notPrescribedInvested += 1;
      else stats.notPrescribedNotInvested += 1;
    });
    stats.prescribed = stats.prescribedInvested + stats.prescribedNotInvested;
    stats.notPrescribed = stats.notPrescribedInvested + stats.notPrescribedNotInvested;
    return stats;
  })();

  const selectActivityFilter = (key) => {
    setActivityFilter(key);
    setExpandDoctors(false);
    setSelectedDoctor(null);
  };

  const prescribedInvestedDoctors = displayDoctors.filter(doc =>
    toNum(doc.actual_sales) > 0 && toNum(doc.total_invested) > 0
  );
  const prescribedSalesOnlyDoctors = displayDoctors.filter(doc =>
    toNum(doc.actual_sales) > 0 && toNum(doc.total_invested) <= 0
  );

  const visibleDoctorIds = new Set(locationDoctors.map(doc => doc.doctor_id));
  const hasRoiLocationFilter = routeScope !== 'overall' || roiStateCode !== 'ALL' || roiCity !== 'ALL';

  const displaySpendData = (() => {
    if (!spendData || !hasRoiLocationFilter) return spendData;
    const rows = (spendData.per_doctor_category || []).filter(row => visibleDoctorIds.has(row.doctor_id));
    const categoryBreakdown = ['PD', 'RD', 'CS'].reduce((acc, cat) => {
      acc[cat] = {
        total: rows.reduce((sum, row) => sum + toNum(row[cat]), 0),
        count: rows.filter(row => toNum(row[cat]) > 0).length,
      };
      return acc;
    }, {});
    const byModel = rows.reduce((acc, row) => {
      const model = row.commercial_model || 'N/A';
      acc[model] = (acc[model] || 0) + toNum(row.total);
      return acc;
    }, {});
    return {
      ...spendData,
      per_doctor_category: rows,
      category_breakdown: categoryBreakdown,
      sub_activity_breakdown: Object.entries(byModel).map(([activity, total]) => ({ activity, total })),
    };
  })();

  const displayCommitmentData = (() => {
    if (!commitmentData || !hasRoiLocationFilter) return commitmentData;
    const commitments = (commitmentData.commitments || []).filter(row => visibleDoctorIds.has(row.doctor_id));
    const doctorSummary = (commitmentData.doctor_summary || []).filter(row => visibleDoctorIds.has(row.doctor_id));
    return {
      ...commitmentData,
      commitments,
      doctor_summary: doctorSummary,
      summary: {
        open_commitments: commitments.filter(row => ['On Track', 'At Risk'].includes(row.status)).length,
        achieved: commitments.filter(row => row.status === 'Achieved').length,
        at_risk: commitments.filter(row => row.status === 'At Risk').length,
        breached: commitments.filter(row => row.status === 'Breached').length,
        shortfall: commitments.reduce((sum, row) => sum + toNum(row.shortfall), 0),
      },
    };
  })();

  const displayRiskData = (() => {
    if (!riskData || !hasRoiLocationFilter) return riskData;
    const ranked = [...locationDoctors]
      .filter(doc => toNum(doc.actual_sales) > 0)
      .sort((a, b) => toNum(b.actual_sales) - toNum(a.actual_sales));
    const totalSales = ranked.reduce((sum, doc) => sum + toNum(doc.actual_sales), 0);
    const share = count => totalSales > 0
      ? Math.round((ranked.slice(0, count).reduce((sum, doc) => sum + toNum(doc.actual_sales), 0) / totalSales) * 1000) / 10
      : 0;
    let cumulative = 0;
    const topDoctors = ranked.slice(0, 10).map((doc, index) => {
      const pct = totalSales > 0 ? (toNum(doc.actual_sales) / totalSales) * 100 : 0;
      cumulative += pct;
      return {
        doctor_id: doc.doctor_id,
        doctor_name: doc.doctor_name,
        commercial_model: doc.commercial_model,
        roi_grade: doc.roi_grade,
        sales: toNum(doc.actual_sales),
        pct_of_total: Math.round(pct * 10) / 10,
        cumulative_pct: Math.round(cumulative * 10) / 10,
        rank: index + 1,
      };
    });
    return { ...riskData, top5_pct: share(5), top10_pct: share(10), total_sales: totalSales, doctor_count: ranked.length, top_doctors: topDoctors };
  })();

  const renderReturnsTracker = (rows, title, subtitle) => {
    const chartDocs = [...rows]
      .filter(d => toNum(d.total_invested) > 0 || toNum(d.actual_sales) > 0)
      .sort(sortByActivity)
      .slice(0, 15);
    if (!chartDocs.length) return null;

    const belowTarget = chartDocs.filter(d => toNum(d.total_invested) > 0 && toNum(d.actual_sales) < toNum(d.total_invested)).length;
    const maxVal = Math.max(...chartDocs.flatMap(d => [toNum(d.total_invested), toNum(d.actual_sales)]), 1);

    return (
      <div style={{ background: '#fff', borderRadius: 14, border: '0.5px solid #e5e7eb', padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>
              {title}
              {belowTarget > 0 && <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fef2f2', padding: '2px 8px', borderRadius: 20 }}>{belowTarget} below break-even</span>}
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{subtitle}</div>
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555' }}>
              <span style={{ width: 12, height: 9, borderRadius: 2, background: '#f97316', display: 'inline-block' }} />Invested
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555' }}>
              <span style={{ width: 12, height: 9, borderRadius: 2, background: '#0F6E56', display: 'inline-block' }} />Sales
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {chartDocs.map((doc, i) => {
            const invested = toNum(doc.total_invested);
            const sales = toNum(doc.actual_sales);
            const invPct = (invested / maxVal) * 100;
            const salesPct = (sales / maxVal) * 100;
            const roi = fmtROIValue(sales, invested, doc.roi_multiple);
            const good = invested <= 0 || sales >= invested;
            return (
              <div key={doc.doctor_id} style={{ cursor: 'pointer' }}
                onClick={() => setSelectedDoctor(prev => prev?.doctor_id === doc.doctor_id ? null : doc)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: '#bbb', width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.doctor_name}</span>
                  <GradeBadge grade={doc.roi_grade} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: good ? '#0F6E56' : '#dc2626', minWidth: 36, textAlign: 'right' }}>{roi}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 9, color: '#f97316', width: 44, textAlign: 'right', flexShrink: 0 }}>Inv</span>
                  <div style={{ flex: 1 }}>
                    <InvestmentBar doc={doc} pct={invPct} value={invested} />
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#f97316', width: 64, textAlign: 'right', flexShrink: 0 }}>{fmtInr(invested)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 9, color: '#0F6E56', width: 44, textAlign: 'right', flexShrink: 0 }}>Sales</span>
                  <div style={{ flex: 1 }}>
                    <SalesBar doc={doc} pct={salesPct} markerPct={invPct} />
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#0F6E56', width: 64, textAlign: 'right', flexShrink: 0 }}>{fmtInr(sales)}</span>
                </div>
                {i < chartDocs.length - 1 && <div style={{ height: 1, background: '#f3f4f6', margin: '6px 0 0 22px' }} />}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDoctorCards = (rows) => {
    const PREVIEW = 6;
    const visible = expandDoctors ? rows : rows.slice(0, PREVIEW);
    const hidden = rows.length - PREVIEW;
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {visible.map(d => (
            <DoctorCard key={d.doctor_id} d={d}
              selected={selectedDoctor?.doctor_id === d.doctor_id}
              onClick={doc => setSelectedDoctor(prev => prev?.doctor_id === doc.doctor_id ? null : doc)} />
          ))}
        </div>
        {rows.length > PREVIEW && (
          <button
            onClick={() => setExpandDoctors(e => !e)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', marginTop: 10, padding: '9px 0',
              background: expandDoctors ? '#f9fafb' : 'linear-gradient(90deg,#f0fdf4,#eff6ff)',
              border: '1px dashed #d1d5db', borderRadius: 10, cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: '#374151',
            }}>
            {expandDoctors
              ? <><span style={{ fontSize: 14 }}>▲</span> Show less</>
              : <><span style={{ fontSize: 14 }}>▼</span> Show {hidden} more doctors<span style={{ fontWeight: 400, color: '#9ca3af' }}> · {rows.length} total</span></>
            }
          </button>
        )}
      </div>
    );
  };

  if (workTab === 'my_sales') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-background-tertiary,#f7f7f5)' }}>
        <div style={{ padding: '16px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#111827' }}>My Sales</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Daily product sales entry</div>
          </div>
          <button
            onClick={() => navigate('/investment-roi')}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#0F6E56',
              padding: '6px 0',
              fontSize: 12,
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            Investment & ROI
          </button>
        </div>
        <EnterSales />
      </div>
    );
  }

  if (workTab === 'regional_sales') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-background-tertiary,#f7f7f5)' }}>
        <RegionalSalesPanel year={year} month={month} initialStateCode={initialRegion} initialCity={initialCity} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background-tertiary,#f7f7f5)' }}>
      {/* ── HERO STRIP */}
      <div style={{
        background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
        borderRadius: '0 0 20px 20px', padding: '20px 24px 24px', color: '#fff', marginBottom: 0,
        position: 'relative', overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(15,32,39,0.45), 0 2px 8px rgba(0,0,0,0.2)',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 140, height: 140, borderRadius: '50%', background: 'rgba(29,158,117,0.12)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 10, right: 120, width: 70, height: 70, borderRadius: '50%', background: 'rgba(245,184,0,0.1)', pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>◈ Investment & ROI</div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>Commitment achievement · investment tracking · grade analysis</div>
            {requestedScope && (
              <div style={{ fontSize: 9, opacity: 0.72, marginTop: 5 }}>
                Dashboard selection · {routeScope === 'mine' ? 'My Business' : routeScope === 'team' ? 'My Team' : 'Overall'} · {initialRegion === 'ALL' ? 'All regions' : initialRegion} · {initialCity === 'ALL' ? 'All cities' : initialCity}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.12)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', overflow: 'hidden' }}>
              <button onClick={() => goRoiMonth(-1)} aria-label="Previous month"
                style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18, padding: '8px 14px', lineHeight: 1, opacity: 0.85 }}>‹</button>
              <span style={{ fontSize: 13, fontWeight: 700, minWidth: 118, textAlign: 'center', padding: '0 4px' }}>{MONTHS[month]} {year}</span>
              <button onClick={() => goRoiMonth(1)} aria-label="Next month"
                disabled={year === CUR_YEAR && month === CUR_MONTH}
                style={{ background: 'none', border: 'none', color: '#fff', cursor: year === CUR_YEAR && month === CUR_MONTH ? 'not-allowed' : 'pointer', fontSize: 18, padding: '8px 14px', lineHeight: 1, opacity: year === CUR_YEAR && month === CUR_MONTH ? 0.25 : 0.85 }}>›</button>
            </div>
            {(year !== CUR_YEAR || month !== CUR_MONTH) && (
              <button onClick={() => { setYear(CUR_YEAR); setMonth(CUR_MONTH); }}
                style={{ background: 'rgba(245,184,0,0.25)', border: '1px solid rgba(245,184,0,0.4)', borderRadius: 8, color: '#F5B800', fontSize: 11, fontWeight: 700, padding: '8px 12px', cursor: 'pointer' }}>
                This Month
              </button>
            )}
            <button onClick={() => {
              if (showForm) resetInvestmentForm();
              else { setEditingInvestmentId(null); setInvError(''); setSelDoc(null); setInvForm(EMPTY_INV); setShowForm(true); }
            }}
              style={{
                background: showForm ? 'rgba(255,255,255,0.15)' : '#1D9E75',
                color: '#fff', border: 'none', borderRadius: 12, padding: '10px 20px',
                fontSize: 13, fontWeight: 800, cursor: 'pointer',
              }}>
              {showForm ? '✕ Cancel' : '+ Add Investment'}
            </button>
            <button onClick={() => { setShowForm(false); navigate('/my-sales?add=1'); }}
              style={{
                background: '#F5B800',
                color: '#111827', border: 'none', borderRadius: 12, padding: '10px 20px',
                fontSize: 13, fontWeight: 900, cursor: 'pointer',
              }}>
              + Add Sales
            </button>
            <button onClick={() => setShowGuide(s => !s)}
              style={{
                background: showGuide ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
                color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 12, padding: '10px 16px',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>
              {showGuide ? '✕ Close' : 'ⓘ Guide'}
            </button>
          </div>
        </div>

        {/* Location filters — shared behavior with Regional Sales */}
        {roiLocations.length > 0 && (
          <div style={{ display: 'grid', gap: 7, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase', marginRight: 2 }}>Region</span>
              <button onClick={() => { setRoiStateCode('ALL'); setRoiCity('ALL'); }}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                  border: roiStateCode === 'ALL' ? '2px solid #F5B800' : '2px solid rgba(255,255,255,0.15)',
                  background: roiStateCode === 'ALL' ? '#F5B800' : 'rgba(255,255,255,0.08)',
                  color: roiStateCode === 'ALL' ? '#0B1E10' : 'rgba(255,255,255,0.75)',
                }}>All</button>
              {roiStateOptions.map(st => {
                const active = toStateName(roiStateCode) === st.state_name;
                const accents = { 'Tamil Nadu': '#F97316', 'Kerala': '#10B981', 'Telangana': '#8B5CF6', 'Karnataka': '#EF4444', 'Maharashtra': '#3B82F6' };
                const accent = accents[st.state_name] || '#F5B800';
                return (
                  <button key={st.state_name} onClick={() => { setRoiStateCode(st.state_code); setRoiCity('ALL'); }}
                    style={{
                      padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                      border: active ? `2px solid ${accent}` : '2px solid rgba(255,255,255,0.15)',
                      background: active ? accent : 'rgba(255,255,255,0.08)',
                      color: active ? '#fff' : 'rgba(255,255,255,0.75)',
                    }}>{st.state_name} <span style={{ opacity: 0.65 }}>({st.count})</span></button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', overflowX: 'auto', whiteSpace: 'nowrap', paddingBottom: 2 }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase', marginRight: 2, flex: '0 0 auto' }}>City</span>
              <button onClick={() => setRoiCity('ALL')}
                style={{
                  padding: '4px 11px', borderRadius: 20, fontSize: 10, fontWeight: 800, cursor: 'pointer',
                  border: roiCity === 'ALL' ? '2px solid #F5B800' : '2px solid rgba(255,255,255,0.12)',
                  background: roiCity === 'ALL' ? '#F5B800' : 'rgba(255,255,255,0.07)',
                  color: roiCity === 'ALL' ? '#0B1E10' : 'rgba(255,255,255,0.7)', flex: '0 0 auto',
                }}>All</button>
              {topRoiCities.map(([cityName, count]) => {
                const active = roiCity === cityName;
                return (
                  <button key={cityName} onClick={() => setRoiCity(cityName)}
                    style={{
                      padding: '4px 11px', borderRadius: 20, fontSize: 10, fontWeight: 800, cursor: 'pointer',
                      border: active ? '2px solid #3D8C40' : '2px solid rgba(255,255,255,0.12)',
                      background: active ? '#3D8C40' : 'rgba(255,255,255,0.07)',
                      color: active ? '#fff' : 'rgba(255,255,255,0.7)', flex: '0 0 auto',
                    }}>{cityName} <span style={{ opacity: 0.65 }}>({count})</span></button>
                );
              })}
            </div>
          </div>
        )}

        {/* Row 1 — Summary metric chips + account categories */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, flexWrap: 'wrap' }}>
          {/* Regular metric chips */}
          {[
            { label: 'Invested · 6M', val: fmtInr(summaryTotals.total_invested), color: '#4ade80' },
            { label: 'Business · 6M', val: fmtInr(summaryTotals.total_sales), color: '#60a5fa' },
            { label: 'ROI',         val: fmtROIValue(summaryTotals.total_sales, summaryTotals.total_invested, summaryTotals.overall_roi_multiple), color: '#fbbf24' },
            { label: 'Achievement', val: `${summaryTotals.overall_ca_percent || 0}%`, color: summaryTotals.overall_ca_percent >= 100 ? '#4ade80' : summaryTotals.overall_ca_percent >= 80 ? '#fbbf24' : '#f87171' },
          ].map(chip => (
            <div
              key={chip.label}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                padding: '8px 14px',
                minWidth: 116,
                cursor: 'default',
              }}
            >
              <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 2 }}>{chip.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: chip.color }}>{chip.val}</div>
            </div>
          ))}

        </div>

        <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          {[
            {
              key: 'all',
              label: 'All Accounts',
              count: activityStats.total,
              color: '#e5e7eb',
              sub: `${activityStats.prescribed} with sales · ${activityStats.notPrescribed} no sales`,
            },
            {
              key: 'prescribed',
              label: 'Prescribed',
              count: activityStats.prescribed,
              color: '#4ade80',
              sub: `${activityStats.prescribedInvested} invested + sales · ${activityStats.prescribedNotInvested} sales only`,
            },
            {
              key: 'not_prescribed',
              label: 'Not Prescribed',
              count: activityStats.notPrescribed,
              color: '#f87171',
              sub: `${activityStats.notPrescribedInvested} invested no sales · ${activityStats.notPrescribedNotInvested} no investment/no sales`,
            },
          ].map(cat => {
            const active = activityFilter === cat.key;
            return (
              <button key={cat.key} onClick={() => selectActivityFilter(cat.key)}
                style={{
                  background: active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)',
                  border: active ? `1.5px solid ${cat.color}` : '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 10, padding: '9px 14px', minWidth: 170,
                  cursor: 'pointer', color: '#fff', textAlign: 'left',
                  boxShadow: active ? `0 0 0 1px ${cat.color}33` : 'none',
                }}>
                <div style={{ fontSize: 10, opacity: 0.58, marginBottom: 2 }}>{cat.label}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: cat.color, lineHeight: 1 }}>{cat.count}</div>
                <div style={{ fontSize: 9, opacity: 0.58, marginTop: 5, lineHeight: 1.35 }}>{cat.sub}</div>
              </button>
            );
          })}
        </div>

        {/* Row 2 — Grade filter strip (visually separate from metrics) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'rgba(0,0,0,0.18)', borderRadius: 14, padding: '5px 6px', marginTop: 12, backdropFilter: 'blur(4px)' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, paddingLeft: 6, paddingRight: 10, flexShrink: 0, whiteSpace: 'nowrap' }}>Grade</span>
          {[
            { key: 'All',      icon: '◎',  label: 'All',     roi: null,    accent: 'rgba(255,255,255,0.6)', activeBg: 'rgba(255,255,255,0.15)', activeText: '#fff' },
            { key: 'Platinum', icon: '🏆', label: 'Platinum', roi: '>8×',   accent: '#1D9E75', activeBg: '#E1F5EE', activeText: '#085041' },
            { key: 'Gold',     icon: '🥇', label: 'Gold',     roi: '5–8×',  accent: '#d97706', activeBg: '#fffbeb', activeText: '#92400e' },
            { key: 'Silver',   icon: '🥈', label: 'Silver',   roi: '3–5×',  accent: '#64748b', activeBg: '#f1f5f9', activeText: '#334155' },
            { key: 'Bronze',   icon: '🥉', label: 'Bronze',   roi: '<3×',   accent: '#b45309', activeBg: '#fef3c7', activeText: '#78350f' },
            { key: 'At Risk',  icon: '⚠️', label: 'At Risk',  roi: null,    accent: '#ef4444', activeBg: '#fef2f2', activeText: '#991b1b' },
          ].map(g => {
            const active = gradeFilter === g.key;
            return (
              <button key={g.key} onClick={() => setGradeFilter(g.key)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  padding: '7px 10px', borderRadius: 10, cursor: 'pointer', minWidth: 0,
                  border: 'none', outline: 'none',
                  background: active ? g.activeBg : 'transparent',
                  boxShadow: active ? `0 0 0 1.5px ${g.accent}` : 'none',
                  transition: 'all 0.15s',
                }}>
                <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{g.icon}</span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: active ? g.activeText : 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', lineHeight: 1.2 }}>{g.label}</span>
                  {g.roi && <span style={{ fontSize: 9, fontWeight: 600, color: active ? g.accent : 'rgba(255,255,255,0.35)', lineHeight: 1.2 }}>{g.roi}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── REFERENCE GUIDE PANEL */}
      {showGuide && (
        <div style={{ margin: '0 24px', background: '#fff', borderRadius: '0 0 16px 16px', border: '1px solid #e5e7eb', borderTop: 'none', padding: '0 24px 24px', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, paddingTop: 24 }}>

            {/* ── ROI GRADE GUIDE */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#1a1a1a', marginBottom: 4, letterSpacing: 0.2 }}>ROI Grade</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 14 }}>
                Based on <strong>Actual Sales ÷ Investment</strong>. Updates automatically every month.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { grade: 'Platinum', roi: '> 8×', desc: 'Exceptional returns — protect and grow',  icon: '🏆' },
                  { grade: 'Gold',     roi: '5 – 8×', desc: 'Strong performer — maintain investment', icon: '🥇' },
                  { grade: 'Silver',   roi: '3 – 5×', desc: 'Moderate ROI — review and optimise',    icon: '🥈' },
                  { grade: 'Bronze',   roi: '< 3×',  desc: 'Low ROI — evaluate or reduce spend',    icon: '🥉' },
                ].map(row => {
                  const gc = GRADE_COLORS[row.grade];
                  return (
                    <div key={row.grade} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: gc.bg, border: `1px solid ${gc.border}55` }}>
                      <span style={{ fontSize: 20 }}>{row.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 800, fontSize: 13, color: gc.text }}>{row.grade}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: gc.dot, background: '#fff', padding: '1px 8px', borderRadius: 20, border: `1px solid ${gc.border}66` }}>{row.roi}</span>
                        </div>
                        <div style={{ fontSize: 11, color: gc.text, opacity: 0.75, marginTop: 2 }}>{row.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Achievement % legend */}
              <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 10, background: '#f9fafb', border: '1px solid #f3f4f6' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Achievement % = Actual ÷ Expected × 100</div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11 }}>🟢 ≥ 100% <span style={{ color: '#9ca3af' }}>On target</span></span>
                  <span style={{ fontSize: 11 }}>🟡 80–100% <span style={{ color: '#9ca3af' }}>Near target</span></span>
                  <span style={{ fontSize: 11 }}>🔴 &lt; 80% <span style={{ color: '#9ca3af' }}>Below target</span></span>
                </div>
              </div>
            </div>

            {/* ── COMMERCIAL MODEL GUIDE */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#1a1a1a', marginBottom: 4, letterSpacing: 0.2 }}>Commercial Model</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 14 }}>
                Account classification that determines investment strategy and expected return profile.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { code: 'U1', label: 'Upfront Investment Account',  desc: 'Invest first, recover through future business',    mc: MODEL_COLORS.U1 },
                  { code: 'U2', label: 'Strategic Upfront Account',   desc: 'High-value, long-term growth potential',           mc: MODEL_COLORS.U2 },
                  { code: 'P1', label: 'Performance-Linked Account',  desc: 'Support tied directly to sales generated',         mc: MODEL_COLORS.P1 },
                  { code: 'P2', label: 'Growth Incentive Account',    desc: 'Investment increases as business grows',            mc: MODEL_COLORS.P2 },
                  { code: 'N1', label: 'Natural Prescriber',          desc: 'Prescribes organically — low investment needed',   mc: MODEL_COLORS.N1 },
                  { code: 'D1', label: 'Development Account',         desc: 'New doctor under evaluation — build relationship', mc: MODEL_COLORS.D1 },
                  { code: 'R1', label: 'At-Risk Account',             desc: 'Declining business or high competitor pressure',   mc: MODEL_COLORS.R1 },
                ].map(row => (
                  <div key={row.code} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 9, background: row.mc.bg, border: `1px solid ${row.mc.text}22` }}>
                    <span style={{ fontWeight: 800, fontSize: 12, color: '#fff', background: row.mc.text, padding: '2px 8px', borderRadius: 5, flexShrink: 0, marginTop: 1 }}>{row.code}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: row.mc.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.label}</div>
                      <div style={{ fontSize: 10, color: row.mc.text, opacity: 0.65, marginTop: 1 }}>{row.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Investment Category guide */}
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #f3f4f6' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1a1a1a', marginBottom: 12 }}>Investment Categories</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[
                { code: 'PD', label: 'Professional Development', color: INV_CATEGORY_COLORS.PD, examples: 'Conference, Travel, Hotel, CME, Speaker Programs' },
                { code: 'RD', label: 'Relationship Development', color: INV_CATEGORY_COLORS.RD, examples: 'Advisory Board, Round Table, Doctor Meetings' },
                { code: 'CS', label: 'Commercial Support',       color: INV_CATEGORY_COLORS.CS, examples: 'Commercial Support, Samples, Gifts' },
              ].map(cat => (
                <div key={cat.code} style={{ flex: '1 1 200px', padding: '12px 16px', borderRadius: 10, border: `1.5px solid ${cat.color}44`, background: `${cat.color}08` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: cat.color, padding: '2px 8px', borderRadius: 5 }}>{cat.code}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: cat.color }}>{cat.label}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>{cat.examples}</div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ── SUCCESS BANNER */}
      {invSuccess && (
        <div style={{ margin: '12px 24px 0', padding: '10px 16px', background: '#E1F5EE', border: '1px solid #1D9E75', borderRadius: 10, color: '#085041', fontSize: 13, fontWeight: 600 }}>
          ✓ {invSuccess}
        </div>
      )}

      {/* ── INLINE INVESTMENT FORM */}
      {showForm && (
        <div ref={investmentFormRef} style={{ margin: '16px 24px 0', scrollMarginTop: 16, background: '#fff', borderRadius: 16, border: editingInvestmentId ? '2px solid #2563eb' : '1.5px solid #1D9E75', padding: 20, boxShadow: editingInvestmentId ? '0 4px 24px rgba(37,99,235,0.18)' : '0 4px 20px rgba(29,158,117,0.1)' }}>
          {editingInvestmentId && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 900, color: '#1d4ed8' }}>Editing saved investment</div>}
          {!editingInvestmentId && investmentDraftStatus && <div style={{ marginBottom: 12, fontSize: 11, fontWeight: 800, color: '#047857' }}>✓ {investmentDraftStatus}</div>}
          <form onSubmit={submitInvestment}>
            {/* Doctor search */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Doctor *</label>
              {selDoc ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#F0FDF4', borderRadius: 10, border: '1px solid #1D9E75' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{selDoc.name}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>
                      {selDoc.specialty} · {selDoc.city}
                      {selDoc.commercial_model && <> · <ModelBadge model={selDoc.commercial_model} /></>}
                    </div>
                  </div>
                  <button type="button" onClick={() => { setSelDoc(null); setInvForm(f => ({ ...f, doctor_id: '', commercial_model_type: '' })); }}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 18 }}>×</button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <input value={docSearch} onChange={e => setDocSearch(e.target.value)}
                    placeholder="Search doctor by name or city..."
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                  {docSearch && filteredFormDocs.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 50, maxHeight: 220, overflowY: 'auto', marginTop: 4 }}>
                      {filteredFormDocs.map(doc => (
                        <div key={doc.id} onClick={() => selectDoc(doc)}
                          style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '0.5px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 10 }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{doc.name}</div>
                            <div style={{ fontSize: 11, color: '#888' }}>{doc.specialty} · {doc.city}</div>
                          </div>
                          {doc.commercial_model && <ModelBadge model={doc.commercial_model} />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Commercial Model Type selector */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>
                Investment Type (Commercial Model) *
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                {COMMERCIAL_MODELS.map(m => {
                  const sel = invForm.commercial_model_type === m.code;
                  return (
                    <div key={m.code} onClick={() => setInvForm(f => ({ ...f, commercial_model_type: m.code }))}
                      style={{ padding: '10px 12px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                        border: `2px solid ${sel ? m.color : m.border}`,
                        background: sel ? m.bg : '#fafafa',
                        boxShadow: sel ? `0 2px 8px ${m.color}22` : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <span style={{ background: sel ? m.color : m.border, color: sel ? '#fff' : m.color,
                          padding: '1px 8px', borderRadius: 6, fontSize: 11, fontWeight: 800 }}>{m.code}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: sel ? m.color : '#374151' }}>{m.label}</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#9ca3af', lineHeight: 1.4 }}>{m.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Investment details grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Activity / Spend Type</label>
                <select value={invForm.sub_category} onChange={e => setInvForm(f => ({ ...f, sub_category: e.target.value }))}
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }}>
                  <option value="">— What was spent on? —</option>
                  {ALL_SUB_CATS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Week</label>
                <select value={invForm.week} onChange={e => setInvForm(f => ({ ...f, week: +e.target.value }))}
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }}>
                  {[1,2,3,4].map(w => <option key={w} value={w}>Week {w}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Amount (₹) *</label>
                <input ref={investmentAmountRef} type="number" value={invForm.amount} onChange={e => setInvForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="e.g. 15000"
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Investment Expectation (×)</label>
                <input type="number" min={1} max={20} step={0.5} value={invForm.expected_multiple}
                  onChange={e => setInvForm(f => ({ ...f, expected_multiple: +e.target.value }))}
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fafafa' }} />
              </div>
              {invForm.amount && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'flex-end' }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Expected Sales</label>
                  <div style={{ padding: '8px 12px', borderRadius: 8, background: '#E1F5EE', border: '1px solid #1D9E75', fontSize: 15, fontWeight: 800, color: '#085041' }}>
                    ₹{(invForm.amount * invForm.expected_multiple).toLocaleString()}
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Purpose / Notes</label>
              <textarea value={invForm.purpose} onChange={e => setInvForm(f => ({ ...f, purpose: e.target.value }))}
                placeholder="Brief description of the investment purpose..."
                rows={2}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>

            {invForm.amount > 25000 && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 12, color: '#92400E' }}>
                ⚠ Investments above ₹25,000 require manager approval before counting toward ROI.
              </div>
            )}

            {invError && <div style={{ color: '#D85A30', fontSize: 12, marginBottom: 10 }}>{invError}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={resetInvestmentForm}
                style={{ padding: '9px 20px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
              <button type="submit" disabled={invSaving}
                style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: '#1D9E75', color: '#fff', cursor: invSaving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, opacity: invSaving ? 0.7 : 1 }}>
                {invSaving ? 'Saving…' : editingInvestmentId ? 'Save Changes' : 'Save Investment'}
              </button>
            </div>
          </form>

          {visibleMyInvestments.length > 0 && (
            <div style={{ marginTop: 18, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '11px 14px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: '#111827' }}>Saved Investments · {MONTHS[month]} {year}</div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>Use Edit to correct an entered value. Approved entries return for approval after editing.</div>
                </div>
                <span style={{ fontSize: 11, color: '#6b7280' }}>{visibleMyInvestments.length} entr{visibleMyInvestments.length === 1 ? 'y' : 'ies'}</span>
              </div>
              {visibleMyInvestments.map(investment => (
                <div key={investment.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.4fr) minmax(110px, .7fr) minmax(90px, .5fr) auto', gap: 10, alignItems: 'center', padding: '10px 14px', borderTop: '1px solid #f3f4f6' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{investment.doctor_name}</div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                      {investment.commercial_model_type || 'Investment'}
                      {investment.category ? ` · ${investment.category}` : ''}
                      {investment.sub_category ? ` · ${investment.sub_category}` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#0F6E56' }}>{fmtInr(investment.amount)}</div>
                  <div style={{ fontSize: 10, color: investment.is_approved ? '#166534' : '#92400e', fontWeight: 800 }}>{investment.is_approved ? 'Approved' : 'Pending'}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => editInvestment(investment)} disabled={deletingInvestmentId === investment.id} style={{ padding: '6px 11px', borderRadius: 8, border: '1px solid #bfdbfe', background: editingInvestmentId === investment.id ? '#dbeafe' : '#eff6ff', color: '#1d4ed8', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>{editingInvestmentId === investment.id ? 'Editing' : 'Edit'}</button>
                    <button type="button" onClick={() => deleteInvestment(investment)} disabled={deletingInvestmentId === investment.id} style={{ padding: '6px 11px', borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontSize: 11, fontWeight: 900, cursor: deletingInvestmentId === investment.id ? 'default' : 'pointer' }}>{deletingInvestmentId === investment.id ? 'Deleting…' : 'Delete'}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MAIN CONTENT: filters + grid + drill panel */}
      <div style={{ display: 'flex', gap: 0, padding: '16px 24px', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* ── FILTER BAR */}
          <div style={{ marginBottom: 16 }}>

            {/* Row 1: Model type filter — segmented strip */}
            <div style={{ display: 'inline-flex', background: '#f0f2f5', borderRadius: 14, padding: '4px 5px', gap: 3, flexWrap: 'wrap' }}>
              {[
                { code: 'All', label: 'All',         dot: '#6b7280' },
                { code: 'U1',  label: 'Upfront',     dot: MODEL_COLORS.U1?.text || '#065f46' },
                { code: 'U2',  label: 'Strategic',   dot: MODEL_COLORS.U2?.text || '#065f46' },
                { code: 'P1',  label: 'Performance', dot: MODEL_COLORS.P1?.text || '#1e40af' },
                { code: 'P2',  label: 'Growth',      dot: MODEL_COLORS.P2?.text || '#1e40af' },
                { code: 'N1',  label: 'Natural',     dot: MODEL_COLORS.N1?.text || '#92400e' },
                { code: 'D1',  label: 'Development', dot: MODEL_COLORS.D1?.text || '#5b21b6' },
                { code: 'R1',  label: 'At-Risk',     dot: MODEL_COLORS.R1?.text || '#991b1b' },
              ].map(m => {
                const mc = MODEL_COLORS[m.code] || {};
                const active = modelFilter === m.code;
                return (
                  <button key={m.code} onClick={() => setModelFilter(m.code)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                      padding: '6px 13px', borderRadius: 10, border: 'none', outline: 'none',
                      background: active ? '#fff' : 'transparent',
                      boxShadow: active ? '0 1px 5px rgba(0,0,0,0.12)' : 'none',
                      transition: 'all 0.13s',
                    }}>
                    {m.code !== 'All' ? (
                      <span style={{
                        fontSize: 10, fontWeight: 800, lineHeight: 1,
                        padding: '2px 5px', borderRadius: 5,
                        background: active ? m.dot : 'transparent',
                        color: active ? '#fff' : m.dot,
                        border: `1.5px solid ${m.dot}`,
                      }}>{m.code}</span>
                    ) : (
                      <span style={{ fontSize: 13, color: active ? '#111' : '#6b7280' }}>⊙</span>
                    )}
                    <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? '#111827' : '#6b7280', whiteSpace: 'nowrap' }}>
                      {m.label}
                    </span>
                  </button>
                );
              })}
              {extraRoiCities.length > 0 && (
                <select value={extraRoiCities.some(([cityName]) => cityName === roiCity) ? roiCity : ''}
                  onChange={e => e.target.value && setRoiCity(e.target.value)}
                  aria-label="More cities"
                  style={{ padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800, cursor: 'pointer', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '2px solid rgba(255,255,255,0.15)', flex: '0 0 auto' }}>
                  <option value="" style={{ color: '#000' }}>+{extraRoiCities.length} more...</option>
                  {extraRoiCities.map(([cityName, count]) => <option key={cityName} value={cityName} style={{ color: '#000' }}>{cityName} ({count})</option>)}
                </select>
              )}
            </div>

            {/* Row 3: Search */}
            <div style={{ marginTop: 8 }}>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#bbb', pointerEvents: 'none' }}>⌕</span>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search doctors by name or city..."
                  style={{ paddingLeft: 30, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', width: 280, background: '#fff' }} />
              </div>
            </div>

          </div>

          {/* ── INV vs SALES CHART (above cards) */}
          {!loading && activityFilter !== 'prescribed' && displayDoctors.filter(d => d.total_invested > 0 || d.actual_sales > 0).length > 0 && (() => {
            const chartDocs = [...displayDoctors]
              .filter(d => d.total_invested > 0 || d.actual_sales > 0)
              .sort(sortByActivity)
              .slice(0, 15);
            const belowTarget = chartDocs.filter(d => d.actual_sales < d.total_invested).length;
            const maxVal = Math.max(...chartDocs.flatMap(d => [d.total_invested, d.actual_sales]), 1);
            return (
              <div style={{ background: '#fff', borderRadius: 14, border: '0.5px solid #e5e7eb', padding: '14px 18px', marginBottom: 16 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>
                      Top Active Doctors — 6-Month Returns Tracker
                      {belowTarget > 0 && <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fef2f2', padding: '2px 8px', borderRadius: 20 }}>⚠ {belowTarget} below break-even</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sixMonthWindowLabel} · sorted by six-month sales and investment activity · orange line = break-even · click a doctor to drill in</div>
                  </div>
                  <div style={{ display: 'flex', gap: 14 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555' }}>
                      <span style={{ width: 12, height: 9, borderRadius: 2, background: '#f97316', display: 'inline-block' }} />Invested
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555' }}>
                      <span style={{ width: 12, height: 9, borderRadius: 2, background: '#0F6E56', display: 'inline-block' }} />Sales
                    </span>
                  </div>
                </div>

                {/* Bars */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {chartDocs.map((doc, i) => {
                    const invPct   = (doc.total_invested / maxVal) * 100;
                    const salesPct = (doc.actual_sales / maxVal) * 100;
                    const roi      = fmtROIValue(doc.actual_sales, doc.total_invested, doc.roi_multiple);
                    const good     = doc.actual_sales >= doc.total_invested;
                    const gc       = GRADE_COLORS[doc.roi_grade] || GRADE_COLORS.Bronze;
                    return (
                      <div key={doc.doctor_id} style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedDoctor(prev => prev?.doctor_id === doc.doctor_id ? null : doc)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 10, color: '#bbb', width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.doctor_name}</span>
                          <GradeBadge grade={doc.roi_grade} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: good ? '#0F6E56' : '#dc2626', minWidth: 36, textAlign: 'right' }}>{roi}</span>
                        </div>
                        {/* Investment bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 9, color: '#f97316', width: 44, textAlign: 'right', flexShrink: 0 }}>Inv</span>
                          <div style={{ flex: 1 }}>
                            <InvestmentBar doc={doc} pct={invPct} />
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#f97316', width: 64, textAlign: 'right', flexShrink: 0 }}>{fmtInr(doc.total_invested)}</span>
                        </div>
                        {/* Sales bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 9, color: '#0F6E56', width: 44, textAlign: 'right', flexShrink: 0 }}>Sales</span>
                          <div style={{ flex: 1 }}>
                            <SalesBar doc={doc} pct={salesPct} markerPct={invPct} />
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#0F6E56', width: 64, textAlign: 'right', flexShrink: 0 }}>{fmtInr(doc.actual_sales)}</span>
                        </div>
                        {i < chartDocs.length - 1 && <div style={{ height: 1, background: '#f3f4f6', margin: '6px 0 0 22px' }} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Doctor cards */}
          {activityFilter === 'prescribed' && loading && (
            <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 13 }}>Loading...</div>
          )}
          {activityFilter === 'prescribed' && !loading && displayDoctors.length === 0 && (
            <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 13 }}>No doctors found for this period.</div>
          )}
          {activityFilter === 'prescribed' && !loading && displayDoctors.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, alignItems: 'start' }}>
              <div>
                {renderReturnsTracker(
                  prescribedInvestedDoctors,
                  'Invested + Sales',
                  'Doctors with investment and sales in this period'
                )}
              </div>
              <div>
                {renderReturnsTracker(
                  prescribedSalesOnlyDoctors,
                  'Not Invested + Sales',
                  'Doctors with sales but no investment in this period'
                )}
              </div>
            </div>
          )}

          {SHOW_INDIVIDUAL_DOCTOR_CARDS && activityFilter !== 'prescribed' && !loading && displayDoctors.length > 0 && (
            <div style={{ margin: '18px 0 10px' }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: '#111827' }}>Top Invested Doctors · 6 Months</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                Top 10 shown first from {displayDoctors.length} active doctor{displayDoctors.length === 1 ? '' : 's'} · use Show more or search by name
              </div>
            </div>
          )}

          {SHOW_INDIVIDUAL_DOCTOR_CARDS && activityFilter !== 'prescribed' && (loading ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 13 }}>Loading…</div>
          ) : displayDoctors.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 13 }}>No doctors found for this period.</div>
          ) : (() => {
            const PREVIEW = 10;
            const rankedDoctors = [...displayDoctors].sort((a, b) =>
              toNum(b.total_invested) - toNum(a.total_invested)
              || toNum(b.actual_sales) - toNum(a.actual_sales)
              || (a.doctor_name || '').localeCompare(b.doctor_name || '')
            );
            const visible = expandDoctors ? rankedDoctors : rankedDoctors.slice(0, PREVIEW);
            const hidden  = rankedDoctors.length - PREVIEW;
            return (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                  {visible.map(d => (
                    <DoctorCard key={d.doctor_id} d={d}
                      selected={selectedDoctor?.doctor_id === d.doctor_id}
                      onClick={doc => setSelectedDoctor(prev => prev?.doctor_id === doc.doctor_id ? null : doc)} />
                  ))}
                </div>
                {rankedDoctors.length > PREVIEW && (
                  <button
                    onClick={() => setExpandDoctors(e => !e)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      width: '100%', marginTop: 10, padding: '9px 0',
                      background: expandDoctors ? '#f9fafb' : 'linear-gradient(90deg,#f0fdf4,#eff6ff)',
                      border: '1px dashed #d1d5db', borderRadius: 10, cursor: 'pointer',
                      fontSize: 12, fontWeight: 600, color: '#374151',
                    }}>
                    {expandDoctors
                      ? <><span style={{ fontSize: 14 }}>▲</span> Show less</>
                      : <><span style={{ fontSize: 14 }}>▼</span> Show {hidden} more doctors<span style={{ fontWeight: 400, color: '#9ca3af' }}> · {rankedDoctors.length} total</span></>
                    }
                  </button>
                )}
              </div>
            );
          })())}
        </div>

        {/* Drill panel */}
        {selectedDoctor && (
          <div style={{
            width: 380, flexShrink: 0, marginLeft: 16,
            background: '#fff', borderRadius: 16, border: '0.5px solid #e5e7eb',
            boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
            position: 'sticky', top: 80, maxHeight: 'calc(100vh - 100px)', overflowY: 'auto',
          }}>
            <DrillPanel
              doctorId={selectedDoctor.doctor_id}
              year={year} month={month}
              viewerId={me.id}
              onClose={() => setSelectedDoctor(null)}
              onAddInvestment={doc => setAddInvDoctor(doc)}
              onAddBusiness={doc => setAddBizDoctor(doc)}
            />
          </div>
        )}
      </div>

      {/* ── ANALYTICS SECTION */}
      <div style={{ padding: '8px 24px 40px' }}>

        {/* Analytics tab bar */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #f3f4f6', marginBottom: 20 }}>
          {[
            { key: 'allocation', label: 'Resource Allocation' },
            { key: 'commitment', label: '5x Commitment Recovery' },
            { key: 'spend',      label: 'Spend Analysis' },
            { key: 'risk',       label: 'Concentration Risk' },
          ].map(tab => (
            <button key={tab.key} onClick={() => setAnalyticsTab(tab.key)}
              style={{
                padding: '10px 20px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: 'none', borderBottom: analyticsTab === tab.key ? '2px solid #1D9E75' : '2px solid transparent',
                color: analyticsTab === tab.key ? '#085041' : '#6b7280',
                marginBottom: -2,
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {analyticsTab === 'allocation' && (
          <div style={{ background: '#fff', borderRadius: 16, border: '0.5px solid #e5e7eb', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Resource Allocation by Doctor</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                <span style={{ color: INV_CATEGORY_COLORS.PD, fontWeight: 700 }}>PD</span> Professional Development ·{' '}
                <span style={{ color: INV_CATEGORY_COLORS.RD, fontWeight: 700 }}>RD</span> Relationship Development ·{' '}
                <span style={{ color: INV_CATEGORY_COLORS.CS, fontWeight: 700 }}>CS</span> Commercial Support
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    {['Doctor', 'Model', 'PD', 'RD', 'CS', 'Total Invest', 'Sales', 'ROI ×', 'Grade'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Doctor' ? 'left' : 'right', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displaySpendData?.per_doctor_category?.length > 0 ? displaySpendData.per_doctor_category.map((row, i) => {
                    const gc = GRADE_COLORS[row.roi_grade] || GRADE_COLORS.Bronze;
                    const total = row.total || 0;
                    const pdPct = total ? Math.round((row.PD / total) * 100) : 0;
                    const rdPct = total ? Math.round((row.RD / total) * 100) : 0;
                    const csPct = total ? Math.round((row.CS / total) * 100) : 0;
                    return (
                      <tr key={row.doctor_id}
                        style={{ borderBottom: '0.5px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#F0FDF4'}
                        onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafafa'}>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                          <div>{row.doctor_name}</div>
                          <div style={{ display: 'flex', height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 4, gap: 1 }}>
                            {pdPct > 0 && <div style={{ width: `${pdPct}%`, background: INV_CATEGORY_COLORS.PD }} />}
                            {rdPct > 0 && <div style={{ width: `${rdPct}%`, background: INV_CATEGORY_COLORS.RD }} />}
                            {csPct > 0 && <div style={{ width: `${csPct}%`, background: INV_CATEGORY_COLORS.CS }} />}
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}><ModelBadge model={row.commercial_model} /></td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: INV_CATEGORY_COLORS.PD, fontWeight: row.PD > 0 ? 600 : 400 }}>
                          {row.PD > 0 ? <><div>{fmtInr(row.PD)}</div><div style={{ fontSize: 10, color: '#aaa' }}>{pdPct}%</div></> : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: INV_CATEGORY_COLORS.RD, fontWeight: row.RD > 0 ? 600 : 400 }}>
                          {row.RD > 0 ? <><div>{fmtInr(row.RD)}</div><div style={{ fontSize: 10, color: '#aaa' }}>{rdPct}%</div></> : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: INV_CATEGORY_COLORS.CS, fontWeight: row.CS > 0 ? 600 : 400 }}>
                          {row.CS > 0 ? <><div>{fmtInr(row.CS)}</div><div style={{ fontSize: 10, color: '#aaa' }}>{csPct}%</div></> : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{fmtInr(total)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#0F6E56' }}>{fmtInr(row.sales)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: gc.dot }}>{fmtROIValue(row.sales, row.total, row.roi_multiple)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}><GradeBadge grade={row.roi_grade} /></td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#888', fontSize: 13 }}>No investment data for this period</td></tr>
                  )}
                </tbody>
                {displaySpendData?.per_doctor_category?.length > 0 && (() => {
                  const rows = displaySpendData.per_doctor_category;
                  const totPD = rows.reduce((s, r) => s + r.PD, 0);
                  const totRD = rows.reduce((s, r) => s + r.RD, 0);
                  const totCS = rows.reduce((s, r) => s + r.CS, 0);
                  const totInv = rows.reduce((s, r) => s + r.total, 0);
                  const totSales = rows.reduce((s, r) => s + r.sales, 0);
                  const overallROI = totInv > 0 ? (totSales / totInv).toFixed(1) : '—';
                  return (
                    <tfoot>
                      <tr style={{ background: '#f0fdf4', fontWeight: 700, borderTop: '2px solid #1D9E75' }}>
                        <td style={{ padding: '10px 14px', fontSize: 12 }}>TOTAL</td>
                        <td />
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: INV_CATEGORY_COLORS.PD }}>{fmtInr(totPD)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: INV_CATEGORY_COLORS.RD }}>{fmtInr(totRD)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: INV_CATEGORY_COLORS.CS }}>{fmtInr(totCS)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>{fmtInr(totInv)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: '#0F6E56' }}>{fmtInr(totSales)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: '#BA7517' }}>{overallROI}×</td>
                        <td />
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          </div>
        )}

        {analyticsTab === 'commitment' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 10,
            }}>
              {[
                ['Open', displayCommitmentData?.summary?.open_commitments || 0, 'Inside 6-month window', '#042C53'],
                ['Achieved', displayCommitmentData?.summary?.achieved || 0, 'Reached 5x', '#085041'],
                ['At Risk', displayCommitmentData?.summary?.at_risk || 0, 'Behind time progress', '#BA7517'],
                ['Breached', displayCommitmentData?.summary?.breached || 0, 'Past deadline below 5x', '#D85A30'],
                ['Shortfall', fmtInr(displayCommitmentData?.summary?.shortfall || 0), 'Sales still required', '#4A1B0C'],
              ].map(([label, value, sub, color]) => (
                <div key={label} style={{
                  background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 8,
                  padding: '13px 14px', minWidth: 0,
                }}>
                  <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 800, textTransform: 'uppercase' }}>{label}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color, marginTop: 4 }}>{value}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{sub}</div>
                </div>
              ))}
            </div>

            <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e5e7eb', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>6-Month 5x Commitment Recovery</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                    Each investment is tracked separately from investment date to 6-month deadline.
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  As of {displayCommitmentData?.as_of || 'today'}
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      {['Doctor', 'Model', 'Invested', '5x Target', 'Sales Captured', 'Progress', 'Deadline', 'Status', 'Shortfall'].map(h => (
                        <th key={h} style={{
                          padding: '10px 12px', textAlign: h === 'Doctor' || h === 'Progress' ? 'left' : 'right',
                          fontSize: 11, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #f3f4f6',
                          whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(displayCommitmentData?.commitments || []).length > 0 ? displayCommitmentData.commitments.map((row, i) => {
                      const pct = Math.max(0, Math.min(100, Number(row.achievement_pct) || 0));
                      const statusColor = row.status === 'Achieved' ? '#1D9E75' : row.status === 'Breached' ? '#D85A30' : row.status === 'At Risk' ? '#BA7517' : '#60a5fa';
                      return (
                        <tr key={row.investment_id} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa', borderBottom: '0.5px solid #f3f4f6' }}>
                          <td style={{ padding: '11px 12px', textAlign: 'left' }}>
                            <div style={{ fontWeight: 800 }}>{row.doctor_name}</div>
                            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                              {[row.city, row.manager_name].filter(Boolean).join(' · ')}
                            </div>
                            <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>Investment: {row.investment_date}</div>
                          </td>
                          <td style={{ padding: '11px 12px', textAlign: 'right' }}><ModelBadge model={row.commercial_model} /></td>
                          <td style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 800 }}>{fmtInr(row.investment_amount)}</td>
                          <td style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 800 }}>{fmtInr(row.expected_sales)}</td>
                          <td style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 800, color: '#0F6E56' }}>{fmtInr(row.sales_captured)}</td>
                          <td style={{ padding: '11px 12px', textAlign: 'left', minWidth: 180 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, marginBottom: 4 }}>
                              <span>{row.achievement_pct}%</span>
                              <span style={{ color: '#888' }}>pace {row.expected_progress_pct}%</span>
                            </div>
                            <div style={{ height: 7, borderRadius: 4, background: '#f3f4f6', position: 'relative', overflow: 'hidden' }}>
                              <div style={{ height: 7, width: `${pct}%`, background: statusColor, borderRadius: 4 }} />
                              <div style={{ position: 'absolute', left: `${Math.max(0, Math.min(100, row.expected_progress_pct || 0))}%`, top: 0, bottom: 0, width: 2, background: '#111827', opacity: 0.35 }} />
                            </div>
                          </td>
                          <td style={{ padding: '11px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 800 }}>{row.deadline}</div>
                            <div style={{ fontSize: 10, color: row.days_left < 0 ? '#D85A30' : '#888' }}>
                              {row.days_left < 0 ? `${Math.abs(row.days_left)} days late` : `${row.days_left} days left`}
                            </div>
                          </td>
                          <td style={{ padding: '11px 12px', textAlign: 'right' }}><CommitmentStatusBadge status={row.status} /></td>
                          <td style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 900, color: row.shortfall > 0 ? '#D85A30' : '#0F6E56' }}>
                            {fmtInr(row.shortfall)}
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#888' }}>No investment commitments found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e5e7eb', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Doctor-Level Recovery Summary</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Worst status wins when a doctor has multiple investments.</div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      {['Doctor', 'Commitments', 'Invested', 'Expected', 'Sales', 'Achievement', 'Worst Status', 'Shortfall'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: h === 'Doctor' ? 'left' : 'right', fontSize: 11, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(displayCommitmentData?.doctor_summary || []).slice(0, 25).map(row => (
                      <tr key={row.doctor_id} style={{ borderBottom: '0.5px solid #f3f4f6' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 800 }}>
                          <div>{row.doctor_name}</div>
                          <div style={{ fontSize: 11, color: '#888', fontWeight: 500 }}>{[row.city, row.manager_name].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{row.commitments}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800 }}>{fmtInr(row.total_invested)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800 }}>{fmtInr(row.expected_sales)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: '#0F6E56' }}>{fmtInr(row.sales_captured)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800 }}>{row.achievement_pct}%</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}><CommitmentStatusBadge status={row.worst_status} /></td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 900, color: row.shortfall > 0 ? '#D85A30' : '#0F6E56' }}>{fmtInr(row.shortfall)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB: SPEND ANALYSIS */}
        {analyticsTab === 'spend' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            <div style={{ background: '#fff', borderRadius: 16, border: '0.5px solid #e5e7eb', padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Investment by Category</div>
              {['PD', 'RD', 'CS'].map(cat => {
                const d = displaySpendData?.category_breakdown?.[cat];
                const allTotal = displaySpendData ? Object.values(displaySpendData.category_breakdown || {}).reduce((s, v) => s + v.total, 0) : 0;
                const pct = allTotal > 0 ? Math.round(((d?.total) || 0) / allTotal * 100) : 0;
                const color = INV_CATEGORY_COLORS[cat];
                return (
                  <div key={cat} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div>
                        <span style={{ fontSize: 11, fontWeight: 700, color, marginRight: 6 }}>{cat}</span>
                        <span style={{ fontSize: 12, color: '#555' }}>{INV_CATEGORY_LABELS[cat]}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color }}>{fmtInr(d?.total || 0)}</span>
                        <span style={{ fontSize: 11, color: '#888', marginLeft: 6 }}>{d?.count || 0} entries</span>
                      </div>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: '#f3f4f6', overflow: 'hidden' }}>
                      <div style={{ height: 6, borderRadius: 3, width: `${pct}%`, background: color, transition: 'width 0.4s' }} />
                    </div>
                    <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{pct}% of total investment</div>
                  </div>
                );
              })}
            </div>

            <div style={{ background: '#fff', borderRadius: 16, border: '0.5px solid #e5e7eb', padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Investment by Activity</div>
              {(() => {
                const acts = (displaySpendData?.sub_activity_breakdown || []).filter(a => a.total > 0).sort((a, b) => b.total - a.total);
                if (acts.length === 0) return <div style={{ textAlign: 'center', color: '#888', padding: 24, fontSize: 13 }}>No activity data for this period</div>;
                const maxAct = acts[0].total;
                return acts.map(a => (
                  <div key={a.activity} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <span style={{ color: '#374151' }}>{a.activity}</span>
                      <span style={{ fontWeight: 600 }}>{fmtInr(a.total)}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: '#f3f4f6', overflow: 'hidden' }}>
                      <div style={{ height: 4, borderRadius: 2, width: `${(a.total / maxAct) * 100}%`, background: '#534AB7', transition: 'width 0.4s' }} />
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {/* TAB: CONCENTRATION RISK */}
        {analyticsTab === 'risk' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {displayRiskData && (
              <div style={{
                padding: '14px 20px', borderRadius: 12,
                background: displayRiskData.top5_pct >= 80 ? '#FEF2F2' : displayRiskData.top5_pct >= 60 ? '#FFFBEB' : '#F0FDF4',
                border: `1px solid ${displayRiskData.top5_pct >= 80 ? '#FECACA' : displayRiskData.top5_pct >= 60 ? '#FDE68A' : '#BBF7D0'}`,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <span style={{ fontSize: 24 }}>{displayRiskData.top5_pct >= 80 ? '🔴' : displayRiskData.top5_pct >= 60 ? '🟡' : '🟢'}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: displayRiskData.top5_pct >= 80 ? '#991B1B' : displayRiskData.top5_pct >= 60 ? '#92400E' : '#065f46' }}>
                    {displayRiskData.top5_pct >= 80
                      ? `Critical Concentration: Top 5 doctors = ${displayRiskData.top5_pct}% of business`
                      : displayRiskData.top5_pct >= 60
                      ? `Moderate Concentration: Top 5 doctors = ${displayRiskData.top5_pct}% of business`
                      : `Healthy Distribution: Top 5 doctors = ${displayRiskData.top5_pct}% of business`}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {displayRiskData.top5_pct >= 80
                      ? 'Critical dependency — losing any top account would severely impact revenue. Diversify urgently.'
                      : displayRiskData.top5_pct >= 60
                      ? 'Moderate concentration — develop mid-tier accounts to reduce dependency on top performers.'
                      : 'Business is well spread across accounts. Continue growing mid-tier doctors.'}
                    {' '}Top 10 = {displayRiskData.top10_pct}% of {fmtInr(displayRiskData.total_sales)} total business across {displayRiskData.doctor_count} doctors.
                  </div>
                </div>
              </div>
            )}

            <div style={{ background: '#fff', borderRadius: 16, border: '0.5px solid #e5e7eb', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Business Concentration by Doctor</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Cumulative % reaching 80% early = high concentration risk</div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      {['#', 'Doctor', 'Model', 'Grade', 'Business', '% of Total', 'Cumulative %'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: h === '#' || h === 'Doctor' ? 'left' : 'right', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRiskData?.top_doctors?.length > 0 ? displayRiskData.top_doctors.map((doc, i) => {
                      const gc = GRADE_COLORS[doc.roi_grade] || GRADE_COLORS.Bronze;
                      const cumulColor = doc.cumulative_pct >= 80 ? '#dc2626' : doc.cumulative_pct >= 60 ? '#d97706' : '#059669';
                      return (
                        <tr key={doc.doctor_id}
                          style={{ borderBottom: '0.5px solid #f3f4f6', background: i < 5 ? '#fffbeb33' : '#fff' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                          onMouseLeave={e => e.currentTarget.style.background = i < 5 ? '#fffbeb33' : '#fff'}>
                          <td style={{ padding: '10px 14px', color: '#9ca3af', fontWeight: 700 }}>{i + 1}</td>
                          <td style={{ padding: '10px 14px', fontWeight: 600 }}>{doc.doctor_name}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}><ModelBadge model={doc.commercial_model} /></td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}><GradeBadge grade={doc.roi_grade} /></td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#0F6E56' }}>{fmtInr(doc.sales)}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                              <div style={{ width: 60, height: 4, borderRadius: 2, background: '#f3f4f6', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(doc.pct_of_total, 100)}%`, height: 4, background: gc.dot, borderRadius: 2 }} />
                              </div>
                              <span style={{ fontWeight: 600 }}>{doc.pct_of_total}%</span>
                            </div>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: cumulColor }}>{doc.cumulative_pct}%</td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: '#888', fontSize: 13 }}>No data for this period</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>{/* end analytics section */}
      {/* Reference Guide Panel */}
      {showGuide && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingTop: 70, paddingRight: 24 }}>
          <div onClick={() => setShowGuide(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)' }} />
          <div style={{ position: 'relative', zIndex: 1, background: '#fff', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.18)', width: 380, maxHeight: '80vh', overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#0F6E56' }}>Reference Guide</div>
              <button onClick={() => setShowGuide(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#9ca3af' }}>x</button>
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>ROI Grade Thresholds</div>
              {[
                { icon: '🏆', grade: 'Platinum', threshold: '> 8x', color: '#7c3aed', bg: '#f5f3ff' },
                { icon: '🥇', grade: 'Gold',     threshold: '5-8x',  color: '#d97706', bg: '#fffbeb' },
                { icon: '🥈', grade: 'Silver',   threshold: '3-5x',  color: '#475569', bg: '#f8fafc' },
                { icon: '🥉', grade: 'Bronze',   threshold: '< 3x',  color: '#92400e', bg: '#fef3c7' },
              ].map(g => (
                <div key={g.grade} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: g.bg, marginBottom: 6 }}>
                  <span style={{ fontSize: 18 }}>{g.icon}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: g.color }}>{g.grade}</div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>ROI {g.threshold}</div>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Commercial Models</div>
              {COMMERCIAL_MODELS.map(cm => (
                <div key={cm.code} style={{ padding: '8px 12px', borderRadius: 8, background: cm.bg, border: `1px solid ${cm.color}22`, marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, background: cm.color, color: '#fff', padding: '2px 7px', borderRadius: 5 }}>{cm.code}</span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: cm.color }}>{cm.label}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{cm.desc}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: '10px 12px', borderRadius: 8, background: '#f9fafb', fontSize: 11, color: '#6b7280' }}>
              Achievement % = Actual Sales / Expected Sales x 100
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
