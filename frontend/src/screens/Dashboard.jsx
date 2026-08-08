import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dashboardAPI, roiAPI, salesAPI, targetsAPI } from '../api';

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
const INV_CATEGORY_LABELS = { PD: 'Professional Development', RD: 'Relationship Development', CS: 'Commercial Support' };
const INV_CATEGORY_COLORS = { PD: '#047857', RD: '#6D28D9', CS: '#B45309' };

function investmentCategorySummary(doc) {
  const grouped = {};
  (Array.isArray(doc?.investment_categories) ? doc.investment_categories : []).forEach(row => {
    const category = row.category || 'PD';
    const subCategory = row.sub_category && row.sub_category !== 'Other' ? row.sub_category : '';
    const key = `${category}__${subCategory}`;
    if (!grouped[key]) grouped[key] = { category, sub_category: subCategory, amount: 0 };
    grouped[key].amount += Number(row.amount) || 0;
  });
  return Object.values(grouped).sort((a, b) => b.amount - a.amount);
}

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
function InvestmentBar({ doc, pct, color, labelColor, height = 12, radius = 3, labelLeft = 6 }) {
  const [activeDot, setActiveDot] = useState(null);
  const rows = Array.isArray(doc.investment_months) ? doc.investment_months : [];
  const total = doc.total_invested || 0;
  const barPct = Math.max(0, Math.min(100, pct || 0));
  return (
    <div
      onMouseLeave={() => setActiveDot(null)}
      style={{ height, borderRadius: radius, background: '#f9fafb', overflow: 'visible', position: 'relative', cursor: 'pointer' }}
    >
      <div style={{ width: `${barPct}%`, height: '100%', background: color, borderRadius: radius }} />
      <span style={{ position: 'absolute', left: labelLeft, top: '50%', transform: 'translateY(-50%)', fontSize: 9, lineHeight: 1, fontWeight: 900, color: barPct > 32 ? '#fff' : labelColor, textShadow: barPct > 32 ? '0 1px 2px rgba(0,0,0,0.25)' : 'none', pointerEvents: 'none' }}>{fmtInr(total)}</span>
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
              <span style={{ position: 'absolute', left: '50%', bottom: height + 4, transform: 'translateX(-50%)', zIndex: 50, minWidth: 112, padding: '7px 9px', borderRadius: 8, background: '#111827', color: '#fff', boxShadow: '0 10px 28px rgba(0,0,0,0.22)', pointerEvents: 'none', textAlign: 'center' }}>
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
function SalesBar({ doc, pct, height = 8, radius = 2, markerPct = 0 }) {
  const [activeDot, setActiveDot] = useState(null);
  const rows = Array.isArray(doc.sales_months) ? doc.sales_months : [];
  const barPct = Math.max(0, Math.min(100, pct || 0));
  return (
    <div onMouseLeave={() => setActiveDot(null)} style={{ height, background: '#f9fafb', borderRadius: radius, overflow: 'visible', position: 'relative', cursor: 'pointer' }}>
      <div style={{ width: `${barPct}%`, height: '100%', background: '#0F6E56', borderRadius: radius }} />
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
              <span style={{ position: 'absolute', left: '50%', bottom: height + 4, transform: 'translateX(-50%)', zIndex: 50, minWidth: 112, padding: '7px 9px', borderRadius: 8, background: '#111827', color: '#fff', boxShadow: '0 10px 28px rgba(0,0,0,0.22)', pointerEvents: 'none', textAlign: 'center' }}>
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

function TargetAchievementCard({ title, subtitle, icon, accent, light, data, loading, onSetTarget, recovery }) {
  const target = Number(data?.target_value) || 0;
  const actual = Number(data?.actual_value) || 0;
  const remaining = Number(data?.remaining_value) || 0;
  const projected = Number(data?.projected_value) || 0;
  const rawPct = Number(data?.achievement_pct) || 0;
  const pct = Math.max(0, Math.min(100, rawPct));
  const status = data?.status || 'Target not set';
  const statusColor = status === 'Achieved' ? '#15803d' : status === 'On track' ? '#b45309' : status === 'Below pace' ? '#dc2626' : '#6b7280';
  const gapRows = (data?.products || []).filter(product => Number(product.target_value) > 0).slice(0, 4);
  return (
    <div style={{ background: '#fff', borderRadius: 16, border: `1.5px solid ${accent}28`, overflow: 'hidden', minWidth: 0 }}>
      <div style={{ padding: '14px 16px', background: `linear-gradient(135deg, ${light}, #fff)`, borderBottom: `1px solid ${accent}20` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', gap: 9, minWidth: 0 }}>
            <span style={{ fontSize: 19 }}>{icon}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#111827' }}>{title}</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{subtitle}</div>
            </div>
          </div>
          <span style={{ padding: '3px 9px', borderRadius: 20, background: `${statusColor}12`, color: statusColor, fontSize: 10, fontWeight: 900, whiteSpace: 'nowrap' }}>
            {loading ? 'Loading...' : status}
          </span>
        </div>
      </div>

      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 7 }}>
          {[
            ['Target', data?.has_target ? fmtInr(target) : 'Not set'],
            ['Actual', fmtInr(actual)],
            ['Remaining', data?.has_target ? fmtInr(remaining) : '—'],
            ['Projected', fmtInr(projected)],
          ].map(([label, value]) => (
            <div key={label} style={{ padding: '8px 9px', borderRadius: 9, background: '#f9fafb', border: '1px solid #f1f5f9', minWidth: 0 }}>
              <div style={{ fontSize: 9, color: '#9ca3af', fontWeight: 800, textTransform: 'uppercase' }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 900, color: label === 'Actual' ? accent : '#111827', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
            </div>
          ))}
        </div>

        {data?.has_target ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b7280', marginTop: 12, marginBottom: 5 }}>
              <span>{data.target_source || 'Assigned target'}</span>
              <strong style={{ color: statusColor }}>{rawPct >= 100 ? '100%+' : `${rawPct}%`}</strong>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: '#eef2f7', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, borderRadius: 999, background: statusColor, transition: 'width 0.35s' }} />
            </div>
            {gapRows.length > 0 && (
              <div style={{ marginTop: 11, borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>
                <div style={{ fontSize: 9, color: '#9ca3af', fontWeight: 800, textTransform: 'uppercase', marginBottom: 3 }}>Largest product gaps</div>
                {gapRows.map(product => (
                  <div key={product.product_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 10 }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#374151', fontWeight: 700 }}>{product.product_name}</span>
                    <span style={{ color: '#6b7280', flexShrink: 0 }}>{fmtInr(product.actual_value)} / {fmtInr(product.target_value)}</span>
                    <span style={{ color: Number(product.remaining_value) > 0 ? '#dc2626' : '#15803d', fontWeight: 800, width: 55, textAlign: 'right', flexShrink: 0 }}>
                      {Number(product.remaining_value) > 0 ? `${fmtInr(product.remaining_value)} gap` : 'Done'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ marginTop: 11, padding: '9px 10px', borderRadius: 9, background: light, color: '#4b5563', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span>Actual sales are shown, but no separate target is saved for this selection.</span>
            {onSetTarget && <button onClick={onSetTarget} style={{ border: 'none', borderRadius: 7, background: accent, color: '#fff', padding: '5px 8px', fontSize: 9, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>Set target</button>}
          </div>
        )}

        {recovery && (
          <div style={{ marginTop: 11, padding: '10px 11px', borderRadius: 10, background: '#fff7ed', border: '1px solid #fed7aa' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 900, color: '#9a3412' }}>Six-month Investment Recovery</div>
                <div style={{ fontSize: 9, color: '#c2410c', marginTop: 2 }}>{recovery.doctors} invested doctor{recovery.doctors === 1 ? '' : 's'} · {recovery.atRisk} at risk/breached</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: '#9a3412' }}>{recovery.achievementPct}%</div>
                <div style={{ fontSize: 9, color: '#c2410c' }}>{fmtInr(recovery.sales)} of {fmtInr(recovery.expected)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionCentre({ items, loading, onOpen }) {
  const [showAll, setShowAll] = useState(false);
  const severityStyle = {
    critical: { color: '#b91c1c', bg: '#fef2f2', border: '#fecaca', label: 'Urgent' },
    warning: { color: '#b45309', bg: '#fffbeb', border: '#fde68a', label: 'Attention' },
    info: { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', label: 'Follow up' },
  };
  const typeIcons = {
    regional_update: '▦', weekly_pdf: 'PDF', task: '✓', approval: '⌁', visit: '⌖',
    investment: '₹', doctor_target: '✦', regional_target: '◆',
  };
  const urgent = items.filter(item => item.severity === 'critical').length;
  const attention = items.filter(item => item.severity === 'warning').length;
  const visible = showAll ? items : items.slice(0, 6);
  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', marginBottom: 20, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'linear-gradient(135deg,#fff 0%,#f8fafc 100%)', borderBottom: '1px solid #f1f5f9' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
            Manager Action Centre
            {!loading && urgent > 0 && <span style={{ fontSize: 10, color: '#b91c1c', background: '#fee2e2', borderRadius: 20, padding: '2px 8px' }}>{urgent} urgent</span>}
            {!loading && attention > 0 && <span style={{ fontSize: 10, color: '#b45309', background: '#fef3c7', borderRadius: 20, padding: '2px 8px' }}>{attention} need attention</span>}
          </div>
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>What needs action now · click an item to open the related work</div>
        </div>
        <div style={{ fontSize: 10, color: '#9ca3af' }}>{loading ? 'Checking…' : `${items.length} action${items.length === 1 ? '' : 's'}`}</div>
      </div>

      {loading ? (
        <div style={{ padding: 28, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>Checking team activity…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', background: '#f0fdf4', color: '#166534', fontSize: 12, fontWeight: 700 }}>
          ✓ No urgent actions for this selection
        </div>
      ) : (
        <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 8 }}>
          {visible.map(item => {
            const style = severityStyle[item.severity] || severityStyle.info;
            return (
              <button key={item.id} onClick={() => item.action_path && onOpen(item.action_path)}
                style={{ border: `1px solid ${style.border}`, background: style.bg, borderRadius: 11, padding: '10px 11px', textAlign: 'left', cursor: item.action_path ? 'pointer' : 'default', minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: '#fff', color: style.color, border: `1px solid ${style.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: item.type === 'weekly_pdf' ? 8 : 13, fontWeight: 900, flexShrink: 0 }}>
                    {typeIcons[item.type] || '!'}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 900, color: '#111827' }}>{item.title}</span>
                      <span style={{ fontSize: 8, fontWeight: 900, color: style.color, textTransform: 'uppercase', flexShrink: 0 }}>{style.label}</span>
                    </span>
                    <span style={{ display: 'block', fontSize: 9, color: '#6b7280', marginTop: 2 }}>{item.detail}</span>
                    {(item.names || []).length > 0 && (
                      <span style={{ display: 'block', fontSize: 9, color: style.color, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.names.join(' · ')}{Number(item.count) > item.names.length ? ` · +${Number(item.count) - item.names.length} more` : ''}
                      </span>
                    )}
                  </span>
                  {item.action_path && <span style={{ color: style.color, fontSize: 14, flexShrink: 0 }}>›</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {!loading && items.length > 6 && (
        <button onClick={() => setShowAll(value => !value)} style={{ width: '100%', padding: 8, border: 'none', borderTop: '1px solid #f1f5f9', background: '#fff', color: '#4b5563', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>
          {showAll ? 'Show fewer actions' : `Show ${items.length - 6} more actions`}
        </button>
      )}
    </div>
  );
}

function TerritoryPerformanceMatrix({ data, loading, month, year, onOpen, onSetTarget }) {
  const rows = data?.rows || [];
  const statusStyle = {
    critical: { color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
    warning: { color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
    good: { color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
    neutral: { color: '#6b7280', bg: '#f8fafc', border: '#e2e8f0' },
  };
  const cellButton = { width: '100%', border: 'none', background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' };

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', marginBottom: 20, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'linear-gradient(135deg,#f8fafc 0%,#eff6ff 100%)', borderBottom: '1px solid #e2e8f0' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#111827' }}>Territory Performance</div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{MONTH_NAMES[month]} {year} · regional and doctor sales remain separate · click a value to open details</div>
        </div>
        <div style={{ fontSize: 10, color: '#64748b', background: '#fff', border: '1px solid #dbeafe', borderRadius: 20, padding: '4px 9px', whiteSpace: 'nowrap' }}>
          {loading ? 'Updating…' : `${rows.length} territor${rows.length === 1 ? 'y' : 'ies'}`}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>Building territory view…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 26, textAlign: 'center', color: '#64748b', fontSize: 12 }}>No territories are available for this selection.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 1040, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Territory', 'Regional Sales', 'Doctor Sales', 'Investment Recovery', 'Doctor Coverage', 'Follow-up', 'Status'].map(label => (
                  <th key={label} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', color: '#64748b', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const status = statusStyle[row.status_level] || statusStyle.neutral;
                const regionalPct = Math.min(100, Number(row.regional_achievement_pct) || 0);
                const issueCount = Number(row.missing_updates || 0) + Number(row.missing_pdfs || 0) + Number(row.pdf_mismatches || 0) + Number(row.overdue_tasks || 0);
                return (
                  <tr key={row.territory} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px', minWidth: 130 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a' }}>{row.territory}</div>
                      <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>{toStateName(row.state_code)}</div>
                    </td>
                    <td style={{ padding: '10px 12px', minWidth: 170 }}>
                      <button onClick={() => onOpen('/regional-sales')} style={cellButton} title="Open Regional Sales">
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 900, color: '#2563eb' }}>{fmtInr(row.regional_sales)}</span>
                          <span style={{ fontSize: 9, color: row.regional_target > 0 ? '#64748b' : '#b45309' }}>
                            {row.regional_target > 0 ? `${row.regional_achievement_pct}%` : 'Target not set'}
                          </span>
                        </div>
                        <div style={{ height: 4, borderRadius: 3, background: '#dbeafe', marginTop: 5, overflow: 'hidden' }}>
                          <div style={{ width: `${regionalPct}%`, height: '100%', background: row.regional_achievement_pct >= 100 ? '#10b981' : '#2563eb', borderRadius: 3 }} />
                        </div>
                        <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 4 }}>Target {fmtInr(row.regional_target)} ›</div>
                      </button>
                    </td>
                    <td style={{ padding: '10px 12px', minWidth: 120 }}>
                      <button onClick={() => onOpen('/investment-roi')} style={cellButton} title="Open doctor-wise sales">
                        <div style={{ fontSize: 13, fontWeight: 900, color: '#0f6e56' }}>{fmtInr(row.doctor_sales)}</div>
                        <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 4 }}>Doctor entries only ›</div>
                      </button>
                    </td>
                    <td style={{ padding: '10px 12px', minWidth: 190 }}>
                      <button onClick={() => onOpen('/investment-roi')} style={cellButton} title="Open investment recovery">
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: '#c2410c' }}>{fmtInr(row.investment)} invested</span>
                          <span style={{ fontSize: 10, fontWeight: 900, color: row.recovery_pct >= 100 ? '#047857' : '#c2410c' }}>{row.recovery_pct}%</span>
                        </div>
                        <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 4 }}>{fmtInr(row.recovery_sales)} of {fmtInr(row.recovery_expected)} recovered</div>
                        {(row.recovery_at_risk > 0 || row.recovery_breached > 0) && (
                          <div style={{ fontSize: 9, color: row.recovery_breached > 0 ? '#b91c1c' : '#b45309', fontWeight: 800, marginTop: 3 }}>
                            {row.recovery_breached > 0 ? `${row.recovery_breached} breached` : ''}{row.recovery_breached > 0 && row.recovery_at_risk > 0 ? ' · ' : ''}{row.recovery_at_risk > 0 ? `${row.recovery_at_risk} at risk` : ''}
                          </div>
                        )}
                      </button>
                    </td>
                    <td style={{ padding: '10px 12px', minWidth: 140 }}>
                      <button onClick={() => onOpen('/visit-log')} style={cellButton} title="Open visit log">
                        <div style={{ fontSize: 12, fontWeight: 900, color: row.visit_coverage_pct >= 60 ? '#047857' : '#b45309' }}>{row.visit_coverage_pct}% visited</div>
                        <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 4 }}>{row.visited_30d} of {row.active_doctors} active doctors · 30 days ›</div>
                      </button>
                    </td>
                    <td style={{ padding: '10px 12px', minWidth: 170 }}>
                      <button onClick={() => onOpen(row.overdue_tasks > 0 ? '/tasks' : '/regional-sales')} style={cellButton}>
                        {issueCount === 0 && row.open_tasks === 0 ? (
                          <div style={{ fontSize: 10, color: '#047857', fontWeight: 800 }}>No pending follow-up</div>
                        ) : (
                          <>
                            <div style={{ fontSize: 10, fontWeight: 800, color: issueCount > 0 ? '#b45309' : '#475569' }}>
                              {row.missing_updates} updates · {row.missing_pdfs} PDFs
                            </div>
                            <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 4 }}>{row.pdf_mismatches} mismatches · {row.overdue_tasks} overdue tasks ›</div>
                          </>
                        )}
                      </button>
                    </td>
                    <td style={{ padding: '10px 12px', minWidth: 110 }}>
                      <span style={{ display: 'inline-block', fontSize: 9, fontWeight: 900, color: status.color, background: status.bg, border: `1px solid ${status.border}`, borderRadius: 20, padding: '4px 8px', whiteSpace: 'nowrap' }}>{row.status}</span>
                      {row.regional_target <= 0 && onSetTarget && (
                        <button onClick={onSetTarget} style={{ display: 'block', border: 'none', background: 'transparent', color: '#2563eb', fontSize: 9, fontWeight: 800, padding: '5px 0 0', cursor: 'pointer' }}>Set target ›</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
  const investmentCategories = Object.entries(data.investment_by_category || {})
    .filter(([, categoryData]) => Number(categoryData?.total) > 0)
    .sort((a, b) => Number(b[1].total) - Number(a[1].total));

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

      {investmentCategories.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #BBF7D0', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#065F46', marginBottom: 10 }}>Investment Categories</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
            {investmentCategories.map(([category, categoryData]) => (
              <div key={category} style={{ background: '#F8FAFC', border: `1px solid ${INV_CATEGORY_COLORS[category] || '#d1d5db'}33`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 900, color: INV_CATEGORY_COLORS[category] || '#6b7280' }}>{category}</span>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>{INV_CATEGORY_LABELS[category] || category}</div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 900, color: INV_CATEGORY_COLORS[category] || '#374151' }}>{fmtInr(categoryData.total)}</span>
                </div>
                {(categoryData.items || []).map((item, index) => (
                  <div key={`${item.sub_category}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 5, marginTop: index ? 5 : 0, borderTop: '1px solid #e5e7eb', fontSize: 10 }}>
                    <span style={{ color: '#4b5563' }}>{item.sub_category || 'Other'}</span>
                    <span style={{ color: '#111827', fontWeight: 700 }}>{fmtInr(item.amount)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

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
  const [topProducts, setTopProducts] = useState([]);
  const [regionalSalesRows, setRegionalSalesRows] = useState([]);
  const [targetAchievement, setTargetAchievement] = useState(null);
  const [targetLoading, setTargetLoading] = useState(false);
  const [commitmentData, setCommitmentData] = useState(null);
  const [actionCentreData, setActionCentreData] = useState(null);
  const [actionCentreLoading, setActionCentreLoading] = useState(false);
  const [territoryPerformance, setTerritoryPerformance] = useState(null);
  const [territoryPerformanceLoading, setTerritoryPerformanceLoading] = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [dashboardScope, setDashboardScope] = useState('overall');

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
    ]).then(([docRes, userRes]) => {
      const docs  = docRes.data  || [];
      const users = userRes.data || [];
      setAllDoctors(docs);
      setAllUsers(users);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [me?.id, startDate, endDate, year, month]);

  useEffect(() => {
    if (!me?.id) return;
    salesAPI.regional(me.id, year, month, null)
      .then(response => setRegionalSalesRows(Array.isArray(response.data) ? response.data : []))
      .catch(() => setRegionalSalesRows([]));
  }, [me?.id, year, month]);

  const activeVisibleUsers = useMemo(
    () => allUsers.filter(user => user.is_active !== false),
    [allUsers]
  );
  const teamUsers = useMemo(
    () => activeVisibleUsers.filter(user => Number(user.id) !== Number(me?.id)),
    [activeVisibleUsers, me?.id]
  );
  const hasReports = teamUsers.length > 0;
  const scopeUsers = useMemo(() => {
    if (!hasReports || dashboardScope === 'mine') {
      return activeVisibleUsers.filter(user => Number(user.id) === Number(me?.id));
    }
    if (dashboardScope === 'team') return teamUsers;
    return activeVisibleUsers;
  }, [activeVisibleUsers, dashboardScope, hasReports, me?.id, teamUsers]);
  const scopeUserIds = useMemo(
    () => new Set(scopeUsers.map(user => Number(user.id))),
    [scopeUsers]
  );
  const scopedDoctors = useMemo(
    () => allDoctors.filter(doctor => scopeUserIds.has(Number(doctor.manager_id))),
    [allDoctors, scopeUserIds]
  );
  const effectiveScope = hasReports ? dashboardScope : 'mine';

  useEffect(() => {
    if (!me?.id) return;
    let cancelled = false;
    setTopProducts([]);
    axios.get(`${API}/sales/by-product`, {
      params: {
        year,
        month,
        start_date: startDate,
        end_date: endDate,
        viewer_id: me.id,
        owner_scope: effectiveScope,
      },
    }).then(response => { if (!cancelled) setTopProducts(response.data || []); })
      .catch(() => { if (!cancelled) setTopProducts([]); });
    return () => { cancelled = true; };
  }, [me?.id, year, month, startDate, endDate, effectiveScope]);

  useEffect(() => {
    if (!me?.id) return;
    let cancelled = false;
    setTargetLoading(true);
    targetsAPI.dashboard(me.id, year, month, effectiveScope, {
      ...(selRegion ? { state_code: selRegion } : {}),
      ...(selCity ? { city: selCity } : {}),
    }).then(response => {
      if (!cancelled) setTargetAchievement(response.data || null);
    }).catch(() => {
      if (!cancelled) setTargetAchievement(null);
    }).finally(() => {
      if (!cancelled) setTargetLoading(false);
    });
    return () => { cancelled = true; };
  }, [me?.id, year, month, effectiveScope, selRegion, selCity]);

  useEffect(() => {
    if (!me?.id) return;
    let cancelled = false;
    setActionCentreLoading(true);
    dashboardAPI.actionCenter(me.id, effectiveScope, {
      today: todayStr(),
      ...(selRegion ? { state_code: selRegion } : {}),
      ...(selCity ? { city: selCity } : {}),
    }).then(response => {
      if (!cancelled) setActionCentreData(response.data || null);
    }).catch(() => {
      if (!cancelled) setActionCentreData(null);
    }).finally(() => {
      if (!cancelled) setActionCentreLoading(false);
    });
    return () => { cancelled = true; };
  }, [me?.id, effectiveScope, selRegion, selCity]);

  useEffect(() => {
    if (!me?.id) return;
    let cancelled = false;
    setTerritoryPerformanceLoading(true);
    dashboardAPI.territoryPerformance(me.id, year, month, effectiveScope, {
      as_of: endDate,
      ...(selRegion ? { state_code: selRegion } : {}),
      ...(selCity ? { city: selCity } : {}),
    }).then(response => {
      if (!cancelled) setTerritoryPerformance(response.data || null);
    }).catch(() => {
      if (!cancelled) setTerritoryPerformance(null);
    }).finally(() => {
      if (!cancelled) setTerritoryPerformanceLoading(false);
    });
    return () => { cancelled = true; };
  }, [me?.id, year, month, effectiveScope, endDate, selRegion, selCity]);

  useEffect(() => {
    if (!me?.id) return;
    let cancelled = false;
    roiAPI.commitmentRecovery({ viewer_id: me.id, as_of: endDate })
      .then(response => { if (!cancelled) setCommitmentData(response.data || null); })
      .catch(() => { if (!cancelled) setCommitmentData(null); });
    return () => { cancelled = true; };
  }, [me?.id, endDate]);

  const docCounts = useMemo(() => {
    const counts = {};
    scopedDoctors.forEach(doctor => {
      if (doctor.manager_id) counts[doctor.manager_id] = (counts[doctor.manager_id] || 0) + 1;
    });
    return counts;
  }, [scopedDoctors]);

  const allRegions = useMemo(() => {
    const seen = new Set();
    scopedDoctors.forEach(d => { const s = toStateName(d.state_code); if (s) seen.add(s); });
    return [...seen].sort();
  }, [scopedDoctors]);

  const cityList = useMemo(() => {
    const src = selRegion ? scopedDoctors.filter(d => toStateName(d.state_code) === selRegion) : scopedDoctors;
    const counts = {};
    src.forEach(d => { const c = normCity(d.city); if (c) counts[c] = (counts[c] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [scopedDoctors, selRegion]);

  const displayDoctors = useMemo(() => {
    let d = selRegion ? scopedDoctors.filter(x => toStateName(x.state_code) === selRegion) : scopedDoctors;
    if (selCity) d = d.filter(x => normCity(x.city) === selCity);
    return d;
  }, [scopedDoctors, selRegion, selCity]);

  const totalRegionalSales = useMemo(() => regionalSalesRows
    .filter(row => scopeUserIds.has(Number(row.associate_id)))
    .filter(row => !selRegion || toStateName(row.state_code) === selRegion)
    .filter(row => !selCity || normCity(row.city) === selCity)
    .reduce((sum, row) => sum + (Number(row.value) || 0), 0),
  [regionalSalesRows, scopeUserIds, selRegion, selCity]);

  const clientStats = useMemo(() => {
    const prescribed = displayDoctors.filter(doctor => Number(doctor.actual_sales) > 0).length;
    return {
      prescribed,
      not_prescribed: Math.max(0, displayDoctors.length - prescribed),
    };
  }, [displayDoctors]);

  const investmentRecovery = useMemo(() => {
    const rows = (commitmentData?.doctor_summary || [])
      .filter(row => scopeUserIds.has(Number(row.manager_id)))
      .filter(row => !selRegion || toStateName(row.state_code) === selRegion)
      .filter(row => !selCity || normCity(row.city) === selCity);
    const expected = rows.reduce((sum, row) => sum + (Number(row.expected_sales) || 0), 0);
    const sales = rows.reduce((sum, row) => sum + (Number(row.sales_captured) || 0), 0);
    const atRiskCount = rows.filter(row => ['At Risk', 'Breached'].includes(row.worst_status)).length;
    const breached = rows.filter(row => row.worst_status === 'Breached').length;
    return {
      doctors: rows.length,
      expected,
      sales,
      shortfall: Math.max(0, expected - sales),
      atRisk: atRiskCount,
      breached,
      achievementPct: expected > 0 ? Math.round((sales / expected) * 1000) / 10 : 0,
    };
  }, [commitmentData, scopeUserIds, selRegion, selCity]);

  const actionItems = useMemo(() => {
    const items = [...(actionCentreData?.items || [])];
    const doctorTarget = targetAchievement?.doctor_sales;
    const regionalTarget = targetAchievement?.regional_sales;
    if (doctorTarget?.has_target && doctorTarget.status === 'Below pace') {
      items.push({
        id: 'doctor-target-below-pace', type: 'doctor_target', severity: 'warning',
        title: 'Doctor sales target is below pace',
        detail: `${doctorTarget.achievement_pct}% achieved · ${fmtInr(doctorTarget.remaining_value)} remaining`,
        count: 1, names: [], action_path: '/investment-roi',
      });
    }
    if (regionalTarget?.has_target && regionalTarget.status === 'Below pace') {
      items.push({
        id: 'regional-target-below-pace', type: 'regional_target', severity: 'warning',
        title: 'Regional sales target is below pace',
        detail: `${regionalTarget.achievement_pct}% achieved · ${fmtInr(regionalTarget.remaining_value)} remaining`,
        count: 1, names: [], action_path: '/regional-sales',
      });
    } else if (me?.role === 'md' && regionalTarget && !regionalTarget.has_target) {
      items.push({
        id: 'regional-target-not-set', type: 'regional_target', severity: 'info',
        title: 'Regional sales target is not set',
        detail: `${MONTH_NAMES[month]} ${year} · add territory-wise product targets`,
        count: 1, names: [], action_path: '/target-setting',
      });
    }
    if (investmentRecovery.breached > 0) {
      items.push({
        id: 'investment-recovery-breached', type: 'investment', severity: 'critical',
        title: `${investmentRecovery.breached} investment recover${investmentRecovery.breached === 1 ? 'y has' : 'ies have'} breached deadline`,
        detail: `Six-month recovery · ${fmtInr(investmentRecovery.shortfall)} total shortfall`,
        count: investmentRecovery.breached, names: [], action_path: '/investment-roi',
      });
    } else if (investmentRecovery.atRisk > 0) {
      items.push({
        id: 'investment-recovery-risk', type: 'investment', severity: 'warning',
        title: `${investmentRecovery.atRisk} investment recover${investmentRecovery.atRisk === 1 ? 'y is' : 'ies are'} at risk`,
        detail: `Six-month recovery · ${fmtInr(investmentRecovery.shortfall)} total shortfall`,
        count: investmentRecovery.atRisk, names: [], action_path: '/investment-roi',
      });
    }
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return items.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || (Number(b.count) || 0) - (Number(a.count) || 0));
  }, [actionCentreData, targetAchievement, investmentRecovery, me?.role, month, year]);

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

  const teamListUsers = scopeUsers.filter(u => Number(u.id) !== Number(me?.id) && u.role !== 'admin');
  const totalTeams = teamListUsers.length;
  const totalDocs  = displayDoctors.length;
  const ownDoctorCount = allDoctors.filter(doctor => Number(doctor.manager_id) === Number(me?.id)).length;
  const teamUserIds = new Set(teamUsers.map(user => Number(user.id)));
  const teamDoctorCount = allDoctors.filter(doctor => teamUserIds.has(Number(doctor.manager_id))).length;

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

        {/* Ownership scope — managers can have their own doctors as well as a team */}
        {hasReports && (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', marginRight: 2 }}>View</span>
            {[
              { value: 'overall', label: 'Overall', count: ownDoctorCount + teamDoctorCount, hint: 'Own doctors + reportees' },
              { value: 'mine', label: 'My Business', count: ownDoctorCount, hint: 'Doctors directly assigned to you' },
              { value: 'team', label: 'My Team', count: teamDoctorCount, hint: 'Doctors owned by your reportees' },
            ].map(option => {
              const active = dashboardScope === option.value;
              return (
                <button
                  key={option.value}
                  title={option.hint}
                  onClick={() => {
                    setDashboardScope(option.value);
                    setSelRegion(null); setSelCity(null); setSelState(null);
                    setSelUser(null); setSelDoctor(null); setSelProduct(null);
                    setShowSalesPanel(false); setShowInvestPanel(false); setShowROIPanel(false);
                    setView('overview');
                  }}
                  style={{
                    padding: '6px 13px', borderRadius: 9, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                    border: active ? '1.5px solid #F5B800' : '1.5px solid rgba(255,255,255,0.16)',
                    background: active ? 'rgba(245,184,0,0.22)' : 'rgba(255,255,255,0.07)',
                    color: active ? '#FDE68A' : 'rgba(255,255,255,0.72)',
                    boxShadow: active ? '0 3px 14px rgba(245,184,0,0.18)' : 'none',
                  }}
                >
                  {option.label} <span style={{ opacity: 0.65, fontWeight: 700 }}>· {option.count}</span>
                </button>
              );
            })}
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.48)', marginLeft: 3 }}>
              {dashboardScope === 'mine' ? 'Your directly assigned doctors' : dashboardScope === 'team' ? `${teamUsers.length} team member${teamUsers.length === 1 ? '' : 's'}` : 'Your business and team combined'}
            </span>
          </div>
        )}

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
          const CARD_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#0F6E56', '#C2410C'];
          const roiStatus = fmtROIStatus(totalSales, totalInvested, overallROI);
          const cards = [
            ...(hasReports && dashboardScope !== 'mine' ? [
              { icon: '◈', label: 'Team', val: totalTeams, action: () => { closeAllPanels(); setView('all-teams'); setSelUser(null); } },
            ] : []),
            { icon: '✦', label: 'Clients',    val: totalDocs,             action: () => { closeAllPanels(); setView('all-clients'); setClientSearch(''); setClientsVisible(8); }, prescribed: clientStats?.prescribed, notPrescribed: clientStats?.not_prescribed },
            { icon: '◆', label: 'Doctor-wise Sales', val: fmtInr(totalSales), action: () => { setView('overview'); setShowInvestPanel(false); setShowROIPanel(false); setShowSalesPanel(s => !s); setSelProduct(null); setShowAllProducts(false); setShowAllProdDoctors(false); } },
            { icon: '▦', label: 'Regional Sales', val: fmtInr(totalRegionalSales), action: () => navigate('/regional-sales') },
            { icon: '◈', label: 'Investment', val: fmtInr(totalInvested), action: () => { setView('overview'); setShowSalesPanel(false); setShowROIPanel(false); setShowInvestPanel(s => !s); setShowAllInvest(false); } },
            { icon: '◇', label: 'ROI',        val: fmtROIValue(totalSales, totalInvested, overallROI),      action: () => { setView('overview'); setShowSalesPanel(false); setShowInvestPanel(false); setShowROIPanel(s => !s); }, sub: roiStatus },
          ];
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginTop: 20, position: 'relative', zIndex: 2 }}>
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

            <ActionCentre
              items={actionItems}
              loading={actionCentreLoading || targetLoading}
              onOpen={path => navigate(path)}
            />

            <TerritoryPerformanceMatrix
              data={territoryPerformance}
              loading={territoryPerformanceLoading}
              month={month}
              year={year}
              onOpen={path => navigate(path)}
              onSetTarget={me?.role === 'md' ? () => navigate('/target-setting') : null}
            />

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
                                params: { year, month, start_date: startDate, end_date: endDate, viewer_id: me.id, owner_scope: effectiveScope }
                              }).then(r => {
                                const visibleDoctorIds = new Set(displayDoctors.map(doctor => Number(doctor.doctor_id || doctor.id)));
                                setProductDoctors((r.data || []).filter(doctor => visibleDoctorIds.has(Number(doctor.doctor_id))));
                              }).finally(() => setProductDoctorsLoading(false));
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
                        const categories = investmentCategorySummary(d);
                        return (
                          <div key={d.doctor_id}
                            onClick={() => {
                              const manager = allUsers.find(user => user.id === d.manager_id);
                              setSelDoctor(d);
                              setSelUser(manager || null);
                              setView('product');
                              setShowInvestPanel(false);
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: 10,
                            padding: '9px 10px', borderRadius: 10, marginBottom: 4, borderLeft: `3px solid ${c}`, cursor: 'pointer' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#F0FDF4'}
                            onMouseLeave={e => e.currentTarget.style.background = ''}
                          >
                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: c,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 10, fontWeight: 900, color: '#fff', flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#065F46' }}>{d.doctor_name}</div>
                              {categories.length > 0 && (
                                <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', marginTop: 3 }}>
                                  {categories.slice(0, 2).map(item => (
                                    <span key={`${item.category}-${item.sub_category}`} title={INV_CATEGORY_LABELS[item.category] || item.category}
                                      style={{ fontSize: 9, fontWeight: 800, color: INV_CATEGORY_COLORS[item.category] || '#6b7280', background: `${INV_CATEGORY_COLORS[item.category] || '#6b7280'}12`, padding: '1px 5px', borderRadius: 8 }}>
                                      {item.category}{item.sub_category ? ` · ${item.sub_category}` : ''}
                                    </span>
                                  ))}
                                  {categories.length > 2 && <span style={{ fontSize: 9, color: '#9ca3af' }}>+{categories.length - 2} more</span>}
                                </div>
                              )}
                              <div style={{ marginTop: 4 }}>
                                <InvestmentBar doc={d} pct={pct} color={c} labelColor="#065F46" height={12} radius={6} labelLeft={8} />
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

            {/* Two independent sales tracks — never combined into one total */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, marginBottom: 20 }}>
              <TargetAchievementCard
                title="Regional Target vs Achievement"
                subtitle={`${MONTH_NAMES[month]} ${year} · regional entries only · doctor sales excluded`}
                icon="▦"
                accent="#2563EB"
                light="#EFF6FF"
                data={targetAchievement?.regional_sales}
                loading={targetLoading}
                onSetTarget={me?.role === 'md' ? () => navigate('/target-setting') : null}
              />
              <TargetAchievementCard
                title="Doctor Business & Investment Recovery"
                subtitle={`${MONTH_NAMES[month]} ${year} · doctor-wise entries only · regional sales excluded`}
                icon="✦"
                accent="#0F6E56"
                light="#ECFDF5"
                data={targetAchievement?.doctor_sales}
                loading={targetLoading}
                onSetTarget={me?.role === 'md' ? () => navigate('/target-setting') : null}
                recovery={investmentRecovery.doctors > 0 ? investmentRecovery : null}
              />
            </div>

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
                            <div style={{ flex: 1 }}>
                              <InvestmentBar doc={doc} pct={invPct} color="#f97316" labelColor="#f97316" />
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#f97316', width: 52, textAlign: 'right', flexShrink: 0 }}>{fmtInr(doc.total_invested)}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 9, color: '#0F6E56', width: 40, textAlign: 'right', flexShrink: 0 }}>Sales</span>
                            <div style={{ flex: 1 }}>
                              <SalesBar doc={doc} pct={salesPct} markerPct={invPct} />
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
              <TeamDrill stateName={selState} users={teamListUsers} docCounts={docCounts}
                onSelect={u => { setSelUser(u); setView('team'); }} />
            </div>
          );
        })()}

        {/* ALL TEAMS */}
        {view === 'all-teams' && (
          <div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
              {teamListUsers.length} team members · click a card to see their clients
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {teamListUsers.map(u => {
                const cnt      = docCounts[u.id] || 0;
                const repSales = scopedDoctors.filter(d => d.manager_id === u.id).reduce((a,d) => a + (d.actual_sales||0), 0);
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
              const filtered = displayDoctors.filter(d =>
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
