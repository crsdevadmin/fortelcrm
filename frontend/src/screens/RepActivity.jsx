import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { exportsAPI } from '../api';

const MN  = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const now  = new Date();
const CUR_Y = now.getFullYear();
const CUR_M = now.getMonth() + 1;

const fmtV = v => {
  const n = parseFloat(v) || 0;
  return n >= 100000 ? `₹${(n/100000).toFixed(1)}L` : n >= 1000 ? `₹${(n/1000).toFixed(1)}K` : `₹${Math.round(n)}`;
};

export default function RepActivity() {
  const { user: me } = useAuth();

  const [year,  setYear]  = useState(CUR_Y);
  const [month, setMonth] = useState(CUR_M);
  const [data,  setData]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});

  const goMonth = delta => {
    let y = year, m = month + delta;
    if (m < 1)  { m = 12; y -= 1; }
    if (m > 12) { m = 1;  y += 1; }
    if (y > CUR_Y || (y === CUR_Y && m > CUR_M)) return;
    setYear(y); setMonth(m);
  };

  useEffect(() => {
    if (!me?.id) return;
    setLoading(true);
    exportsAPI.repActivityData(year, month, { viewer_id: me.id })
      .then(r => {
        setData(r.data || []);
        // Auto-expand all reps
        const exp = {};
        (r.data || []).forEach(rep => { exp[rep.rep_id] = true; });
        setExpanded(exp);
      })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [me?.id, year, month]);

  const WEEKS = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];

  const downloadUrl = exportsAPI.repActivityUrl(year, month, { viewer_id: me?.id });
  const doctorMasterUrl = exportsAPI.doctorMasterUrl({ viewer_id: me?.id });
  const salesUrl = exportsAPI.salesUrl(year, month, { viewer_id: me?.id });

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#0B1E10 0%,#1A3A1A 60%,#2D5A27 100%)', fontFamily: "'Inter','Segoe UI',sans-serif", paddingBottom: 40 }}>

      {/* ── Header ── */}
      <div style={{ padding: '20px 24px 16px' }}>
        <div style={{ color: '#fff', fontSize: 22, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>
          Rep Activity
        </div>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
          Field visits, hospitals, doctors, and sales — by rep, by week
        </div>

        {/* Controls row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.12)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', overflow: 'hidden' }}>
            <button onClick={() => goMonth(-1)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, padding: '6px 12px', cursor: 'pointer' }}>‹</button>
            <span style={{ fontWeight: 700, fontSize: 13, minWidth: 80, textAlign: 'center', color: '#fff' }}>{MN[month]} {year}</span>
            <button onClick={() => goMonth(1)} disabled={year === CUR_Y && month === CUR_M}
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, padding: '6px 12px', cursor: 'pointer', opacity: (year === CUR_Y && month === CUR_M) ? 0.2 : 0.85 }}>›</button>
          </div>

          {/* Download buttons */}
          <a href={downloadUrl} download
            style={{ background: '#3D8C40', color: '#fff', textDecoration: 'none', border: 'none', borderRadius: 9, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            ⬇ Rep Activity Excel
          </a>
          <a href={salesUrl} download
            style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 9, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            ⬇ Sales Excel
          </a>
          <a href={doctorMasterUrl} download
            style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 9, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            ⬇ Doctor Master
          </a>
        </div>
      </div>

      <div style={{ padding: '0 24px' }}>

        {loading && (
          <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
            Loading activity data…
          </div>
        )}

        {!loading && data.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.4)' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>No activity data for {MN[month]} {year}</div>
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.6 }}>Visits and sales will appear here once reps submit entries</div>
          </div>
        )}

        {!loading && data.map(rep => {
          const open = !!expanded[rep.rep_id];
          const hasActivity = rep.total_visits > 0 || rep.total_sales > 0;

          return (
            <div key={rep.rep_id} style={{ background: '#fff', borderRadius: 16, border: '0.5px solid rgba(255,255,255,0.1)', marginBottom: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.15)' }}>

              {/* Rep header */}
              <div onClick={() => setExpanded(p => ({ ...p, [rep.rep_id]: !p[rep.rep_id] }))}
                style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', cursor: 'pointer', background: open ? '#f9fafb' : '#fff', userSelect: 'none' }}>

                {/* Avatar */}
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#0B1E10', color: '#F5B800', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13, flexShrink: 0, marginRight: 14 }}>
                  {(rep.rep_name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>

                {/* Name + role */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#0B1E10' }}>{rep.rep_name}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 1, textTransform: 'capitalize' }}>{rep.role}</div>
                </div>

                {/* Summary chips */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginRight: 14 }}>
                  {[
                    { label: 'Visit days', value: rep.total_visits, color: '#EAF5EA', text: '#1D5C20' },
                    { label: 'Sales',      value: fmtV(rep.total_sales), color: '#FEF3C7', text: '#92400E' },
                  ].map((c, i) => (
                    <div key={i} style={{ textAlign: 'center', background: hasActivity ? c.color : '#f3f4f6', borderRadius: 8, padding: '4px 10px' }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: hasActivity ? c.text : '#aaa' }}>{c.value}</div>
                      <div style={{ fontSize: 9, color: hasActivity ? c.text : '#bbb', opacity: 0.8 }}>{c.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ color: '#ccc', fontSize: 13 }}>{open ? '▲' : '▼'}</div>
              </div>

              {/* Weekly breakdown */}
              {open && (
                <div style={{ borderTop: '1px solid #f0f0f0' }}>
                  {/* Week header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '80px repeat(4, 1fr)', padding: '8px 18px', background: '#f9fafb', fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #f0f0f0' }}>
                    <div>Metric</div>
                    {WEEKS.map(w => <div key={w} style={{ textAlign: 'center' }}>{w}</div>)}
                  </div>

                  {/* Rows */}
                  {[
                    {
                      label: '📍 Visit Days',
                      key:   'visit_days',
                      fmt:   v => v > 0 ? v : '—',
                      color: v => v > 0 ? '#1D5C20' : '#ccc',
                    },
                    {
                      label: '🏥 Hospitals',
                      key:   'unique_hospitals',
                      fmt:   v => v > 0 ? v : '—',
                      color: v => v > 0 ? '#1D4ED8' : '#ccc',
                    },
                    {
                      label: '👤 Doctors',
                      key:   'unique_doctors',
                      fmt:   v => v > 0 ? v : '—',
                      color: v => v > 0 ? '#7C3AED' : '#ccc',
                    },
                    {
                      label: '📋 Entries',
                      key:   'sales_entries',
                      fmt:   v => v > 0 ? v : '—',
                      color: v => v > 0 ? '#B45309' : '#ccc',
                    },
                    {
                      label: '💰 Sales',
                      key:   'sales_value',
                      fmt:   v => v > 0 ? fmtV(v) : '—',
                      color: v => v > 0 ? '#3D8C40' : '#ccc',
                    },
                  ].map((row, rIdx) => (
                    <div key={rIdx} style={{ display: 'grid', gridTemplateColumns: '80px repeat(4, 1fr)', padding: '10px 18px', borderBottom: '1px solid #f8f8f8', alignItems: 'center' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#444' }}>{row.label}</div>
                      {rep.weeks.map((wk, wIdx) => {
                        const val = wk[row.key];
                        return (
                          <div key={wIdx} style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: row.color(val) }}>
                            {row.fmt(val)}
                          </div>
                        );
                      })}
                    </div>
                  ))}

                  {/* Month total row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '80px repeat(4, 1fr)', padding: '10px 18px', background: '#0B1E10', borderRadius: '0 0 16px 16px', alignItems: 'center' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#F5B800' }}>Month Total</div>
                    {rep.weeks.map((wk, i) => {
                      const wkSales = wk.sales_value;
                      return (
                        <div key={i} style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: wkSales > 0 ? '#4ade80' : 'rgba(255,255,255,0.2)' }}>
                          {wkSales > 0 ? fmtV(wkSales) : '—'}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
