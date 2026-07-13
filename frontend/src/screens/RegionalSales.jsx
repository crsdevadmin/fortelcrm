import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const API   = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const MN    = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const now   = new Date();
const CUR_Y = now.getFullYear();
const CUR_M = now.getMonth() + 1;

const fmtV = v => { const n=parseFloat(v)||0; return n>=100000?`₹${(n/100000).toFixed(1)}L`:n>=1000?`₹${(n/1000).toFixed(1)}K`:`₹${Math.round(n)}`; };

const gstRate = g => { if(!g) return 0.05; const n=parseFloat(g); return isNaN(n)?0.05:n/100; };

const rowTotal = r => {
  let t = 0;
  for (let w = 1; w <= 4; w++) {
    t += (parseFloat(r[`w${w}_qty`])||0) * (parseFloat(r[`w${w}_price`])||0) * (1 + gstRate(r.product.gst));
  }
  return parseFloat(t.toFixed(2));
};

export default function RegionalSales() {
  const { user: me } = useAuth();

  const [year,  setYear]  = useState(CUR_Y);
  const [month, setMonth] = useState(CUR_M);

  const [products, setProducts] = useState([]);
  const [prodQ,    setProdQ]    = useState('');
  const [prodOpen, setProdOpen] = useState(false);
  const [rows,     setRows]     = useState([]);  // {uid, product, w1_qty,w1_price,...}

  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const [history,  setHistory]  = useState([]);
  const [histOpen, setHistOpen] = useState({});

  const prodRef = useRef(null);

  /* outside click */
  useEffect(() => {
    const h = e => { if (prodRef.current && !prodRef.current.contains(e.target)) setProdOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  /* load products master */
  useEffect(() => {
    axios.get(`${API}/products/`).then(r => setProducts(r.data || [])).catch(() => {});
  }, []);

  /* load saved data for this month */
  const loadMonth = (y, m) => {
    if (!me?.id) return;
    setLoading(true);
    setRows([]); setErr(''); setSuccess('');
    axios.get(`${API}/exports/my-weekly`, { params: { associate_id: me.id, year: y, month: m } })
      .then(r => {
        const saved = r.data.products || [];
        if (saved.length > 0) {
          setRows(saved.map(p => ({
            uid:       `${p.product_id}-loaded`,
            product:   { id: p.product_id, name: p.product_name, gst: p.gst, rate: p.rate, mrp: p.mrp },
            w1_qty:    p.w1_qty   > 0 ? String(p.w1_qty)   : '',
            w1_price:  p.w1_price > 0 ? String(p.w1_price) : '',
            w2_qty:    p.w2_qty   > 0 ? String(p.w2_qty)   : '',
            w2_price:  p.w2_price > 0 ? String(p.w2_price) : '',
            w3_qty:    p.w3_qty   > 0 ? String(p.w3_qty)   : '',
            w3_price:  p.w3_price > 0 ? String(p.w3_price) : '',
            w4_qty:    p.w4_qty   > 0 ? String(p.w4_qty)   : '',
            w4_price:  p.w4_price > 0 ? String(p.w4_price) : '',
          })));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  /* load month history list */
  const loadHistory = () => {
    if (!me?.id) return;
    axios.get(`${API}/exports/weekly-history`, { params: { associate_id: me.id } })
      .then(r => setHistory(r.data || [])).catch(() => {});
  };

  useEffect(() => { loadMonth(year, month); loadHistory(); }, [me?.id, year, month]);

  const goMonth = delta => {
    let y = year, m = month + delta;
    if (m < 1)  { m = 12; y -= 1; }
    if (m > 12) { m = 1;  y += 1; }
    setYear(y); setMonth(m);
  };

  /* product search dropdown */
  const prodList = prodQ.trim()
    ? products.filter(p => (p.name||'').toLowerCase().includes(prodQ.toLowerCase())).slice(0, 12)
    : products.slice(0, 12);

  const addProduct = p => {
    setProdQ(''); setProdOpen(false);
    if (rows.find(r => r.product.id === p.id)) return;
    setRows(prev => [...prev, {
      uid: `${p.id}-${Date.now()}`, product: p,
      w1_qty:'', w1_price: p.rate > 0 ? String(p.rate) : '',
      w2_qty:'', w2_price: p.rate > 0 ? String(p.rate) : '',
      w3_qty:'', w3_price: p.rate > 0 ? String(p.rate) : '',
      w4_qty:'', w4_price: p.rate > 0 ? String(p.rate) : '',
    }]);
  };

  const updRow = (uid, field, val) =>
    setRows(prev => prev.map(r => r.uid === uid ? { ...r, [field]: val } : r));

  const delRow = uid => setRows(prev => prev.filter(r => r.uid !== uid));

  const grandTotal = rows.reduce((s, r) => s + rowTotal(r), 0);

  const submit = async () => {
    if (rows.length === 0) { setErr('Add at least one product'); return; }
    setBusy(true); setErr('');
    try {
      const items = rows.map(r => ({
        product_id: r.product.id,
        w1_qty:   parseFloat(r.w1_qty)   || 0,  w1_price: parseFloat(r.w1_price) || 0,
        w2_qty:   parseFloat(r.w2_qty)   || 0,  w2_price: parseFloat(r.w2_price) || 0,
        w3_qty:   parseFloat(r.w3_qty)   || 0,  w3_price: parseFloat(r.w3_price) || 0,
        w4_qty:   parseFloat(r.w4_qty)   || 0,  w4_price: parseFloat(r.w4_price) || 0,
        gst_rate: gstRate(r.product.gst),
      }));
      await axios.post(`${API}/exports/weekly-entry`, {
        associate_id: me.id, year, month, items,
      });
      setSuccess(`Saved — ${MN[month]} ${year} · ${fmtV(grandTotal)}`);
      loadHistory();
    } catch (e) {
      setErr(e.response?.data?.detail || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const WEEKS = [1, 2, 3, 4];
  const WEEK_DATES = ['1–7', '8–14', '15–21', '22+'];

  /* styles */
  const numInput = { width: '100%', padding: '6px 6px', border: '1px solid #e0e0e0', borderRadius: 7, fontSize: 12, textAlign: 'right', outline: 'none', boxSizing: 'border-box', background: '#fff' };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#0B1E10 0%,#1A3A1A 60%,#2D5A27 100%)', fontFamily: "'Inter','Segoe UI',sans-serif", paddingBottom: 48 }}>

      {/* ── HEADER ── */}
      <div style={{ padding: '20px 24px 16px' }}>
        <div style={{ color: '#fff', fontSize: 22, fontWeight: 900, letterSpacing: -0.5, marginBottom: 2 }}>Regional Sales</div>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 16 }}>
          Weekly product sales — enter quantity &amp; price per week
        </div>

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.12)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', overflow: 'hidden' }}>
            <button onClick={() => goMonth(-1)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, padding: '6px 14px', cursor: 'pointer', lineHeight: 1 }}>‹</button>
            <span style={{ fontWeight: 700, fontSize: 14, minWidth: 90, textAlign: 'center', color: '#fff' }}>{MN[month]} {year}</span>
            <button onClick={() => goMonth(1)} disabled={year===CUR_Y&&month===CUR_M}
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, padding: '6px 14px', cursor: 'pointer', lineHeight: 1, opacity: (year===CUR_Y&&month===CUR_M)?0.2:0.9 }}>›</button>
          </div>

          {grandTotal > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '6px 16px', border: '1px solid rgba(255,255,255,0.15)' }}>
              <div style={{ fontSize: 9, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Month Total</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#4ade80' }}>{fmtV(grandTotal)}</div>
            </div>
          )}
        </div>

        {success && (
          <div style={{ marginTop: 12, background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: '#065f46', fontWeight: 600 }}>
            ✅ {success}
          </div>
        )}
      </div>

      {/* ── MAIN CARD ── */}
      <div style={{ margin: '0 24px', background: '#fff', borderRadius: 18, boxShadow: '0 4px 32px rgba(0,0,0,0.18)', overflow: 'hidden' }}>

        {/* Product search bar */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #f0f0f0', background: '#fafff8' }}>
          <div ref={prodRef} style={{ position: 'relative', maxWidth: 400 }}>
            <input
              value={prodQ}
              onChange={e => { setProdQ(e.target.value); setProdOpen(true); }}
              onFocus={() => setProdOpen(true)}
              placeholder="+ Search and add a product…"
              style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #3D8C40', borderRadius: 10, fontSize: 13, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
            />
            {prodOpen && prodList.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, maxHeight: 260, overflowY: 'auto', marginTop: 4 }}>
                {prodList.map(p => (
                  <div key={p.id} onClick={() => addProduct(p)}
                    style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '0.5px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.background='#f0faf0'}
                    onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                      {p.composition && <div style={{ fontSize: 10, color: '#888', marginTop: 1 }}>{p.composition}</div>}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                      {p.rate > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: '#3D8C40' }}>₹{p.rate}</div>}
                      <div style={{ fontSize: 10, color: '#aaa' }}>{p.gst || '5%'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: '#aaa', fontSize: 13 }}>Loading saved data…</div>
        )}

        {/* Empty state */}
        {!loading && rows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: '#ccc' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#aaa' }}>No products added for {MN[month]} {year}</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Search above to add products and enter weekly sales</div>
          </div>
        )}

        {/* ── GRID ── */}
        {!loading && rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
              <thead>
                <tr style={{ background: '#0B1E10' }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 0.5, width: '28%' }}>Product</th>
                  {WEEKS.map((wk, i) => (
                    <th key={wk} style={{ padding: '10px 8px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#F5B800', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Week {wk}
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontWeight: 400, marginTop: 1 }}>{WEEK_DATES[i]} {MN[month]}</div>
                    </th>
                  ))}
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>Total</th>
                  <th style={{ width: 36 }}/>
                </tr>
                {/* Sub-header: Qty / Price */}
                <tr style={{ background: '#1A3A1A' }}>
                  <th style={{ padding: '5px 16px', fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}/>
                  {WEEKS.map(wk => (
                    <th key={wk} style={{ padding: '4px 8px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 9, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
                        <span>Qty</span><span>Price ₹</span>
                      </div>
                    </th>
                  ))}
                  <th/><th/>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const tot = rowTotal(r);
                  return (
                    <tr key={r.uid} style={{ background: idx % 2 === 0 ? '#fff' : '#fafff8', borderBottom: '1px solid #f0f0f0' }}>
                      {/* Product */}
                      <td style={{ padding: '10px 16px', verticalAlign: 'middle' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{r.product.name}</div>
                        {r.product.rate > 0 && <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>PTS ₹{r.product.rate} · {r.product.gst || '5%'} GST</div>}
                      </td>

                      {/* Week columns */}
                      {WEEKS.map(wk => (
                        <td key={wk} style={{ padding: '8px 8px', verticalAlign: 'middle' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                            <input type="number" min="0" placeholder="0"
                              value={r[`w${wk}_qty`]}
                              onChange={ev => updRow(r.uid, `w${wk}_qty`, ev.target.value)}
                              style={numInput}
                              onFocus={ev => ev.target.style.borderColor='#3D8C40'}
                              onBlur={ev  => ev.target.style.borderColor='#e0e0e0'}
                            />
                            <input type="number" min="0" step="0.01" placeholder="0.00"
                              value={r[`w${wk}_price`]}
                              onChange={ev => updRow(r.uid, `w${wk}_price`, ev.target.value)}
                              style={numInput}
                              onFocus={ev => ev.target.style.borderColor='#3D8C40'}
                              onBlur={ev  => ev.target.style.borderColor='#e0e0e0'}
                            />
                          </div>
                          {/* Mini total for this week×product */}
                          {(() => {
                            const wqty = parseFloat(r[`w${wk}_qty`])||0;
                            const wprice = parseFloat(r[`w${wk}_price`])||0;
                            const wval = parseFloat((wqty * wprice * (1 + gstRate(r.product.gst))).toFixed(2));
                            return wval > 0
                              ? <div style={{ fontSize: 10, textAlign: 'center', color: '#3D8C40', fontWeight: 600, marginTop: 3 }}>{fmtV(wval)}</div>
                              : null;
                          })()}
                        </td>
                      ))}

                      {/* Row total */}
                      <td style={{ padding: '8px 14px', textAlign: 'right', verticalAlign: 'middle' }}>
                        {tot > 0
                          ? <div style={{ fontSize: 14, fontWeight: 800, color: '#0B1E10' }}>{fmtV(tot)}</div>
                          : <div style={{ fontSize: 13, color: '#ddd' }}>—</div>}
                      </td>

                      {/* Delete */}
                      <td style={{ padding: '8px 8px', textAlign: 'center', verticalAlign: 'middle' }}>
                        <button onClick={() => delRow(r.uid)}
                          style={{ background: '#fee2e2', border: 'none', cursor: 'pointer', color: '#DC2626', padding: '5px 8px', borderRadius: 6, fontWeight: 700, fontSize: 11 }}
                          onMouseEnter={ev => { ev.currentTarget.style.background='#DC2626'; ev.currentTarget.style.color='#fff'; }}
                          onMouseLeave={ev => { ev.currentTarget.style.background='#fee2e2'; ev.currentTarget.style.color='#DC2626'; }}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Grand total footer */}
              <tfoot>
                <tr style={{ background: '#0B1E10' }}>
                  <td style={{ padding: '12px 16px', color: '#F5B800', fontWeight: 700, fontSize: 13 }}>
                    Grand Total
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 400, marginTop: 1 }}>incl. GST · {rows.length} product{rows.length!==1?'s':''}</div>
                  </td>
                  {WEEKS.map(wk => {
                    const wkTotal = rows.reduce((s, r) => {
                      const q = parseFloat(r[`w${wk}_qty`])||0;
                      const p = parseFloat(r[`w${wk}_price`])||0;
                      return s + q * p * (1 + gstRate(r.product.gst));
                    }, 0);
                    return (
                      <td key={wk} style={{ padding: '12px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: wkTotal > 0 ? '#4ade80' : 'rgba(255,255,255,0.15)' }}>
                        {wkTotal > 0 ? fmtV(wkTotal) : '—'}
                      </td>
                    );
                  })}
                  <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 16, fontWeight: 900, color: '#F5B800' }}>
                    {fmtV(grandTotal)}
                  </td>
                  <td/>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Error + Submit */}
        {rows.length > 0 && (
          <div style={{ padding: '16px 18px', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {err && <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 9, padding: '8px 14px', fontSize: 13, color: '#DC2626', flex: '1 1 100%' }}>{err}</div>}
            <button onClick={submit} disabled={busy}
              style={{ background: grandTotal > 0 ? '#3D8C40' : '#e5e7eb', color: grandTotal > 0 ? '#fff' : '#aaa', border: 'none', borderRadius: 10, padding: '11px 28px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
              {busy ? 'Saving…' : `✅ Save — ${MN[month]} ${year} · ${fmtV(grandTotal)}`}
            </button>
            <div style={{ fontSize: 12, color: '#aaa' }}>{rows.length} products · totals include GST</div>
          </div>
        )}
      </div>

      {/* ── HISTORY ── */}
      {history.length > 0 && (
        <div style={{ margin: '20px 24px 0' }}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Previous Months</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {history.map(h => {
              const isCurrent = h.year === year && h.month === month;
              return (
                <button key={`${h.year}-${h.month}`}
                  onClick={() => { setYear(h.year); setMonth(h.month); }}
                  style={{ background: isCurrent ? '#F5B800' : 'rgba(255,255,255,0.1)', color: isCurrent ? '#0B1E10' : '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, padding: '8px 16px', cursor: 'pointer', textAlign: 'left' }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{MN[h.month]} {h.year}</div>
                  <div style={{ fontSize: 11, opacity: 0.7, marginTop: 1 }}>{fmtV(h.total)}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
