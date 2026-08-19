import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dashboardAPI, roiAPI, salesAPI, targetsAPI } from '../api';
import DrilldownPanel from '../components/DrilldownPanel';
import DashboardCharts from '../components/DashboardCharts';

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
function fmtPeriodDate(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}
function previousMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}
function salesTrend(currentValue, previousValue, previousLabel) {
  const current = Number(currentValue) || 0;
  const previous = Number(previousValue) || 0;
  if (previous <= 0) {
    return current > 0
      ? { label: `Monthly sales: new activity vs ${previousLabel}`, tone: 'positive' }
      : { label: `Monthly sales: none in ${previousLabel}`, tone: 'neutral' };
  }
  const change = Math.round(((current - previous) / previous) * 1000) / 10;
  return {
    label: `Monthly sales ${change >= 0 ? '↑' : '↓'} ${Math.abs(change)}% vs ${previousLabel}`,
    tone: change >= 0 ? 'positive' : 'negative',
  };
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

function DecisionMetricCard({
  title, period, icon, accent, value, status, statusTone = 'neutral',
  targetLabel, achievementPct, trend, detail, completeness, actionLabel, onOpen,
}) {
  const tone = {
    positive: { color: '#2A6B2D', bg: '#EAF5EA' },
    warning: { color: '#A07A00', bg: '#FFF8D6' },
    negative: { color: '#D93025', bg: '#FFF0EF' },
    neutral: { color: '#5C5A52', bg: '#F5F4F0' },
  }[statusTone] || { color: '#5C5A52', bg: '#F5F4F0' };
  const pct = achievementPct == null ? null : Math.max(0, Math.min(100, Number(achievementPct) || 0));
  const trendTone = trend?.tone === 'positive' ? '#2A6B2D' : trend?.tone === 'negative' ? '#D93025' : '#5C5A52';
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        minWidth: 0, width: '100%', padding: 0, textAlign: 'left', cursor: 'pointer',
        background: '#FFFFFF', border: '1px solid #E8E6DF', borderRadius: 12,
        overflow: 'hidden', boxShadow: '0 1px 3px rgba(26,26,26,0.08)',
      }}
    >
      <div style={{ height: 4, background: accent }} />
      <div style={{ padding: '14px 15px 13px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A', letterSpacing: 0.2 }}>{title}</div>
            <div style={{ fontSize: 10, color: '#9E9B8E', marginTop: 3, lineHeight: 1.35 }}>{period}</div>
          </div>
          <span style={{ fontSize: 18, lineHeight: 1, color: accent }}>{icon}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 9, marginTop: 11 }}>
          <div style={{ fontSize: 24, lineHeight: 1, fontWeight: 700, color: '#1A1A1A', letterSpacing: '-0.4px' }}>{value}</div>
          <span style={{ fontSize: 10, fontWeight: 600, color: tone.color, background: tone.bg, borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap' }}>{status}</span>
        </div>
        {(targetLabel || pct != null) && (
          <div style={{ marginTop: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, color: '#5C5A52', marginBottom: 5 }}>
              <span>{targetLabel || 'Progress'}</span>
              <strong style={{ color: tone.color, fontWeight: 600 }}>{pct == null ? '—' : `${Math.round(Number(achievementPct) * 10) / 10}%`}</strong>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: '#E8E6DF', overflow: 'hidden' }}>
              <div style={{ width: `${pct || 0}%`, height: '100%', borderRadius: 99, background: accent }} />
            </div>
          </div>
        )}
        {trend?.label && <div style={{ fontSize: 11, color: trendTone, fontWeight: 600, marginTop: 9 }}>{trend.label}</div>}
        {detail && <div style={{ fontSize: 11, color: '#5C5A52', marginTop: 7, lineHeight: 1.4 }}>{detail}</div>}
        {completeness && <div style={{ fontSize: 10, color: '#9E9B8E', marginTop: 5, lineHeight: 1.4 }}>{completeness}</div>}
        <div style={{ fontSize: 11, color: accent, fontWeight: 600, marginTop: 11 }}>{actionLabel} →</div>
      </div>
    </button>
  );
}

