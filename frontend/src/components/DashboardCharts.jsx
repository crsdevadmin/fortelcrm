import React, { useMemo } from 'react';

// Fortel brand tokens (from styles.css)
const C = {
  surface: '#FFFFFF', surface2: '#FAFAF8', border: '#E8E6DF', border2: '#D4D0C4',
  text1: '#1A1A1A', text2: '#5C5A52', text3: '#9E9B8E',
  blue: '#2a78d6', green: '#3D8C40', gold: '#F5B800',
};
const PRODUCT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#d55181', '#4a3aa7', '#008300', '#B4B2A9'];

function inr(v) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (Math.abs(n) >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

function Card({ title, subtitle, children }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 1px 3px rgba(26,26,26,0.06)', padding: '14px 16px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text1 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11, color: C.text3, marginTop: 2, marginBottom: 8 }}>{subtitle}</div>}
      {children}
    </div>
  );
}

// Keep the two sales streams separate. Regional targets apply only to regional sales.
function TerritoryBars({ rows }) {
  const data = useMemo(() => {
    return [...(rows || [])]
      .map(r => ({
        label: r.territory || r.state_code || '—',
        regional: Number(r.regional_sales || 0),
        doctor: Number(r.doctor_sales || 0),
        target: Number(r.regional_target || 0),
      }))
      .filter(d => d.regional > 0 || d.doctor > 0 || d.target > 0)
      .sort((a, b) => (b.regional + b.doctor) - (a.regional + a.doctor))
      .slice(0, 6);
  }, [rows]);

  if (data.length === 0) return <Empty text="No territory sales yet for this period." />;
  const max = Math.max(1, ...data.map(d => Math.max(d.regional, d.doctor, d.target)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map(d => (
        <div key={d.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: C.text1 }}>{d.label}</span>
            <span style={{ color: C.text2 }}>Regional {inr(d.regional)} · Doctor {inr(d.doctor)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
            <span style={{ width: 12, fontSize: 9, color: C.text3 }}>R</span>
            <div style={{ position: 'relative', flex: 1, height: 8, borderRadius: 4, background: C.surface2, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(d.regional / max) * 100}%`, background: C.blue, borderRadius: 4 }} />
              {d.target > 0 && (
                <div title={`Regional target ${inr(d.target)}`} style={{ position: 'absolute', top: -2, bottom: -2, left: `calc(${Math.min(100, (d.target / max) * 100)}% - 1px)`, width: 2, background: C.text1 }} />
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, fontSize: 9, color: C.text3 }}>D</span>
            <div style={{ position: 'relative', flex: 1, height: 8, borderRadius: 4, background: C.surface2, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(d.doctor / max) * 100}%`, background: C.green, borderRadius: 4 }} />
            </div>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: C.text3, display: 'flex', gap: 14 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: C.blue, marginRight: 4, verticalAlign: -1 }} />Regional sales</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: C.green, marginRight: 4, verticalAlign: -1 }} />Doctor sales</span>
        <span><span style={{ display: 'inline-block', width: 2, height: 11, background: C.text1, marginRight: 5, verticalAlign: -1 }} />Regional target</span>
      </div>
    </div>
  );
}

// Product mix — horizontal bars (top products by sales)
function ProductBars({ products }) {
  const data = useMemo(() => {
    return [...(products || [])]
      .filter(p => Number(p.total_sales) > 0)
      .sort((a, b) => Number(b.total_sales) - Number(a.total_sales))
      .slice(0, 6);
  }, [products]);

  if (data.length === 0) return <Empty text="No product sales yet for this period." />;
  const max = Math.max(1, ...data.map(d => Number(d.total_sales)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((p, i) => (
        <div key={p.product_id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: C.text1 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: PRODUCT_COLORS[i % PRODUCT_COLORS.length], marginRight: 6 }} />{p.product_name}
            </span>
            <span style={{ color: C.text2 }}>{inr(p.total_sales)}</span>
          </div>
          <div style={{ height: 12, borderRadius: 4, background: C.surface2, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
            <div style={{ width: `${(Number(p.total_sales) / max) * 100}%`, height: '100%', background: PRODUCT_COLORS[i % PRODUCT_COLORS.length], borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Weekly sales trend from regional submissions.
function WeeklyTrend({ regionalRows }) {
  const weeks = useMemo(() => {
    const totals = [0, 0, 0, 0];
    (regionalRows || []).forEach(r => {
      const wi = Math.min(Math.max((r.week || 1) - 1, 0), 3);
      totals[wi] += Number(r.value || 0);
    });
    return totals;
  }, [regionalRows]);

  const hasData = weeks.some(v => v > 0);
  if (!hasData) return <Empty text="No weekly regional sales yet for this period." />;
  const max = Math.max(1, ...weeks);
  const W = 300, H = 150, padL = 38, padB = 22, padT = 8;
  const plotW = W - padL - 8, plotH = H - padB - padT;
  const step = plotW / 4;
  const bw = Math.min(38, step * 0.5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Weekly regional sales" style={{ maxHeight: 160 }}>
      {[0, max / 2, max].map((t, i) => {
        const y = padT + plotH - (t / max) * plotH;
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - 8} y2={y} stroke={C.border} strokeWidth="1" />
            <text x={padL - 5} y={y + 3} textAnchor="end" fontSize="9" fill={C.text3}>{inr(t)}</text>
          </g>
        );
      })}
      {weeks.map((v, i) => {
        const x = padL + step * i + (step - bw) / 2;
        const h = (v / max) * plotH;
        const y = padT + plotH - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={h} fill={C.blue} rx="2" />
            <text x={x + bw / 2} y={H - 7} textAnchor="middle" fontSize="10" fill={C.text3}>{`W${i + 1}`}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Empty({ text }) {
  return <div style={{ padding: '18px 10px', textAlign: 'center', color: C.text3, fontSize: 12 }}>{text}</div>;
}

export default function DashboardCharts({ territoryRows = [], products = [], regionalRows = [], monthLabel = '' }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 16 }}>
      <Card title="Regional sales by week" subtitle={monthLabel ? `${monthLabel} · regional submissions` : 'Regional submissions'}>
        <WeeklyTrend regionalRows={regionalRows} />
      </Card>
      <Card title="Territory regional vs doctor sales" subtitle={monthLabel ? `${monthLabel} · separate sales streams` : 'Separate sales streams'}>
        <TerritoryBars rows={territoryRows} />
      </Card>
      <Card title="Top products" subtitle={monthLabel ? `${monthLabel} · by sales value` : 'By sales value'}>
        <ProductBars products={products} />
      </Card>
    </div>
  );
}
