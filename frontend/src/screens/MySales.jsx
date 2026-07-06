import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const API = process.env.REACT_APP_API_URL || '';
const MN  = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const now     = new Date();
const CUR_Y   = now.getFullYear();
const CUR_M   = now.getMonth() + 1;

const fmtD = s => {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${+d} ${MN[+m]} ${y}`;
};
const fmtV = v => {
  const n = parseFloat(v) || 0;
  return n >= 100000 ? `₹${(n/100000).toFixed(1)}L`
       : n >= 1000   ? `₹${(n/1000).toFixed(1)}K`
       : `₹${Math.round(n)}`;
};
const dayName = s => {
  if (!s) return '';
  return new Date(s).toLocaleDateString('en-IN', { weekday: 'short' });
};

export default function MySales() {
  const { user: me } = useAuth();

  const [year,    setYear]    = useState(CUR_Y);
  const [month,   setMonth]   = useState(CUR_M);
  const [data,    setData]    = useState([]);   // [{date, doctors, day_total}]
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});  // date → bool

  const load = (y, m) => {
    if (!me?.id) return;
    setLoading(true);
    axios.get(`${API}/sales/my-sales`, { params: { associate_id: me.id, year: y, month: m } })
      .then(r => {
        setData(r.data || []);
        // auto-expand first (most recent) date
        if (r.data?.length > 0) {
          setExpanded({ [r.data[0].date]: true });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(year, month); }, [me?.id, year, month]);

  const goMonth = (delta) => {
    let y = year, m = month + delta;
    if (m < 1)  { m = 12; y -= 1; }
    if (m > 12) { m = 1;  y += 1; }
    if (y > CUR_Y || (y === CUR_Y && m > CUR_M)) return;
    setYear(y); setMonth(m);
  };

  const toggle = (date) => setExpanded(prev => ({ ...prev, [date]: !prev[date] }));

  const grandTotal  = data.reduce((s, d) => s + d.day_total, 0);
  const totalDocs   = data.reduce((s, d) => s + d.doctors.length, 0);
  const totalVisits = data.length;

  return (
    <div style={{ padding: '20px 24px', maxWidth: 860 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>My Sales</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
            All entries you have submitted
          </div>
        </div>

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 10, padding: '6px 12px' }}>
          <button onClick={() => goMonth(-1)}
            style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#555', padding: '0 4px' }}>‹</button>
          <span style={{ fontWeight: 700, fontSize: 14, minWidth: 90, textAlign: 'center' }}>
            {MN[month]} {year}
          </span>
          <button onClick={() => goMonth(1)}
            disabled={year === CUR_Y && month === CUR_M}
            style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: (year === CUR_Y && month === CUR_M) ? '#ddd' : '#555', padding: '0 4px' }}>›</button>
        </div>
      </div>

      {/* ── Summary strip ── */}
      {data.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { label: 'Total Sales',  value: fmtV(grandTotal),       color: '#3D8C40' },
            { label: 'Visit Days',   value: totalVisits,             color: '#1A1A1A' },
            { label: 'Doctors Met',  value: totalDocs,               color: '#1A1A1A' },
          ].map((s, i) => (
            <div key={i} style={{ flex: 1, minWidth: 110, background: '#fff', borderRadius: 12, padding: '12px 16px', border: '0.5px solid #e5e7eb' }}>
              <div style={{ fontSize: 11, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa', fontSize: 13 }}>Loading…</div>
      )}

      {/* ── Empty ── */}
      {!loading && data.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#bbb' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>No entries for {MN[month]} {year}</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Go to Enter Sales to add entries</div>
        </div>
      )}

      {/* ── Day groups ── */}
      {!loading && data.map((day) => {
        const open = !!expanded[day.date];
        return (
          <div key={day.date} style={{ background: '#fff', borderRadius: 14, border: '0.5px solid #e5e7eb', marginBottom: 10, overflow: 'hidden' }}>

            {/* Day header — click to expand/collapse */}
            <div onClick={() => toggle(day.date)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', cursor: 'pointer', background: open ? '#f9fafb' : '#fff', userSelect: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: '#1A1A1A', color: '#F5B800', borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>
                  {dayName(day.date)}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtD(day.date)}</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>
                    {day.doctors.length} doctor{day.doctors.length !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: '#3D8C40' }}>{fmtV(day.day_total)}</div>
                <div style={{ fontSize: 14, color: '#ccc' }}>{open ? '▲' : '▼'}</div>
              </div>
            </div>

            {/* Expanded doctor list */}
            {open && day.doctors.map((doc, di) => (
              <div key={doc.doctor_id} style={{ borderTop: '0.5px solid #f0f0f0' }}>

                {/* Doctor row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px 6px', background: '#fafff8' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{doc.doctor_name}</div>
                    {(doc.hospital || doc.city) && (
                      <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>
                        {[doc.hospital, doc.city].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#3D8C40' }}>{fmtV(doc.total)}</div>
                </div>

                {/* Products */}
                {doc.products.map((p, pi) => (
                  <div key={p.entry_id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 18px 6px 32px',
                    borderTop: '0.5px solid #f5f5f5',
                    background: pi % 2 === 0 ? '#fff' : '#fafafa',
                  }}>
                    <div style={{ fontSize: 12, color: '#555' }}>· {p.product_name}</div>
                    <div style={{ fontSize: 12, color: '#777', display: 'flex', gap: 12, alignItems: 'center' }}>
                      {p.quantity > 0 && <span style={{ color: '#aaa' }}>{p.quantity} qty</span>}
                      <span style={{ fontWeight: 700, color: '#1A1A1A' }}>₹{p.value.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                ))}

                {/* Doctor subtotal line if more than 1 product */}
                {doc.products.length > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '5px 18px', background: '#f0faf0', borderTop: '0.5px solid #e0f0e0' }}>
                    <span style={{ fontSize: 11, color: '#3D8C40', fontWeight: 700 }}>
                      {doc.products.length} products · {fmtV(doc.total)}
                    </span>
                  </div>
                )}
              </div>
            ))}

            {/* Day total footer */}
            {open && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 18px', background: '#1A1A1A', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                <span style={{ color: '#888', fontWeight: 400, fontSize: 12 }}>Day Total</span>
                <span style={{ color: '#F5B800', fontSize: 14 }}>{fmtV(day.day_total)}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