function DashboardDrilldownDrawer({ config, context, onClose, onOpenFull }) {
  useEffect(() => {
    const onKeyDown = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  if (!config) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', justifyContent: 'flex-end' }}>
      <button aria-label="Close details" onClick={onClose} style={{ position: 'absolute', inset: 0, border: 'none', background: 'rgba(15,23,42,0.42)', cursor: 'default' }} />
      <aside style={{ position: 'relative', width: 'min(460px, 94vw)', height: '100%', background: '#fff', boxShadow: '-16px 0 48px rgba(15,23,42,0.22)', overflowY: 'auto' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, padding: '18px 20px 15px', background: `linear-gradient(135deg, ${config.accent} 0%, ${config.accent}dd 100%)`, color: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, opacity: 0.72, textTransform: 'uppercase', letterSpacing: 1 }}>Dashboard drill-down</div>
              <div style={{ fontSize: 20, fontWeight: 900, marginTop: 4 }}>{config.icon} {config.title}</div>
              <div style={{ fontSize: 11, opacity: 0.78, marginTop: 3 }}>{config.period}</div>
            </div>
            <button onClick={onClose} aria-label="Close details" style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.13)', color: '#fff', fontSize: 19, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 12 }}>
            {context.map(item => <span key={item} style={{ fontSize: 9, padding: '4px 7px', borderRadius: 20, background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.16)' }}>{item}</span>)}
          </div>
        </div>

        <div style={{ padding: 20 }}>
          {config.periodTabs?.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${config.periodTabs.length}, minmax(0, 1fr))`, gap: 5, padding: 4, marginBottom: 16, background: '#f1f5f9', borderRadius: 11 }}>
              {config.periodTabs.map(tab => (
                <button key={tab.key} onClick={tab.onClick} style={{ border: tab.active ? '1px solid #dbe4ee' : '1px solid transparent', borderRadius: 8, padding: '8px 9px', background: tab.active ? '#fff' : 'transparent', color: tab.active ? config.accent : '#64748b', boxShadow: tab.active ? '0 1px 3px rgba(15,23,42,0.08)' : 'none', fontSize: 10, fontWeight: 900, cursor: 'pointer' }}>
                  {tab.label}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase' }}>{config.valueLabel || 'Current result'}</div>
              <div style={{ fontSize: 29, fontWeight: 950, color: '#0f172a', marginTop: 3 }}>{config.value}</div>
            </div>
            <span style={{ color: config.statusColor || '#475569', background: `${config.statusColor || '#475569'}12`, borderRadius: 20, padding: '5px 9px', fontSize: 10, fontWeight: 900 }}>{config.status}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 16 }}>
            {config.metrics.map(metric => (
              <div key={metric.label} style={{ border: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: 11, padding: '10px 11px' }}>
                <div style={{ fontSize: 8, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800, letterSpacing: 0.4 }}>{metric.label}</div>
                <div style={{ fontSize: 14, color: metric.color || '#0f172a', fontWeight: 900, marginTop: 4 }}>{metric.value}</div>
                {metric.note && <div style={{ fontSize: 9, color: '#64748b', marginTop: 3 }}>{metric.note}</div>}
              </div>
            ))}
          </div>

          {config.notice && <div style={{ marginTop: 14, padding: '10px 11px', borderRadius: 10, background: config.notice.tone === 'warning' ? '#fffbeb' : '#f1f5f9', color: config.notice.tone === 'warning' ? '#92400e' : '#475569', fontSize: 10, lineHeight: 1.45 }}>{config.notice.text}</div>}

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: '#334155', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{config.listTitle}</div>
            {config.rows.length === 0 ? (
              <div style={{ padding: '18px 12px', border: '1px dashed #cbd5e1', borderRadius: 11, textAlign: 'center', color: '#64748b', fontSize: 11 }}>No recorded data for this selection.</div>
            ) : config.rows.map((row, index) => (
              <div key={`${row.label}-${index}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 2px', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: `${config.accent}16`, color: config.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, flexShrink: 0 }}>{index + 1}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 850, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</div>
                  <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>{row.meta}</div>
                </div>
                <div style={{ fontSize: 12, color: row.color || config.accent, fontWeight: 900, textAlign: 'right', flexShrink: 0 }}>{row.value}</div>
              </div>
            ))}
          </div>

          <button onClick={onOpenFull} style={{ width: '100%', border: 'none', borderRadius: 11, background: config.accent, color: '#fff', padding: '11px 14px', marginTop: 18, fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>Open full details with these filters →</button>
        </div>
      </aside>
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
              <button key={item.id} onClick={() => item.action_path && onOpen(item)}
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

function RepPerformanceScorecard({ rows, loading, month, year, week, onOpenPerson }) {
  const [showAll, setShowAll] = useState(false);
  const statusStyle = {
    green: { label: 'On track', color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
    amber: { label: 'Needs attention', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
    red: { label: 'Immediate follow-up', color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
    unassigned: { label: 'Not measurable', color: '#64748b', bg: '#f8fafc', border: '#cbd5e1' },
  };
  const visible = showAll ? rows : rows.slice(0, 10);
  const metric = (label, value, color) => (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1, minWidth: 62 }}>
      <span style={{ fontSize: 8, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 900, color: color || '#334155' }}>{value}</span>
    </span>
  );

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', marginBottom: 20, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'linear-gradient(135deg,#f8fafc 0%,#f5f3ff 100%)', borderBottom: '1px solid #e2e8f0' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#111827' }}>Rep Performance Scorecard</div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{MONTH_NAMES[month]} {year} · business, recovery and execution · regional and doctor sales scored separately</div>
        </div>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {['green', 'amber', 'red', 'unassigned'].map(level => {
            const style = statusStyle[level];
            const count = rows.filter(row => row.status === level).length;
            return <span key={level} style={{ fontSize: 8, fontWeight: 900, color: style.color, background: style.bg, border: `1px solid ${style.border}`, borderRadius: 20, padding: '3px 7px' }}>{count} {style.label}</span>;
          })}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>Calculating performance…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 26, textAlign: 'center', color: '#64748b', fontSize: 12 }}>No team members are available for this selection.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 1050, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Rank', 'Person', 'Score', 'Business Achievement', 'Investment Recovery', 'Execution', 'Why it needs attention'].map(label => (
                  <th key={label} style={{ padding: '9px 11px', textAlign: 'left', fontSize: 8, letterSpacing: 0.45, textTransform: 'uppercase', color: '#64748b', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => {
                const style = statusStyle[row.status] || statusStyle.amber;
                return (
                  <tr key={row.user_id} onClick={() => row.doctor_count > 0 && onOpenPerson(row)}
                    style={{ borderBottom: '1px solid #f1f5f9', cursor: row.doctor_count > 0 ? 'pointer' : 'default' }}>
                    <td style={{ padding: '11px', color: '#94a3b8', fontSize: 11, fontWeight: 800 }}>{index + 1}</td>
                    <td style={{ padding: '11px', minWidth: 170 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={row.name} color={style.color} size={30} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 900, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</div>
                          <div style={{ fontSize: 8, color: '#94a3b8', marginTop: 2 }}>{row.display_role} · {row.doctor_count} doctors{row.has_reportees ? ' · manager' : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '11px', minWidth: 115 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 39, height: 39, borderRadius: '50%', background: style.bg, border: `3px solid ${style.border}`, color: style.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900 }}>{row.score ?? '—'}</span>
                        <span style={{ fontSize: 8, fontWeight: 900, color: style.color, maxWidth: 55 }}>{style.label}</span>
                      </div>
                    </td>
                    <td style={{ padding: '11px', minWidth: 230 }}>
                      <div style={{ display: 'flex', gap: 15 }}>
                        {metric('Doctor sales', row.doctor_sales_pct == null ? 'N/A' : `${row.doctor_sales_pct}%`, '#047857')}
                        {metric('Regional sales', row.regional_sales_pct == null ? 'N/A' : `${row.regional_sales_pct}%`, '#2563eb')}
                      </div>
                      <div style={{ fontSize: 8, color: '#94a3b8', marginTop: 5 }}>
                        {fmtInr(row.doctor_sales)} doctor · {fmtInr(row.regional_sales)} regional
                      </div>
                    </td>
                    <td style={{ padding: '11px', minWidth: 155 }}>
                      <div style={{ fontSize: 11, fontWeight: 900, color: row.recovery_expected > 0 && row.recovery_pct < 80 ? '#c2410c' : '#047857' }}>{row.recovery_expected > 0 ? `${row.recovery_pct}%` : 'No commitments'}</div>
                      <div style={{ fontSize: 8, color: '#94a3b8', marginTop: 4 }}>{row.recovery_expected > 0 ? `${fmtInr(row.recovery_sales)} of ${fmtInr(row.recovery_expected)}` : 'No recovery due'}</div>
                      {(row.recovery_at_risk > 0 || row.recovery_breached > 0) && <div style={{ fontSize: 8, color: row.recovery_breached > 0 ? '#b91c1c' : '#b45309', fontWeight: 800, marginTop: 3 }}>{row.recovery_breached} breached · {row.recovery_at_risk} at risk</div>}
                    </td>
                    <td style={{ padding: '11px', minWidth: 250 }}>
                      <div style={{ display: 'flex', gap: 13 }}>
                        {metric('Visits · 30d', row.visit_coverage_pct == null ? 'N/A' : `${row.visit_coverage_pct}%`, row.visit_coverage_pct == null ? '#64748b' : row.visit_coverage_pct >= 60 ? '#047857' : '#b45309')}
                        {metric(`Week ${week?.week || ''}`, row.weekly_score == null ? 'N/A' : `${row.weekly_score}%`, row.weekly_score == null ? '#64748b' : row.weekly_score >= 80 ? '#047857' : '#b45309')}
                        {metric(`Tasks · ${MONTH_NAMES[month]}`, row.task_score == null ? 'N/A' : `${row.task_score}%`, row.task_score == null ? '#64748b' : row.overdue_tasks > 0 ? '#b91c1c' : '#7c3aed')}
                      </div>
                    </td>
                    <td style={{ padding: '11px', minWidth: 210 }}>
                      {row.reasons.length > 0 ? (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {row.reasons.slice(0, 3).map(reason => <span key={reason} style={{ fontSize: 8, color: style.color, background: style.bg, border: `1px solid ${style.border}`, borderRadius: 10, padding: '2px 6px' }}>{reason}</span>)}
                          {row.reasons.length > 3 && <span style={{ fontSize: 8, color: '#64748b' }}>+{row.reasons.length - 3}</span>}
                        </div>
                      ) : <span style={{ fontSize: 9, color: '#047857', fontWeight: 800 }}>No immediate concerns</span>}
                      {row.doctor_count > 0 && <div style={{ fontSize: 8, color: '#94a3b8', marginTop: 5 }}>Click to open doctors ›</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && rows.length > 10 && (
        <button onClick={() => setShowAll(value => !value)} style={{ width: '100%', padding: 8, border: 'none', borderTop: '1px solid #f1f5f9', background: '#fff', color: '#4b5563', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>
          {showAll ? 'Show top 10' : `Show ${rows.length - 10} more people`}
        </button>
      )}
    </div>
  );
}

function DoctorPerformanceTab({ doctors, onOpenDoctor }) {
  const [sortMode, setSortMode] = useState('sales');
  const [showAll, setShowAll] = useState(false);
  const modes = [
    { key: 'sales', label: 'Top sales' },
    { key: 'investment', label: 'Highest investment' },
    { key: 'shortfall', label: 'Highest shortfall' },
    { key: 'best_roi', label: 'Best ROI' },
    { key: 'lowest_roi', label: 'Lowest ROI' },
  ];
  const ranked = doctors
    .map(doctor => ({
      ...doctor,
      shortfall: Math.max(0, (Number(doctor.expected_sales) || 0) - (Number(doctor.actual_sales) || 0)),
    }))
    .filter(doctor => {
      if (sortMode === 'sales') return Number(doctor.actual_sales) > 0;
      if (sortMode === 'shortfall') return doctor.shortfall > 0;
      return Number(doctor.total_invested) > 0;
    })
    .sort((a, b) => {
      if (sortMode === 'sales') return Number(b.actual_sales) - Number(a.actual_sales);
      if (sortMode === 'investment') return Number(b.total_invested) - Number(a.total_invested);
      if (sortMode === 'shortfall') return b.shortfall - a.shortfall;
      if (sortMode === 'best_roi') return Number(b.roi_multiple) - Number(a.roi_multiple);
      return Number(a.roi_multiple) - Number(b.roi_multiple);
    });
  const visible = showAll ? ranked : ranked.slice(0, 10);
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', background: 'linear-gradient(135deg,#fff,#fff7ed)' }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: '#111827' }}>Doctor Performance</div>
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Sales, investment, recovery and ROI in one ranked view</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 11 }}>
          {modes.map(mode => (
            <button key={mode.key} onClick={() => { setSortMode(mode.key); setShowAll(false); }} style={{ border: sortMode === mode.key ? '1px solid #c2410c' : '1px solid #e2e8f0', background: sortMode === mode.key ? '#fff7ed' : '#fff', color: sortMode === mode.key ? '#9a3412' : '#64748b', borderRadius: 20, padding: '5px 9px', fontSize: 9, fontWeight: 850, cursor: 'pointer' }}>{mode.label}</button>
          ))}
        </div>
      </div>
      {ranked.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: '#64748b', fontSize: 12 }}>No recorded doctors for this ranking.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8fafc' }}>{['#', 'Doctor', 'Doctor sales', 'Investment', 'Expected return', 'Shortfall', 'ROI'].map(label => <th key={label} style={{ padding: '9px 11px', textAlign: label === 'Doctor' || label === '#' ? 'left' : 'right', fontSize: 8, color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>{label}</th>)}</tr></thead>
            <tbody>
              {visible.map((doctor, index) => (
                <tr key={doctor.doctor_id} onClick={() => onOpenDoctor(doctor)} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
                  <td style={{ padding: 11, color: '#94a3b8', fontSize: 10, fontWeight: 800 }}>{index + 1}</td>
                  <td style={{ padding: 11 }}>
                    <div style={{ fontSize: 11, fontWeight: 900, color: '#111827' }}>{doctor.doctor_name}</div>
                    <div style={{ fontSize: 8, color: '#94a3b8', marginTop: 2 }}>{doctor.city || 'City not set'} · {doctor.manager_name || 'Owner not set'}</div>
                  </td>
                  <td style={{ padding: 11, textAlign: 'right', fontSize: 11, fontWeight: 900, color: '#047857' }}>{fmtInr(doctor.actual_sales)}</td>
                  <td style={{ padding: 11, textAlign: 'right', fontSize: 11, fontWeight: 800, color: '#c2410c' }}>{fmtInr(doctor.total_invested)}</td>
                  <td style={{ padding: 11, textAlign: 'right', fontSize: 11, color: '#475569' }}>{fmtInr(doctor.expected_sales)}</td>
                  <td style={{ padding: 11, textAlign: 'right', fontSize: 11, fontWeight: 900, color: doctor.shortfall > 0 ? '#b91c1c' : '#047857' }}>{fmtInr(doctor.shortfall)}</td>
                  <td style={{ padding: 11, textAlign: 'right' }}><Pill label={fmtROIValue(doctor.actual_sales, doctor.total_invested, doctor.roi_multiple)} bg={GRADE_BG[doctor.roi_grade]} color={GRADE_COLOR[doctor.roi_grade]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ranked.length > 10 && <button onClick={() => setShowAll(value => !value)} style={{ width: '100%', border: 'none', borderTop: '1px solid #f1f5f9', background: '#fff', padding: 9, color: '#475569', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>{showAll ? 'Show top 10' : `Show ${ranked.length - 10} more doctors`}</button>}
    </div>
  );
}

function ProductPerformanceTab({ products, selectedProduct, doctors, loading, onSelectProduct, onBack }) {
  const [showAll, setShowAll] = useState(false);
  const ranked = products.filter(product => Number(product.total_sales) > 0);
  const visible = showAll ? ranked : ranked.slice(0, 10);
  const rows = selectedProduct ? doctors : visible;
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', background: 'linear-gradient(135deg,#fff,#faf5ff)', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: '#4c1d95' }}>{selectedProduct ? selectedProduct.product_name : 'Product Performance'}</div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{selectedProduct ? 'Doctors contributing to this product' : 'Only products with recorded sales are ranked'}</div>
        </div>
        {selectedProduct && <button onClick={onBack} style={{ border: '1px solid #e9d5ff', background: '#faf5ff', color: '#7c3aed', borderRadius: 20, padding: '5px 9px', fontSize: 9, fontWeight: 850, cursor: 'pointer' }}>← All products</button>}
      </div>
      {loading ? (
        <div style={{ padding: 28, textAlign: 'center', color: '#64748b', fontSize: 12 }}>Loading product details…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: '#64748b', fontSize: 12 }}>No recorded sales for this selection.</div>
      ) : (
        <div style={{ padding: '5px 16px 10px' }}>
          {rows.map((row, index) => {
            const value = selectedProduct ? row.total_value : row.total_sales;
            const quantity = selectedProduct ? row.total_qty : row.total_qty;
            const maxValue = Number(selectedProduct ? rows[0]?.total_value : ranked[0]?.total_sales) || 1;
            return (
              <button key={selectedProduct ? row.doctor_id : row.product_id} onClick={() => !selectedProduct && onSelectProduct(row)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 2px', border: 'none', borderBottom: '1px solid #f1f5f9', background: '#fff', textAlign: 'left', cursor: selectedProduct ? 'default' : 'pointer' }}>
                <span style={{ width: 23, height: 23, borderRadius: '50%', background: '#f3e8ff', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900 }}>{index + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 850, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedProduct ? row.doctor_name : row.product_name}</span>
                  <span style={{ display: 'block', height: 4, borderRadius: 3, background: '#f3e8ff', marginTop: 5, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${Math.min(100, (Number(value) / maxValue) * 100)}%`, background: '#8b5cf6' }} /></span>
                </span>
                <span style={{ textAlign: 'right', flexShrink: 0 }}><strong style={{ display: 'block', fontSize: 12, color: '#7c3aed' }}>{fmtInr(value)}</strong><span style={{ fontSize: 9, color: '#94a3b8' }}>Qty {quantity}</span></span>
                {!selectedProduct && <span style={{ color: '#a78bfa' }}>›</span>}
              </button>
            );
          })}
        </div>
      )}
      {!selectedProduct && ranked.length > 10 && <button onClick={() => setShowAll(value => !value)} style={{ width: '100%', border: 'none', borderTop: '1px solid #f1f5f9', background: '#fff', padding: 9, color: '#7c3aed', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>{showAll ? 'Show top 10' : `Show ${ranked.length - 10} more products`}</button>}
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

function Doctor360View({ doctor, repUser, year, month, viewer }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    setError('');
    roiAPI.doctorFull(doctor.doctor_id || doctor.id, year, month, viewer.id)
      .then(r => setData(r.data))
      .catch(err => setError(err.response?.data?.detail || 'Unable to load Doctor 360 details.'));
  }, [doctor, year, month, viewer.id]);

  if (error) return <div style={{ padding: 32, textAlign: 'center', color: '#dc2626' }}>{error}</div>;
  if (!data) return <div style={{ padding: 60, textAlign: 'center', color: '#aaa' }}>Loading...</div>;

  const trendMax = Math.max(...(data.monthly_trend || []).map(t => t.sales), 1);
  const caColor = data.ca_status === 'green' ? '#3D8C40' : data.ca_status === 'yellow' ? '#D97706' : '#DC2626';
  const investmentCategories = Object.entries(data.investment_by_category || {})
    .filter(([, categoryData]) => Number(categoryData?.total) > 0)
    .sort((a, b) => Number(b[1].total) - Number(a[1].total));
  const fmtDate = value => {
    if (!value) return 'Never';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const alertStyle = {
    critical: { color: '#b91c1c', bg: '#fef2f2', border: '#fecaca', icon: '!' },
    warning: { color: '#b45309', bg: '#fffbeb', border: '#fde68a', icon: '⚠' },
    info: { color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', icon: 'i' },
  };
  const activityStyle = {
    visit: { icon: '⌖', color: '#047857', bg: '#ecfdf5' },
    task: { icon: '✓', color: '#7c3aed', bg: '#f5f3ff' },
    investment: { icon: '₹', color: '#c2410c', bg: '#fff7ed' },
    sale: { icon: '▦', color: '#2563eb', bg: '#eff6ff' },
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '16px 20px',
        background: 'linear-gradient(135deg,#f8fafc,#ecfdf5)', borderRadius: 12, marginBottom: 20, border: '1px solid #bbf7d0', flexWrap: 'wrap' }}>
        <Avatar name={doctor.doctor_name || doctor.name || '?'} color="#3D8C40" size={48} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 1.2, textTransform: 'uppercase', color: '#047857', marginBottom: 3 }}>Doctor 360</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{doctor.doctor_name || doctor.name}</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            {doctor.specialty}{doctor.hospital ? ` · ${doctor.hospital}` : ''}
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
            {doctor.city}{data.territory ? ` · ${data.territory} Territory` : ''}{doctor.client_code ? ` · ${doctor.client_code}` : ''}
          </div>
        </div>
        {(data.owner || repUser) && (
          <div style={{ textAlign: 'right', fontSize: 12 }}>
            <div style={{ color: '#94a3b8' }}>Assigned owner</div>
            <div style={{ fontWeight: 800 }}>{data.owner?.name || repUser?.name}</div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{data.owner?.display_role || repUser?.custom_role_name || repUser?.role}</div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Invested', val: fmtInr(data.total_invested) },
          { label: `Sales · ${MONTH_NAMES[month]}`, val: fmtInr(data.actual_sales), color: '#3D8C40' },
          { label: 'ROI Multiple', val: fmtROIValue(data.actual_sales, data.total_invested, data.roi_multiple) },
          { label: 'Achievement', val: `${data.ca_percent}%`, color: caColor },
          { label: 'Last Visit', val: fmtDate(data.summary?.last_visit), compact: true },
          { label: 'Open Tasks', val: data.summary?.open_tasks || 0, color: data.summary?.overdue_tasks > 0 ? '#b91c1c' : '#7c3aed' },
        ].map((s, i) => (
          <div key={i} style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: s.compact ? 13 : 20, fontWeight: 700, color: s.color || '#111' }}>{s.val}</div>
          </div>
        ))}
      </div>

      {(data.alerts || []).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: '#111827', marginBottom: 9 }}>Manager Alerts</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
            {data.alerts.map((alert, index) => {
              const style = alertStyle[alert.severity] || alertStyle.info;
              return (
                <div key={`${alert.title}-${index}`} style={{ display: 'flex', gap: 9, padding: '10px 11px', borderRadius: 10, background: style.bg, border: `1px solid ${style.border}` }}>
                  <span style={{ width: 24, height: 24, borderRadius: 7, background: '#fff', color: style.color, border: `1px solid ${style.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, flexShrink: 0 }}>{style.icon}</span>
                  <span>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 900, color: style.color }}>{alert.title}</span>
                    <span style={{ display: 'block', fontSize: 9, color: '#64748b', marginTop: 2 }}>{alert.detail}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.recovery?.commitments?.length > 0 && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, marginBottom: 11, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#9a3412' }}>Six-month Investment Recovery</div>
              <div style={{ fontSize: 10, color: '#c2410c', marginTop: 2 }}>{data.recovery.commitments.length} commitment{data.recovery.commitments.length === 1 ? '' : 's'} · {data.recovery.at_risk} at risk · {data.recovery.breached} breached</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: data.recovery.achievement_pct >= 100 ? '#047857' : '#c2410c' }}>{data.recovery.achievement_pct}%</div>
              <div style={{ fontSize: 9, color: '#9a3412' }}>{fmtInr(data.recovery.sales_captured)} of {fmtInr(data.recovery.expected_sales)}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
            {data.recovery.commitments.slice(0, 6).map(item => {
              const critical = item.status === 'Breached';
              const warning = item.status === 'At Risk';
              const color = critical ? '#b91c1c' : warning ? '#b45309' : item.status === 'Achieved' ? '#047857' : '#2563eb';
              return (
                <div key={item.investment_id} style={{ background: '#fff', border: '1px solid #fed7aa', borderRadius: 9, padding: '9px 10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#7c2d12' }}>{fmtDate(item.investment_date)}</span>
                    <span style={{ fontSize: 9, fontWeight: 900, color }}>{item.status}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{fmtInr(item.sales_captured)} / {fmtInr(item.expected_sales)} · deadline {fmtDate(item.deadline)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 900 }}>Recent Visits</div>
            <div style={{ fontSize: 10, color: '#64748b' }}>{data.summary?.visit_count || 0} total</div>
          </div>
          {(data.visits || []).length > 0 ? data.visits.slice(0, 5).map(visit => (
            <div key={visit.id} style={{ padding: '8px 0', borderTop: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#047857' }}>{visit.purpose || 'Doctor visit'}</span>
                <span style={{ fontSize: 9, color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDate(visit.visit_time)}</span>
              </div>
              <div style={{ fontSize: 9, color: '#64748b', marginTop: 3 }}>{visit.associate_name}{visit.notes ? ` · ${visit.notes}` : ''}</div>
            </div>
          )) : <div style={{ padding: '20px 0', textAlign: 'center', color: '#b45309', fontSize: 11 }}>No visits recorded</div>}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 900 }}>Tasks</div>
            <div style={{ fontSize: 10, color: data.summary?.overdue_tasks > 0 ? '#b91c1c' : '#64748b' }}>{data.summary?.overdue_tasks || 0} overdue</div>
          </div>
          {(data.tasks || []).length > 0 ? data.tasks.slice(0, 5).map(task => (
            <div key={task.id} style={{ padding: '8px 0', borderTop: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#111827' }}>{task.details}</span>
                <span style={{ fontSize: 9, fontWeight: 900, color: task.status === 'completed' ? '#047857' : task.task_date < new Date().toISOString().slice(0, 10) ? '#b91c1c' : '#7c3aed', whiteSpace: 'nowrap' }}>{task.status}</span>
              </div>
              <div style={{ fontSize: 9, color: '#64748b', marginTop: 3 }}>{task.assigned_to_name} · due {fmtDate(task.task_date)}{task.completion_comments ? ` · ${task.completion_comments}` : ''}</div>
            </div>
          )) : <div style={{ padding: '20px 0', textAlign: 'center', color: '#64748b', fontSize: 11 }}>No tasks assigned</div>}
        </div>
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

      {(data.activity || []).length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 18px', marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 12 }}>Recent Activity Timeline</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 8 }}>
            {data.activity.slice(0, 12).map((event, index) => {
              const style = activityStyle[event.type] || activityStyle.task;
              return (
                <div key={`${event.type}-${event.date}-${index}`} style={{ display: 'flex', gap: 9, padding: '9px 10px', border: '1px solid #f1f5f9', borderRadius: 10, minWidth: 0 }}>
                  <span style={{ width: 27, height: 27, borderRadius: 8, background: style.bg, color: style.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, flexShrink: 0 }}>{style.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 900, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.title}</span>
                      {event.amount != null && <span style={{ fontSize: 10, fontWeight: 900, color: style.color, whiteSpace: 'nowrap' }}>{fmtInr(event.amount)}</span>}
                    </span>
                    <span style={{ display: 'block', fontSize: 9, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.detail}</span>
                    <span style={{ display: 'block', fontSize: 8, color: '#94a3b8', marginTop: 3 }}>{fmtDate(event.date)}{event.person ? ` · ${event.person}` : ''} · {event.status}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
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
  const [previousTargetAchievement, setPreviousTargetAchievement] = useState(null);
  const [targetLoading, setTargetLoading] = useState(false);
  const [commitmentData, setCommitmentData] = useState(null);
  const [actionCentreData, setActionCentreData] = useState(null);
  const [actionCentreLoading, setActionCentreLoading] = useState(false);
  const [territoryPerformance, setTerritoryPerformance] = useState(null);
  const [territoryPerformanceLoading, setTerritoryPerformanceLoading] = useState(false);
  const [repScorecard, setRepScorecard] = useState(null);
  const [repScorecardLoading, setRepScorecardLoading] = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [dashboardScope, setDashboardScope] = useState('overall');

  const [selRegion,     setSelRegion]     = useState(null);
  const [selCity,       setSelCity]       = useState(null);
  const [showAllCities, setShowAllCities] = useState(false);

  const [showSalesPanel,    setShowSalesPanel]    = useState(false);
  const [showInvestPanel,   setShowInvestPanel]   = useState(false);
  const [showROIPanel,      setShowROIPanel]      = useState(false);
  const [drilldownType,     setDrilldownType]     = useState(null);
  const [actionDetailItem,  setActionDetailItem]  = useState(null);
  const [doctorSalesWindow, setDoctorSalesWindow] = useState('selected');
  const [performanceTab,    setPerformanceTab]    = useState('territories');
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
        ...(selRegion ? { state_code: selRegion } : {}),
        ...(selCity ? { city: selCity } : {}),
      },
    }).then(response => { if (!cancelled) setTopProducts(response.data || []); })
      .catch(() => { if (!cancelled) setTopProducts([]); });
    return () => { cancelled = true; };
  }, [me?.id, year, month, startDate, endDate, effectiveScope, selRegion, selCity]);

  useEffect(() => {
    if (!me?.id) return;
    let cancelled = false;
    setTargetLoading(true);
    const filters = {
      ...(selRegion ? { state_code: selRegion } : {}),
      ...(selCity ? { city: selCity } : {}),
    };
    const prior = previousMonth(year, month);
    Promise.all([
      targetsAPI.dashboard(me.id, year, month, effectiveScope, filters),
      targetsAPI.dashboard(me.id, prior.year, prior.month, effectiveScope, filters),
    ]).then(([currentResponse, previousResponse]) => {
      if (!cancelled) {
        setTargetAchievement(currentResponse.data || null);
        setPreviousTargetAchievement(previousResponse.data || null);
      }
    }).catch(() => {
      if (!cancelled) {
        setTargetAchievement(null);
        setPreviousTargetAchievement(null);
      }
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
    setRepScorecardLoading(true);
    dashboardAPI.repScorecard(me.id, year, month, effectiveScope, {
      as_of: endDate,
      ...(selRegion ? { state_code: selRegion } : {}),
      ...(selCity ? { city: selCity } : {}),
    }).then(response => {
      if (!cancelled) setRepScorecard(response.data || null);
    }).catch(() => {
      if (!cancelled) setRepScorecard(null);
    }).finally(() => {
      if (!cancelled) setRepScorecardLoading(false);
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

  const filteredRegionalSalesRows = useMemo(() => regionalSalesRows
    .filter(row => scopeUserIds.has(Number(row.associate_id)))
    .filter(row => !selRegion || toStateName(row.state_code) === selRegion)
    .filter(row => !selCity || normCity(row.city) === selCity),
  [regionalSalesRows, scopeUserIds, selRegion, selCity]);
  const totalRegionalSales = useMemo(() => filteredRegionalSalesRows
    .reduce((sum, row) => sum + (Number(row.value) || 0), 0),
  [filteredRegionalSalesRows]);

  const clientStats = useMemo(() => {
    const prescribed = displayDoctors.filter(doctor => Number(doctor.actual_sales) > 0).length;
    return {
      prescribed,
      not_prescribed: Math.max(0, displayDoctors.length - prescribed),
    };
  }, [displayDoctors]);

  const filteredRecoveryRows = useMemo(() => (commitmentData?.doctor_summary || [])
      .filter(row => scopeUserIds.has(Number(row.manager_id)))
      .filter(row => !selRegion || toStateName(row.state_code) === selRegion)
      .filter(row => !selCity || normCity(row.city) === selCity),
  [commitmentData, scopeUserIds, selRegion, selCity]);

  const investmentRecovery = useMemo(() => {
    const rows = filteredRecoveryRows;
    const expected = rows.reduce((sum, row) => sum + (Number(row.expected_sales) || 0), 0);
    const sales = rows.reduce((sum, row) => sum + (Number(row.sales_captured) || 0), 0);
    const invested = rows.reduce((sum, row) => sum + (Number(row.total_invested) || 0), 0);
    const atRiskCount = rows.filter(row => ['At Risk', 'Breached'].includes(row.worst_status)).length;
    const breached = rows.filter(row => row.worst_status === 'Breached').length;
    return {
      doctors: rows.length,
      invested,
      expected,
      sales,
      shortfall: Math.max(0, expected - sales),
      atRisk: atRiskCount,
      breached,
      achievementPct: expected > 0 ? Math.round((sales / expected) * 1000) / 10 : 0,
    };
  }, [filteredRecoveryRows]);

  const repScorecardRows = useMemo(
    () => Array.isArray(repScorecard?.rows) ? repScorecard.rows : [],
    [repScorecard]
  );

  const executionSummary = useMemo(() => {
    const totals = repScorecardRows.reduce((result, row) => ({
      doctors: result.doctors + (Number(row.doctor_count) || 0),
      visited: result.visited + (Number(row.visited_30d) || 0),
      tasks: result.tasks + (Number(row.task_total) || 0),
      completed: result.completed + (Number(row.task_completed) || 0),
      overdue: result.overdue + (Number(row.overdue_tasks) || 0),
      weeklyExpected: result.weeklyExpected + (Number(row.weekly_expected) || 0),
      weeklySubmitted: result.weeklySubmitted + (Number(row.weekly_submitted) || 0),
      pdfMatched: result.pdfMatched + (Number(row.weekly_pdf_matched) || 0),
    }), { doctors: 0, visited: 0, tasks: 0, completed: 0, overdue: 0, weeklyExpected: 0, weeklySubmitted: 0, pdfMatched: 0 });
    return {
      ...totals,
      visitPct: totals.doctors > 0 ? Math.round((totals.visited / totals.doctors) * 1000) / 10 : null,
      taskPct: totals.tasks > 0 ? Math.round((totals.completed / totals.tasks) * 1000) / 10 : null,
      weeklyPct: totals.weeklyExpected > 0 ? Math.round((totals.weeklySubmitted / totals.weeklyExpected) * 1000) / 10 : null,
    };
  }, [repScorecardRows]);

  const actionItems = useMemo(() => {
    const items = [...(actionCentreData?.items || [])];
    const doctorTarget = targetAchievement?.doctor_sales;
    const regionalTarget = targetAchievement?.regional_sales;
    if (doctorTarget?.has_target && doctorTarget.status === 'Below pace') {
      const doctorsBehindTarget = [...displayDoctors]
        .sort((a, b) => Number(b.actual_sales || 0) - Number(a.actual_sales || 0))
        .slice(0, 50)
        .map(doctor => ({
          label: doctor.doctor_name,
          meta: `${doctor.city || 'City not set'} · ${doctor.manager_name || 'Owner not set'}`,
          value: fmtInr(doctor.actual_sales),
        }));
      items.push({
        id: 'doctor-target-below-pace', type: 'doctor_target', severity: 'warning',
        title: 'Doctor sales target is below pace',
        detail: `${doctorTarget.achievement_pct}% achieved · ${fmtInr(doctorTarget.remaining_value)} remaining`,
        count: doctorsBehindTarget.length, names: [], rows: doctorsBehindTarget, action_path: '/investment-roi',
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
      const breachedDoctors = filteredRecoveryRows
        .filter(row => row.worst_status === 'Breached')
        .sort((a, b) => Number(b.shortfall || 0) - Number(a.shortfall || 0))
        .map(row => ({
          label: row.doctor_name,
          meta: `${row.city || 'City not set'} · ${row.manager_name || 'Owner not set'} · recovered ${fmtInr(row.sales_captured)}`,
          value: `${fmtInr(row.shortfall)} gap`,
          color: '#b91c1c',
        }));
      items.push({
        id: 'investment-recovery-breached', type: 'investment', severity: 'critical',
        title: `${investmentRecovery.breached} investment recover${investmentRecovery.breached === 1 ? 'y has' : 'ies have'} breached deadline`,
        detail: `Six-month recovery · ${fmtInr(investmentRecovery.shortfall)} total shortfall`,
        count: investmentRecovery.breached, names: breachedDoctors.slice(0, 4).map(row => row.label), rows: breachedDoctors, action_path: '/investment-roi',
      });
    } else if (investmentRecovery.atRisk > 0) {
      const atRiskDoctors = filteredRecoveryRows
        .filter(row => ['At Risk', 'Breached'].includes(row.worst_status))
        .sort((a, b) => Number(b.shortfall || 0) - Number(a.shortfall || 0))
        .map(row => ({
          label: row.doctor_name,
          meta: `${row.city || 'City not set'} · ${row.manager_name || 'Owner not set'} · ${row.worst_status}`,
          value: `${fmtInr(row.shortfall)} gap`,
          color: '#b45309',
        }));
      items.push({
        id: 'investment-recovery-risk', type: 'investment', severity: 'warning',
        title: `${investmentRecovery.atRisk} investment recover${investmentRecovery.atRisk === 1 ? 'y is' : 'ies are'} at risk`,
        detail: `Six-month recovery · ${fmtInr(investmentRecovery.shortfall)} total shortfall`,
        count: investmentRecovery.atRisk, names: atRiskDoctors.slice(0, 4).map(row => row.label), rows: atRiskDoctors, action_path: '/investment-roi',
      });
    }
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return items.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || (Number(b.count) || 0) - (Number(a.count) || 0));
  }, [actionCentreData, targetAchievement, investmentRecovery, filteredRecoveryRows, displayDoctors, me?.role, month, year]);

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
    const top5Doctors   = [...displayDoctors]
      .filter(doctor => Number(doctor.actual_sales) > 0)
      .sort((a, b) => Number(b.actual_sales) - Number(a.actual_sales))
      .slice(0, 5);
    const atRisk = displayDoctors
      .map(doctor => ({
        ...doctor,
        recovery_shortfall: Math.max(0, (Number(doctor.expected_sales) || 0) - (Number(doctor.actual_sales) || 0)),
      }))
      .filter(doctor => doctor.recovery_shortfall > 0 && (doctor.is_at_risk || doctor.ca_percent < 60))
      .sort((a, b) => b.recovery_shortfall - a.recovery_shortfall || a.ca_percent - b.ca_percent)
      .slice(0, 10);
    const repMap = {};
    displayDoctors.forEach(d => {
      if (!d.manager_id) return;
      if (!repMap[d.manager_id]) repMap[d.manager_id] = { manager_id: d.manager_id, name: d.manager_name || '—', sales: 0, count: 0 };
      repMap[d.manager_id].sales += d.actual_sales || 0;
      repMap[d.manager_id].count += 1;
    });
    const top5Reps = Object.values(repMap).filter(rep => rep.sales > 0).sort((a, b) => b.sales - a.sales).slice(0, 5);
    return { totalSales, totalInvested, overallROI, top5Doctors, top5Reps, atRisk };
  }, [displayDoctors]);

  const teamListUsers = scopeUsers.filter(u => Number(u.id) !== Number(me?.id) && u.role !== 'admin');
  const totalTeams = teamListUsers.length;
  const totalDocs  = displayDoctors.length;
  const selectedPeriodLabel = `${fmtPeriodDate(startDate)} – ${fmtPeriodDate(endDate)}`;
  const sixMonthStart = new Date(year, month - 6, 1);
  const sixMonthStartYear = sixMonthStart.getFullYear();
  const sixMonthStartMonth = sixMonthStart.getMonth() + 1;
  const sixMonthPeriodLabel = sixMonthStartYear === year
    ? `${MONTH_NAMES[sixMonthStartMonth]}–${MONTH_NAMES[month]} ${year}`
    : `${MONTH_NAMES[sixMonthStartMonth]} ${sixMonthStartYear}–${MONTH_NAMES[month]} ${year}`;
  const rollingDoctorSales = useMemo(() => {
    const selectedIndex = (year * 12) + (month - 1);
    return displayDoctors.map(doctor => {
      const rollingSales = (doctor.sales_months || []).reduce((sum, row) => {
        const rowIndex = (Number(row.year) * 12) + (Number(row.month) - 1);
        return rowIndex >= selectedIndex - 5 && rowIndex <= selectedIndex
          ? sum + (Number(row.amount) || 0)
          : sum;
      }, 0);
      return { ...doctor, actual_sales: rollingSales, total_sales: rollingSales };
    });
  }, [displayDoctors, year, month]);
  const prior = previousMonth(year, month);
  const priorLabel = `${MONTH_NAMES[prior.month]} ${prior.year}`;
  const regionalTarget = targetAchievement?.regional_sales;
  const doctorTarget = targetAchievement?.doctor_sales;
  const regionalTrend = salesTrend(
    regionalTarget?.actual_value,
    previousTargetAchievement?.regional_sales?.actual_value,
    priorLabel,
  );
  const doctorTrend = salesTrend(
    doctorTarget?.actual_value,
    previousTargetAchievement?.doctor_sales?.actual_value,
    priorLabel,
  );
  const scopeLabel = effectiveScope === 'mine' ? 'My Business' : effectiveScope === 'team' ? 'My Team' : 'Overall';
  const drilldownContext = [scopeLabel, selRegion || 'All regions', selCity || 'All cities'];
  const drilldownConfig = useMemo(() => {
    if (!drilldownType) return null;
    if (drilldownType === 'regional') {
      const rows = [...(territoryPerformance?.rows || [])]
        .filter(row => Number(row.regional_sales) > 0 || Number(row.missing_updates) > 0)
        .sort((a, b) => Number(b.regional_sales) - Number(a.regional_sales))
        .slice(0, 8)
        .map(row => ({
          label: row.territory,
          meta: `${toStateName(row.state_code)} · ${row.missing_updates || 0} updates pending`,
          value: fmtInr(row.regional_sales),
        }));
      return {
        title: 'Regional Sales', icon: '▦', accent: '#2a78d6',
        period: `${MONTH_NAMES[month]} ${year} · cumulative weekly submissions`,
        value: fmtInr(totalRegionalSales),
        status: regionalTarget?.has_target ? regionalTarget.status : 'Target not set',
        statusColor: regionalTarget?.has_target && Number(regionalTarget.achievement_pct) >= 80 ? '#047857' : '#b45309',
        metrics: [
          { label: 'Monthly target', value: regionalTarget?.has_target ? fmtInr(regionalTarget.target_value) : 'Not set' },
          { label: 'Achievement', value: regionalTarget?.has_target ? `${regionalTarget.achievement_pct}%` : 'N/A' },
          { label: 'Updates received', value: `${executionSummary.weeklySubmitted}/${executionSummary.weeklyExpected || 0}` },
          { label: 'PDFs validated', value: `${executionSummary.pdfMatched}/${executionSummary.weeklyExpected || 0}` },
        ],
        notice: { tone: executionSummary.weeklyExpected > executionSummary.weeklySubmitted ? 'warning' : 'neutral', text: executionSummary.weeklyExpected > 0 ? `${executionSummary.weeklyExpected - executionSummary.weeklySubmitted} territory update(s) are still missing for the selected week.` : 'No weekly regional submission is required for this selection.' },
        listTitle: 'Territory breakdown', rows,
      };
    }
    if (drilldownType === 'doctor') {
      const showingSixMonths = doctorSalesWindow === 'six_month';
      const doctorRows = showingSixMonths ? rollingDoctorSales : displayDoctors;
      const doctorsWithSales = doctorRows.filter(doctor => Number(doctor.actual_sales) > 0);
      const doctorSalesTotal = doctorsWithSales.reduce((sum, doctor) => sum + Number(doctor.actual_sales || 0), 0);
      const rows = [...doctorsWithSales]
        .filter(doctor => Number(doctor.actual_sales) > 0)
        .sort((a, b) => Number(b.actual_sales) - Number(a.actual_sales))
        .slice(0, 8)
        .map(doctor => ({ label: doctor.doctor_name, meta: `${doctor.city || 'City not set'} · ${doctor.manager_name || 'Owner not set'}`, value: fmtInr(doctor.actual_sales) }));
      return {
        title: 'Doctor Sales', icon: '◆', accent: '#3D8C40',
        period: showingSixMonths ? `Rolling six-month returns · ${sixMonthPeriodLabel}` : `Selected dashboard period · ${selectedPeriodLabel}`,
        valueLabel: showingSixMonths ? 'Six-month doctor sales' : 'Selected-period doctor sales',
        value: fmtInr(doctorSalesTotal),
        status: showingSixMonths ? 'ROI returns window' : (doctorTarget?.has_target ? doctorTarget.status : 'Target not set'),
        statusColor: showingSixMonths ? '#2563eb' : (doctorTarget?.has_target && Number(doctorTarget.achievement_pct) >= 80 ? '#047857' : '#b45309'),
        periodTabs: [
          { key: 'selected', label: 'Selected period', active: !showingSixMonths, onClick: () => setDoctorSalesWindow('selected') },
          { key: 'six_month', label: '6-month returns', active: showingSixMonths, onClick: () => setDoctorSalesWindow('six_month') },
        ],
        metrics: showingSixMonths ? [
          { label: 'Returns window', value: sixMonthPeriodLabel },
          { label: 'Doctors with sales', value: `${doctorsWithSales.length}/${totalDocs}` },
          { label: 'Without 6M sales', value: Math.max(0, totalDocs - doctorsWithSales.length), color: totalDocs > doctorsWithSales.length ? '#b45309' : '#047857' },
          { label: 'Top doctor', value: rows[0]?.value || 'No sales' },
        ] : [
          { label: 'Monthly target', value: doctorTarget?.has_target ? fmtInr(doctorTarget.target_value) : 'Not set' },
          { label: 'Achievement', value: doctorTarget?.has_target ? `${doctorTarget.achievement_pct}%` : 'N/A' },
          { label: 'Doctors with sales', value: `${clientStats.prescribed}/${totalDocs}` },
          { label: 'Without sales entry', value: clientStats.not_prescribed, color: clientStats.not_prescribed > 0 ? '#b45309' : '#047857' },
        ],
        notice: showingSixMonths
          ? { tone: 'neutral', text: 'This is the same rolling six-month sales window used by the Investment & ROI Returns Tracker.' }
          : { tone: clientStats.not_prescribed > 0 ? 'warning' : 'neutral', text: clientStats.not_prescribed > 0 ? `${clientStats.not_prescribed} active doctor(s) have no doctor-wise sales entry between ${selectedPeriodLabel}. Switch to 6-month returns to compare with Investment & ROI.` : 'All active doctors in this selection have recorded sales.' },
        listTitle: showingSixMonths ? 'Top doctors · six-month returns' : 'Top doctors · selected period', rows,
      };
    }
    if (drilldownType === 'investment') {
      const rows = [...filteredRecoveryRows]
        .filter(row => Number(row.total_invested) > 0)
        .sort((a, b) => Number(b.shortfall) - Number(a.shortfall) || Number(b.total_invested) - Number(a.total_invested))
        .slice(0, 8)
        .map(row => ({ label: row.doctor_name, meta: `${row.city || 'City not set'} · ${row.worst_status}`, value: `${fmtInr(row.shortfall)} gap`, color: Number(row.shortfall) > 0 ? '#b91c1c' : '#047857' }));
      return {
        title: 'Investment Recovery', icon: '◈', accent: '#D4A017', period: `Six-month commitment tracking · as of ${fmtPeriodDate(endDate)}`,
        value: fmtInr(investmentRecovery.invested),
        status: investmentRecovery.breached > 0 ? `${investmentRecovery.breached} breached` : investmentRecovery.atRisk > 0 ? `${investmentRecovery.atRisk} at risk` : investmentRecovery.doctors > 0 ? 'On track' : 'No commitments',
        statusColor: investmentRecovery.breached > 0 ? '#b91c1c' : investmentRecovery.atRisk > 0 ? '#b45309' : '#047857',
        metrics: [
          { label: 'Expected return', value: fmtInr(investmentRecovery.expected) },
          { label: 'Recovered sales', value: fmtInr(investmentRecovery.sales), color: '#047857' },
          { label: 'Recovery achieved', value: `${investmentRecovery.achievementPct}%` },
          { label: 'Total shortfall', value: fmtInr(investmentRecovery.shortfall), color: investmentRecovery.shortfall > 0 ? '#b91c1c' : '#047857' },
        ],
        notice: { tone: investmentRecovery.shortfall > 0 ? 'warning' : 'neutral', text: investmentRecovery.shortfall > 0 ? 'Doctors below their expected return are ranked by rupee shortfall so the largest commercial risk appears first.' : 'No recovery shortfall is currently recorded.' },
        listTitle: 'Highest rupee shortfalls', rows,
      };
    }
    const rows = [...repScorecardRows]
      .filter(row => row.status !== 'unassigned' || row.reasons?.length)
      .sort((a, b) => Number(b.overdue_tasks) - Number(a.overdue_tasks) || (a.score ?? 101) - (b.score ?? 101))
      .slice(0, 8)
      .map(row => ({ label: row.name, meta: (row.reasons || []).slice(0, 2).join(' · ') || 'No immediate concerns', value: row.score == null ? 'N/A' : `${row.score}/100`, color: row.status === 'red' ? '#b91c1c' : row.status === 'amber' ? '#b45309' : '#047857' }));
    return {
      title: 'Execution', icon: '✓', accent: '#0891B2', period: `Visits: last 30 days · Tasks: ${MONTH_NAMES[month]} ${year}`,
      value: executionSummary.visitPct == null ? 'No visit data' : `${executionSummary.visitPct}% visits`,
      status: executionSummary.overdue > 0 ? `${executionSummary.overdue} overdue` : executionSummary.tasks > 0 ? 'No overdue tasks' : 'No tasks assigned',
      statusColor: executionSummary.overdue > 0 ? '#b91c1c' : executionSummary.tasks > 0 ? '#047857' : '#64748b',
      metrics: [
        { label: 'Doctors visited', value: `${executionSummary.visited}/${executionSummary.doctors}` },
        { label: 'Tasks completed', value: `${executionSummary.completed}/${executionSummary.tasks}` },
        { label: 'Weekly updates', value: `${executionSummary.weeklySubmitted}/${executionSummary.weeklyExpected}` },
        { label: 'PDFs validated', value: `${executionSummary.pdfMatched}/${executionSummary.weeklyExpected}` },
      ],
      notice: { tone: executionSummary.overdue > 0 ? 'warning' : 'neutral', text: executionSummary.overdue > 0 ? `${executionSummary.overdue} assigned task(s) are past their due date.` : 'Execution figures clearly distinguish no assignment from completed activity.' },
      listTitle: 'People needing follow-up', rows,
    };
  }, [drilldownType, territoryPerformance, month, year, totalRegionalSales, regionalTarget, executionSummary, displayDoctors, selectedPeriodLabel, doctorSalesWindow, rollingDoctorSales, sixMonthPeriodLabel, doctorTarget, clientStats, totalDocs, filteredRecoveryRows, endDate, investmentRecovery, repScorecardRows]);

  const openFullDrilldown = () => {
    if (!drilldownType) return;
    const params = new URLSearchParams({
      year: String(year), month: String(month), start_date: startDate, end_date: endDate,
      scope: effectiveScope,
    });
    if (selRegion) params.set('region', selRegion);
    if (selCity) params.set('city', selCity);
    const path = drilldownType === 'regional'
      ? '/regional-sales'
      : drilldownType === 'execution'
        ? (hasReports ? '/weekly-reports' : '/visit-log')
        : '/investment-roi';
    if (drilldownType === 'doctor') params.set('view', 'doctor_sales');
    if (drilldownType === 'doctor') params.set('window', doctorSalesWindow);
    if (drilldownType === 'investment') params.set('view', 'recovery');
    setDrilldownType(null);
    navigate(`${path}?${params.toString()}`);
  };
  const actionDrilldownConfig = useMemo(() => {
    if (!actionDetailItem) return null;
    const severityStyle = {
      critical: { accent: '#b91c1c', status: 'Urgent' },
      warning: { accent: '#b45309', status: 'Needs attention' },
      info: { accent: '#2563eb', status: 'Follow up' },
    };
    const tone = severityStyle[actionDetailItem.severity] || severityStyle.info;
    const rows = (actionDetailItem.rows || []).map(row => ({
      label: row.label || 'Record',
      meta: row.meta || actionDetailItem.detail,
      value: row.value || 'Pending',
      color: row.color || tone.accent,
    }));
    const hiddenCount = Math.max(0, Number(actionDetailItem.count || 0) - rows.length);
    return {
      title: actionDetailItem.title,
      icon: actionDetailItem.type === 'investment' ? '₹' : actionDetailItem.type === 'visit' ? '⌖' : actionDetailItem.type === 'approval' ? '⌁' : actionDetailItem.type === 'weekly_pdf' ? 'PDF' : actionDetailItem.type === 'regional_update' ? '▦' : actionDetailItem.type === 'task' ? '✓' : '!',
      accent: tone.accent,
      period: actionDetailItem.detail,
      valueLabel: 'Affected records',
      value: Number(actionDetailItem.count || rows.length).toLocaleString('en-IN'),
      status: tone.status,
      statusColor: tone.accent,
      metrics: [
        { label: 'Affected', value: Number(actionDetailItem.count || 0).toLocaleString('en-IN') },
        { label: 'Shown here', value: rows.length.toLocaleString('en-IN') },
        { label: 'Scope', value: scopeLabel },
        { label: 'Location', value: selCity || selRegion || 'All' },
      ],
      notice: hiddenCount > 0
        ? { tone: 'neutral', text: `${hiddenCount.toLocaleString('en-IN')} additional record(s) are available on the full working page. The highest-priority 50 are shown here.` }
        : { tone: 'neutral', text: 'Review the affected people or records below, then open the full working page only when you need to take action.' },
      listTitle: actionDetailItem.type === 'investment' ? 'Doctors requiring recovery action' : 'Affected people and records',
      rows,
    };
  }, [actionDetailItem, scopeLabel, selCity, selRegion]);

  const openActionFull = () => {
    if (!actionDetailItem?.action_path) return;
    const params = new URLSearchParams({
      year: String(year), month: String(month), start_date: startDate, end_date: endDate,
      scope: effectiveScope,
    });
    if (selRegion) params.set('region', selRegion);
    if (selCity) params.set('city', selCity);
    if (actionDetailItem.type === 'investment') params.set('view', 'recovery');
    if (actionDetailItem.type === 'doctor_target') params.set('view', 'doctor_sales');
    setActionDetailItem(null);
    navigate(`${actionDetailItem.action_path}?${params.toString()}`);
  };
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

        {/* Scope context — useful counts, without competing with the four decision cards. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 17, position: 'relative', zIndex: 2 }}>
          {hasReports && dashboardScope !== 'mine' && (
            <button onClick={() => { closeAllPanels(); setView('all-teams'); setSelUser(null); }} style={{ border: '1px solid rgba(255,255,255,0.18)', borderRadius: 10, padding: '7px 10px', background: 'rgba(255,255,255,0.08)', color: '#fff', cursor: 'pointer', fontSize: 10 }}>
              <strong>{totalTeams}</strong> team members →
            </button>
          )}
          <button onClick={() => { closeAllPanels(); setView('all-clients'); setClientSearch(''); setClientsVisible(8); }} style={{ border: '1px solid rgba(255,255,255,0.18)', borderRadius: 10, padding: '7px 10px', background: 'rgba(255,255,255,0.08)', color: '#fff', cursor: 'pointer', fontSize: 10 }}>
            <strong>{totalDocs}</strong> active doctors · {clientStats.prescribed} with sales · {clientStats.not_prescribed} without →
          </button>
        </div>

        {/* Four decision cards — value, context, completeness and one clear drill-down. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(225px, 1fr))', gap: 12, marginTop: 12, position: 'relative', zIndex: 2 }}>
          <DecisionMetricCard
            title="Regional Sales"
            period={`${MONTH_NAMES[month]} ${year} · cumulative weekly submissions`}
            icon="▦"
            accent="#2a78d6"
            value={fmtInr(totalRegionalSales)}
            status={regionalTarget?.has_target ? regionalTarget.status : 'Target not set'}
            statusTone={!regionalTarget?.has_target ? 'neutral' : Number(regionalTarget.achievement_pct) >= 100 ? 'positive' : Number(regionalTarget.achievement_pct) >= 80 ? 'warning' : 'negative'}
            targetLabel={regionalTarget?.has_target ? `${MONTH_NAMES[month]} target ${fmtInr(regionalTarget.target_value)}` : `${MONTH_NAMES[month]} target not set`}
            achievementPct={regionalTarget?.has_target ? regionalTarget.achievement_pct : null}
            trend={regionalTrend}
            detail={executionSummary.weeklyExpected > 0 ? `${executionSummary.weeklySubmitted} of ${executionSummary.weeklyExpected} territory updates submitted` : 'No weekly submission requirement for this selection'}
            completeness={executionSummary.weeklyExpected > 0 ? `${executionSummary.pdfMatched} of ${executionSummary.weeklyExpected} PDFs validated` : 'Completeness: not applicable'}
            actionLabel="Open regional sales"
            onOpen={() => setDrilldownType('regional')}
          />
          <DecisionMetricCard
            title="Doctor Sales"
            period={selectedPeriodLabel}
            icon="◆"
            accent="#3D8C40"
            value={fmtInr(totalSales)}
            status={doctorTarget?.has_target ? doctorTarget.status : 'Target not set'}
            statusTone={!doctorTarget?.has_target ? 'neutral' : Number(doctorTarget.achievement_pct) >= 100 ? 'positive' : Number(doctorTarget.achievement_pct) >= 80 ? 'warning' : 'negative'}
            targetLabel={doctorTarget?.has_target ? `${MONTH_NAMES[month]} target ${fmtInr(doctorTarget.target_value)}` : `${MONTH_NAMES[month]} target not set`}
            achievementPct={doctorTarget?.has_target ? doctorTarget.achievement_pct : null}
            trend={doctorTrend}
            detail={`${clientStats.prescribed} of ${totalDocs} active doctors have sales in this period`}
            completeness={`${clientStats.not_prescribed} doctors have no doctor-wise sales entry`}
            actionLabel="Open doctor sales"
            onOpen={() => setDrilldownType('doctor')}
          />
          <DecisionMetricCard
            title="Investment Recovery"
            period={`Six-month commitment tracking · as of ${fmtPeriodDate(endDate)}`}
            icon="◈"
            accent="#D4A017"
            value={fmtInr(investmentRecovery.invested)}
            status={investmentRecovery.doctors === 0 ? 'No commitments' : investmentRecovery.breached > 0 ? `${investmentRecovery.breached} breached` : investmentRecovery.atRisk > 0 ? `${investmentRecovery.atRisk} at risk` : 'On track'}
            statusTone={investmentRecovery.doctors === 0 ? 'neutral' : investmentRecovery.breached > 0 ? 'negative' : investmentRecovery.atRisk > 0 ? 'warning' : 'positive'}
            targetLabel={investmentRecovery.doctors > 0 ? `Recovered ${fmtInr(investmentRecovery.sales)} of ${fmtInr(investmentRecovery.expected)}` : 'No recovery target due'}
            achievementPct={investmentRecovery.doctors > 0 ? investmentRecovery.achievementPct : null}
            detail={investmentRecovery.doctors > 0 ? `${fmtInr(investmentRecovery.shortfall)} recovery shortfall across ${investmentRecovery.doctors} doctors` : 'No active six-month investment commitments in this selection'}
            completeness="Investment and recovery use a rolling six-month window"
            actionLabel="Open investment & ROI"
            onOpen={() => setDrilldownType('investment')}
          />
          <DecisionMetricCard
            title="Execution"
            period={`Visits: last 30 days · Tasks: ${MONTH_NAMES[month]} ${year}`}
            icon="✓"
            accent="#0891B2"
            value={executionSummary.visitPct == null ? 'No visit data' : `${executionSummary.visitPct}% visits`}
            status={executionSummary.overdue > 0 ? `${executionSummary.overdue} overdue` : executionSummary.tasks > 0 ? 'No overdue tasks' : 'No tasks assigned'}
            statusTone={executionSummary.overdue > 0 ? 'negative' : executionSummary.tasks > 0 ? 'positive' : 'neutral'}
            targetLabel={executionSummary.tasks > 0 ? `${executionSummary.completed} of ${executionSummary.tasks} tasks completed` : 'No tasks assigned in this month'}
            achievementPct={executionSummary.taskPct}
            detail={executionSummary.doctors > 0 ? `${executionSummary.visited} of ${executionSummary.doctors} active doctors visited in 30 days` : 'No assigned doctors in this selection'}
            completeness={executionSummary.weeklyExpected > 0 ? `Weekly updates ${executionSummary.weeklySubmitted}/${executionSummary.weeklyExpected} · PDFs validated ${executionSummary.pdfMatched}/${executionSummary.weeklyExpected}` : 'Weekly regional compliance: not applicable'}
            actionLabel="Open execution details"
            onOpen={() => setDrilldownType('execution')}
          />
        </div>

        <div style={{ height: 24 }} />
      </div>

      {/* MAIN BODY */}
      <div style={{ padding: '16px 28px 28px' }}>

        {drilldownType && drilldownConfig && (
          <DrilldownPanel
            type={drilldownType}
            accent={drilldownConfig.accent}
            title={drilldownConfig.title}
            period={drilldownConfig.period}
            value={drilldownConfig.value}
            status={drilldownConfig.status}
            me={me}
            year={year}
            month={month}
            asOf={endDate}
            regionalRows={filteredRegionalSalesRows}
            recoveryRows={filteredRecoveryRows}
            doctorRows={displayDoctors}
            scorecardRows={repScorecardRows}
            toStateName={toStateName}
            onClose={() => setDrilldownType(null)}
            onOpenFull={openFullDrilldown}
            onOpenDoctor={(d) => { setSelDoctor(d); setSelUser(null); setView('client'); setDrilldownType(null); }}
          />
        )}

        {view !== 'overview' && <Breadcrumb crumbs={crumbs} onGo={handleBreadcrumb} />}

        {/* OVERVIEW */}
        {view === 'overview' && (
          <div>

            {!drilldownType && (
              <DashboardCharts
                territoryRows={territoryPerformance?.rows || []}
                products={topProducts}
                regionalRows={filteredRegionalSalesRows}
                monthLabel={`${MONTH_NAMES[month]} ${year}`}
              />
            )}

            <ActionCentre
              items={actionItems}
              loading={actionCentreLoading || targetLoading}
              onOpen={item => {
                setDrilldownType(null);
                setActionDetailItem(item);
              }}
            />

            <div style={{ marginBottom: 20 }}>
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px 16px 0 0', padding: '13px 15px 0' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: '#111827' }}>Performance Explorer</div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>One focused view at a time · all Dashboard filters remain applied</div>
                  </div>
                  <span style={{ fontSize: 9, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 20, padding: '4px 8px' }}>{scopeLabel} · {selCity || selRegion || 'All territories'}</span>
                </div>
                <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
                  {[
                    { key: 'territories', label: 'Territories', count: territoryPerformance?.rows?.length || 0, color: '#2563eb' },
                    { key: 'reps', label: 'Reps', count: repScorecardRows.length, color: '#7c3aed' },
                    { key: 'doctors', label: 'Doctors', count: totalDocs, color: '#c2410c' },
                    { key: 'products', label: 'Products', count: topProducts.filter(product => Number(product.total_sales) > 0).length, color: '#0f6e56' },
                  ].map(tab => {
                    const active = performanceTab === tab.key;
                    return (
                      <button key={tab.key} onClick={() => { setPerformanceTab(tab.key); if (tab.key !== 'products') { setSelProduct(null); setProductDoctors([]); } }} style={{ border: 'none', borderBottom: active ? `3px solid ${tab.color}` : '3px solid transparent', background: active ? `${tab.color}08` : '#fff', color: active ? tab.color : '#64748b', padding: '9px 13px', fontSize: 10, fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {tab.label} <span style={{ opacity: 0.62 }}>· {tab.count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ paddingTop: 12 }}>
                {performanceTab === 'territories' && (
                  <TerritoryPerformanceMatrix
                    data={territoryPerformance}
                    loading={territoryPerformanceLoading}
                    month={month}
                    year={year}
                    onOpen={path => {
                      if (path === '/regional-sales') setDrilldownType('regional');
                      else if (path === '/visit-log' || path === '/tasks') setDrilldownType('execution');
                      else setDrilldownType('investment');
                    }}
                    onSetTarget={me?.role === 'md' ? () => navigate('/target-setting') : null}
                  />
                )}
                {performanceTab === 'reps' && (
                  <RepPerformanceScorecard
                    rows={repScorecardRows}
                    loading={repScorecardLoading}
                    month={month}
                    year={year}
                    week={repScorecard?.regional_week}
                    onOpenPerson={row => {
                      const selected = allUsers.find(user => Number(user.id) === Number(row.user_id));
                      if (!selected) return;
                      setSelUser(selected); setSelDoctor(null); setSelProduct(null); setView('team');
                    }}
                  />
                )}
                {performanceTab === 'doctors' && (
                  <DoctorPerformanceTab doctors={displayDoctors} onOpenDoctor={doctor => {
                    setSelDoctor(doctor);
                    setSelUser(allUsers.find(user => Number(user.id) === Number(doctor.manager_id)) || null);
                    if (doctor.state_code) setSelState(toStateName(doctor.state_code));
                    setView('product');
                  }} />
                )}
                {performanceTab === 'products' && (
                  <ProductPerformanceTab
                    products={topProducts}
                    selectedProduct={selProduct}
                    doctors={productDoctors}
                    loading={productDoctorsLoading}
                    onBack={() => { setSelProduct(null); setProductDoctors([]); setShowAllProdDoctors(false); }}
                    onSelectProduct={product => {
                      setSelProduct(product);
                      setProductDoctorsLoading(true);
                      axios.get(`${API}/sales/product/${product.product_id}/doctors`, {
                        params: { year, month, start_date: startDate, end_date: endDate, viewer_id: me.id, owner_scope: effectiveScope },
                      }).then(response => {
                        const visibleDoctorIds = new Set(displayDoctors.map(doctor => Number(doctor.doctor_id || doctor.id)));
                        setProductDoctors((response.data || []).filter(doctor => visibleDoctorIds.has(Number(doctor.doctor_id))));
                      }).catch(() => setProductDoctors([])).finally(() => setProductDoctorsLoading(false));
                    }}
                  />
                )}
              </div>
            </div>

            {/* Legacy dashboard blocks are intentionally retired; their data now lives in the explorer above. */}
            {false && <>

            <TerritoryPerformanceMatrix
              data={territoryPerformance}
              loading={territoryPerformanceLoading}
              month={month}
              year={year}
              onOpen={path => navigate(path)}
              onSetTarget={me?.role === 'md' ? () => navigate('/target-setting') : null}
            />

            <RepPerformanceScorecard
              rows={repScorecardRows}
              loading={repScorecardLoading}
              month={month}
              year={year}
              week={repScorecard?.regional_week}
              onOpenPerson={row => {
                const selected = allUsers.find(user => Number(user.id) === Number(row.user_id));
                if (!selected) return;
                setSelUser(selected);
                setSelDoctor(null);
                setSelProduct(null);
                setView('team');
              }}
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
                  const top5Reps = Object.values(repMap).filter(rep => rep.sales > 0).sort((a, b) => b.sales - a.sales).slice(0, 5);
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
                {topProducts.filter(product => Number(product.total_sales) > 0).length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#aaa', padding: '24px 0', fontSize: 13 }}>No sales data yet</div>
                ) : (() => {
                  const colors = ['#7C3AED','#A855F7','#6D28D9','#8B5CF6','#C084FC'];
                  const rankedProducts = topProducts.filter(product => Number(product.total_sales) > 0);
                  const maxVal = rankedProducts[0] ? rankedProducts[0].total_sales : 1;
                  const visible = showMoreProducts ? rankedProducts : rankedProducts.slice(0, 5);
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
                      {rankedProducts.length > 5 && (
                        <button onClick={() => setShowMoreProducts(s => !s)}
                          style={{ marginTop: 6, padding: '5px 12px', borderRadius: 20, border: '1px solid #E9D5FF',
                            background: '#FAF5FF', fontSize: 11, fontWeight: 600, color: '#7C3AED', cursor: 'pointer' }}>
                          {showMoreProducts ? 'Show less' : `+ ${rankedProducts.length - 5} more`}
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
                <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>Ranked by highest recovery shortfall</span>
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
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 11, color: '#b91c1c', fontWeight: 900 }}>{fmtInr(d.recovery_shortfall)} shortfall</div>
                          <div style={{ marginTop: 3 }}><Pill label={d.roi_grade || 'Bronze'} bg={GRADE_BG[d.roi_grade]} color={GRADE_COLOR[d.roi_grade]} /></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </>}
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
          <Doctor360View doctor={selDoctor} repUser={selUser} year={year} month={month} viewer={me} />
        )}
      </div>

      {actionDrilldownConfig && (
        <DashboardDrilldownDrawer
          config={actionDrilldownConfig}
          context={drilldownContext}
          onClose={() => setActionDetailItem(null)}
          onOpenFull={openActionFull}
        />
      )}
    </div>
  );
}
