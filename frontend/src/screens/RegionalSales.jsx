import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const API = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const MN  = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const now   = new Date();
const CUR_Y = now.getFullYear();
const CUR_M = now.getMonth() + 1;

const fmtV = v => {
  const n = parseFloat(v) || 0;
  return n >= 100000 ? `₹${(n/100000).toFixed(1)}L`
       : n >= 1000   ? `₹${(n/1000).toFixed(1)}K`
       : `₹${Math.round(n)}`;
};

const gstNum = g => {
  if (!g) return 0.05;
  const n = parseFloat(String(g).replace('%',''));
  return isNaN(n) ? 0.05 : n / 100;
};

const STATE_COLORS = [
  '#3D8C40','#6D28D9','#1D4ED8','#B45309','#92400E','#7C3AED','#065F46','#9D174D',
];

// Build rows from products master, then overlay saved data
const buildRows = (allProducts, savedMap) =>
  allProducts.map(p => {
    const s = savedMap[p.id] || {};
    return {
      product_id:  p.id,
      name:        p.name,
      composition: p.composition || '',
      rate:        p.rate  || p.price || 0,
      gst:         p.gst   || '5%',
      category:    p.category || '',
      w1_qty:    s.w1_qty   != null ? String(s.w1_qty)   : '',
      w1_price:  s.w1_price != null ? String(s.w1_price) : (p.rate || p.price || '') !== '' ? String(p.rate || p.price || '') : '',
      w2_qty:    s.w2_qty   != null ? String(s.w2_qty)   : '',
      w2_price:  s.w2_price != null ? String(s.w2_price) : (p.rate || p.price || '') !== '' ? String(p.rate || p.price || '') : '',
      w3_qty:    s.w3_qty   != null ? String(s.w3_qty)   : '',
      w3_price:  s.w3_price != null ? String(s.w3_price) : (p.rate || p.price || '') !== '' ? String(p.rate || p.price || '') : '',
      w4_qty:    s.w4_qty   != null ? String(s.w4_qty)   : '',
      w4_price:  s.w4_price != null ? String(s.w4_price) : (p.rate || p.price || '') !== '' ? String(p.rate || p.price || '') : '',
    };
  });

const rowTotal = r => {
  let t = 0;
  const g = gstNum(r.gst);
  for (let w = 1; w <= 4; w++) {
    t += (parseFloat(r[`w${w}_qty`]) || 0) * (parseFloat(r[`w${w}_price`]) || 0) * (1 + g);
  }
  return parseFloat(t.toFixed(2));
};

const WEEKS = [1, 2, 3, 4];
const WEEK_LABEL = ['W1 (1–7)', 'W2 (8–14)', 'W3 (15–21)', 'W4 (22+)'];

const inp = {
  width: '100%', padding: '5px 6px', border: '1px solid #e0e0e0',
  borderRadius: 6, fontSize: 12, textAlign: 'right', outline: 'none',
  boxSizing: 'border-box', background: '#fff',
};

export default function RegionalSales() {
  const { user: me } = useAuth();

  const [year,   setYear]   = useState(CUR_Y);
  const [month,  setMonth]  = useState(CUR_M);

  const [allProducts, setAllProducts] = useState([]);
  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [busy,        setBusy]        = useState(false);
  const [err,         setErr]         = useState('');
  const [success,     setSuccess]     = useState('');

  // Region filter
  const [regions,    setRegions]    = useState([]);   // [{code, name}]
  const [activeReg,  setActiveReg]  = useState('all');

  // History chips
  const [history, setHistory] = useState([]);

  // Product search filter (within the table)
  const [prodSearch, setProdSearch] = useState('');

  /* ── Load products master ── */
  useEffect(() => {
    axios.get(`${API}/products/`).then(r => {
      setAllProducts(r.data || []);
    }).catch(() => {});
  }, []);

  /* ── Load regions ── */
  useEffect(() => {
    if (!me?.id) return;
    // Try to get user's regions (managers/directors have regions assigned)
    axios.get(`${API}/regions/states`).then(r => {
      const states = r.data || [];
      setRegions(states.map(s => ({ code: s.code || s, name: s.name || s })));
    }).catch(() => {
      // fallback — try manager regions
      axios.get(`${API}/regions/manager/${me.id}`).then(r => {
        setRegions((r.data || []).map(s => ({ code: s.state_code || s.code, name: s.state_name || s.name })));
      }).catch(() => {});
    });
  }, [me?.id]);

  /* ── Load saved monthly data and merge with product master ── */
  const loadMonth = (y, m) => {
    if (!me?.id || allProducts.length === 0) return;
    setLoading(true);
    setErr(''); setSuccess('');

    axios.get(`${API}/exports/my-weekly`, {
      params: { associate_id: me.id, year: y, month: m }
    }).then(r => {
      const saved = r.data.products || [];
      // Build a map: product_id → week data
      const savedMap = {};
      saved.forEach(p => { savedMap[p.product_id] = p; });
      setRows(buildRows(allProducts, savedMap));
    }).catch(() => {
      // No saved data — just load all products empty
      setRows(buildRows(allProducts, {}));
    }).finally(() => setLoading(false));
  };

  useEffect(() => { loadMonth(year, month); }, [me?.id, year, month, allProducts.length]);

  /* ── Load history ── */
  const loadHistory = () => {
    if (!me?.id) return;
    axios.get(`${API}/exports/weekly-history`, { params: { associate_id: me.id } })
      .then(r => setHistory(r.data || [])).catch(() => {});
  };
  useEffect(() => { loadHistory(); }, [me?.id]);

  /* ── Month navigation ── */
  const goMonth = delta => {
    let y = year, m = month + delta;
    if (m < 1)  { m = 12; y -= 1; }
    if (m > 12) { m = 1;  y += 1; }
    setYear(y); setMonth(m);
  };

  /* ── Cell update ── */
  const updCell = (idx, field, val) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));

  /* ── Filtered rows (by region tag / product search) ── */
  const visibleRows = useMemo(() => {
    let filtered = rows;
    if (prodSearch.trim()) {
      const q = prodSearch.toLowerCase();
      filtered = filtered.filter(r =>
        r.name.toLowerCase().includes(q) ||
        (r.composition || '').toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [rows, prodSearch]);

  /* ── Summary stats ── */
  const grandTotal   = rows.reduce((s, r) => s + rowTotal(r), 0);
  const filledCount  = rows.filter(r => WEEKS.some(w => parseFloat(r[`w${w}_qty`]) > 0)).length;

  /* ── Save ── */
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const items = rows
        .filter(r => WEEKS.some(w => parseFloat(r[`w${w}_qty`]) > 0 || parseFloat(r[`w${w}_price`]) > 0))
        .map(r => ({
          product_id: r.product_id,
          w1_qty:   parseFloat(r.w1_qty)   || 0, w1_price: parseFloat(r.w1_price) || 0,
          w2_qty:   parseFloat(r.w2_qty)   || 0, w2_price: parseFloat(r.w2_price) || 0,
          w3_qty:   parseFloat(r.w3_qty)   || 0, w3_price: parseFloat(r.w3_price) || 0,
          w4_qty:   parseFloat(r.w4_qty)   || 0, w4_price: parseFloat(r.w4_price) || 0,
          gst_rate: gstNum(r.gst),
        }));

      if (items.length === 0) { setErr('Enter at least one quantity to save'); setBusy(false); return; }

      await axios.post(`${API}/exports/weekly-entry`, {
        associate_id: me.id, year, month, items,
      });
      setSuccess(`✅ Saved ${items.length} products for ${MN[month]} ${year} · ${fmtV(grandTotal)}`);
      loadHistory();
    } catch (e) {
      setErr(e.response?.data?.detail || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  /* ── Week column total ── */
  const weekTotal = wk => rows.reduce((s, r) => {
    const q = parseFloat(r[`w${wk}_qty`])   || 0;
    const p = parseFloat(r[`w${wk}_price`]) || 0;
    return s + q * p * (1 + gstNum(r.gst));
  }, 0);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#0B1E10 0%,#1A3A1A 55%,#2D5A27 100%)', fontFamily: "'Inter','Segoe UI',sans-serif", paddingBottom: 48 }}>

      {/* ══ HEADER ══ */}
      <div style={{ padding: '20px 20px 14px' }}>
        <div style={{ color: '#fff', fontSize: 22, fontWeight: 900, letterSpacing: -0.5 }}>Regional Sales</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2, marginBottom: 14 }}>
          Weekly product sales entry — update quantity &amp; price per week
        </div>

        {/* Month nav + totals */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.1)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', overflow: 'hidden' }}>
            <button onClick={() => goMonth(-1)}
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, padding: '6px 14px', cursor: 'pointer' }}>‹</button>
            <span style={{ fontWeight: 800, fontSize: 14, minWidth: 96, textAlign: 'center', color: '#fff' }}>
              {MN[month]} {year}
            </span>
            <button onClick={() => goMonth(1)}
              disabled={year === CUR_Y && month === CUR_M}
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, padding: '6px 14px', cursor: 'pointer',
                       opacity: (year === CUR_Y && month === CUR_M) ? 0.2 : 1 }}>›</button>
          </div>

          {/* Stats chips */}
          {grandTotal > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '6px 14px' }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Month Total</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#4ade80' }}>{fmtV(grandTotal)}</div>
            </div>
          )}
          {filledCount > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '6px 14px' }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Products Entered</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#F5B800' }}>{filledCount}</div>
            </div>
          )}
        </div>

        {/* ── REGION FILTER CHIPS ── */}
        {regions.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <button onClick={() => setActiveReg('all')}
              style={{
                border: 'none', borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: activeReg === 'all' ? '#F5B800' : 'rgba(255,255,255,0.12)',
                color:      activeReg === 'all' ? '#0B1E10' : 'rgba(255,255,255,0.8)',
              }}>All Regions</button>
            {regions.map((reg, ri) => (
              <button key={reg.code} onClick={() => setActiveReg(reg.code)}
                style={{
                  border: 'none', borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: activeReg === reg.code ? STATE_COLORS[ri % STATE_COLORS.length] : 'rgba(255,255,255,0.12)',
                  color: activeReg === reg.code ? '#fff' : 'rgba(255,255,255,0.8)',
                }}>{reg.name || reg.code}</button>
            ))}
          </div>
        )}
      </div>

      {/* ══ MAIN CARD ══ */}
      <div style={{ margin: '0 20px', background: '#fff', borderRadius: 18, boxShadow: '0 4px 32px rgba(0,0,0,0.18)', overflow: 'hidden' }}>

        {/* Top bar: search + save button */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', background: '#fafff8', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={prodSearch}
            onChange={e => setProdSearch(e.target.value)}
            placeholder="🔍 Search products in table…"
            style={{ flex: 1, minWidth: 180, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }}
          />
          {success && (
            <div style={{ fontSize: 12, fontWeight: 600, color: '#065f46', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 8, padding: '6px 12px' }}>
              {success}
            </div>
          )}
          {err && (
            <div style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '6px 12px' }}>
              ⚠️ {err}
            </div>
          )}
          <button onClick={submit} disabled={busy || grandTotal === 0}
            style={{
              background: grandTotal > 0 ? '#1A3A1A' : '#e5e7eb',
              color: grandTotal > 0 ? '#fff' : '#aaa',
              border: 'none', borderRadius: 9, padding: '9px 22px',
              fontSize: 13, fontWeight: 800, cursor: grandTotal > 0 ? 'pointer' : 'default', whiteSpace: 'nowrap',
            }}>
            {busy ? 'Saving…' : `💾 Save ${MN[month]} ${year}`}
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: '#aaa', fontSize: 13 }}>
            Loading {MN[month]} {year} data…
          </div>
        )}

        {/* ── TABLE ── */}
        {!loading && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
              <thead>
                {/* Week headers */}
                <tr style={{ background: '#0B1E10' }}>
                  <th rowSpan={2} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.5, width: '24%', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
                    Product
                    {visibleRows.length !== rows.length && (
                      <span style={{ color: '#F5B800', marginLeft: 6 }}>({visibleRows.length} of {rows.length})</span>
                    )}
                  </th>
                  {WEEKS.map((wk, i) => (
                    <th key={wk} colSpan={2} style={{ padding: '10px 8px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#F5B800', textTransform: 'uppercase', letterSpacing: 0.5, borderRight: '1px solid rgba(255,255,255,0.06)' }}>
                      {WEEK_LABEL[i]}
                    </th>
                  ))}
                  <th rowSpan={2} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    Month Total
                  </th>
                </tr>
                {/* Qty / Price sub-headers */}
                <tr style={{ background: '#1A3A1A' }}>
                  {WEEKS.map(wk => (
                    <React.Fragment key={wk}>
                      <th style={{ padding: '5px 6px', fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>Qty</th>
                      <th style={{ padding: '5px 6px', fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.06)' }}>Price ₹</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>

              <tbody>
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '40px 20px', color: '#ccc', fontSize: 13 }}>
                      No products match "{prodSearch}"
                    </td>
                  </tr>
                )}

                {visibleRows.map((r, vi) => {
                  // Find actual index in rows[] for cell update
                  const idx = rows.findIndex(x => x.product_id === r.product_id);
                  const tot = rowTotal(r);
                  const hasAny = WEEKS.some(w => parseFloat(r[`w${w}_qty`]) > 0);

                  return (
                    <tr key={r.product_id}
                      style={{
                        background: hasAny ? '#f0faf0' : vi % 2 === 0 ? '#fff' : '#fafafa',
                        borderBottom: '1px solid #f0f0f0',
                      }}>
                      {/* Product name */}
                      <td style={{ padding: '8px 14px', verticalAlign: 'middle', borderRight: '1px solid #f0f0f0' }}>
                        <div style={{ fontSize: 13, fontWeight: hasAny ? 700 : 500, color: '#111' }}>{r.name}</div>
                        {r.composition && (
                          <div style={{ fontSize: 10, color: '#aaa', marginTop: 1 }}>{r.composition}</div>
                        )}
                        <div style={{ fontSize: 10, color: '#bbb', marginTop: 1 }}>
                          {r.rate > 0 ? `PTS ₹${r.rate}` : ''}{r.rate > 0 && r.gst ? ' · ' : ''}{r.gst}
                        </div>
                      </td>

                      {/* Week cells */}
                      {WEEKS.map(wk => {
                        const wq = parseFloat(r[`w${wk}_qty`])   || 0;
                        const wp = parseFloat(r[`w${wk}_price`]) || 0;
                        const wv = wq * wp * (1 + gstNum(r.gst));
                        return (
                          <React.Fragment key={wk}>
                            <td style={{ padding: '6px 4px', verticalAlign: 'middle' }}>
                              <input type="number" min="0" placeholder="0"
                                value={r[`w${wk}_qty`]}
                                onChange={ev => updCell(idx, `w${wk}_qty`, ev.target.value)}
                                style={{ ...inp, borderColor: wq > 0 ? '#3D8C40' : '#e0e0e0' }}
                                onFocus={ev => ev.target.style.borderColor = '#3D8C40'}
                                onBlur={ev  => ev.target.style.borderColor = wq > 0 ? '#3D8C40' : '#e0e0e0'}
                              />
                            </td>
                            <td style={{ padding: '6px 4px', verticalAlign: 'middle', borderRight: '1px solid #f0f0f0' }}>
                              <input type="number" min="0" step="0.01" placeholder="0.00"
                                value={r[`w${wk}_price`]}
                                onChange={ev => updCell(idx, `w${wk}_price`, ev.target.value)}
                                style={{ ...inp, borderColor: wp > 0 ? '#94a3b8' : '#e0e0e0' }}
                                onFocus={ev => ev.target.style.borderColor = '#3D8C40'}
                                onBlur={ev  => ev.target.style.borderColor = wp > 0 ? '#94a3b8' : '#e0e0e0'}
                              />
                              {wv > 0 && (
                                <div style={{ fontSize: 9, textAlign: 'right', color: '#3D8C40', fontWeight: 700, marginTop: 2 }}>
                                  {fmtV(wv)}
                                </div>
                              )}
                            </td>
                          </React.Fragment>
                        );
                      })}

                      {/* Row total */}
                      <td style={{ padding: '8px 12px', textAlign: 'right', verticalAlign: 'middle' }}>
                        {tot > 0
                          ? <div style={{ fontSize: 14, fontWeight: 800, color: '#1A3A1A' }}>{fmtV(tot)}</div>
                          : <div style={{ color: '#e0e0e0', fontSize: 13 }}>—</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* ── GRAND TOTAL FOOTER ── */}
              <tfoot>
                <tr style={{ background: '#0B1E10' }}>
                  <td style={{ padding: '12px 14px', color: '#F5B800', fontWeight: 800, fontSize: 13, borderRight: '1px solid rgba(255,255,255,0.06)' }}>
                    Grand Total
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 400, marginTop: 1 }}>
                      {filledCount} of {rows.length} products · incl. GST
                    </div>
                  </td>
                  {WEEKS.map(wk => {
                    const wt = weekTotal(wk);
                    return (
                      <React.Fragment key={wk}>
                        <td style={{ padding: '12px 4px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.25)' }}>
                          {/* qty col — blank */}
                        </td>
                        <td style={{ padding: '12px 6px', textAlign: 'right', fontSize: 12, fontWeight: 800, color: wt > 0 ? '#4ade80' : 'rgba(255,255,255,0.15)', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
                          {wt > 0 ? fmtV(wt) : '—'}
                        </td>
                      </React.Fragment>
                    );
                  })}
                  <td style={{ padding: '12px 12px', textAlign: 'right', fontSize: 18, fontWeight: 900, color: '#F5B800' }}>
                    {fmtV(grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Bottom save bar */}
        {!loading && grandTotal > 0 && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, background: '#fafff8' }}>
            <div style={{ fontSize: 13, color: '#555' }}>
              {filledCount} products · {fmtV(grandTotal)} total
            </div>
            <button onClick={submit} disabled={busy}
              style={{ background: '#1A3A1A', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 28px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
              {busy ? 'Saving…' : `💾 Save ${MN[month]} ${year}`}
            </button>
          </div>
        )}
      </div>

      {/* ══ PREVIOUS MONTHS HISTORY ══ */}
      {history.length > 0 && (
        <div style={{ margin: '20px 20px 0' }}>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            Previous Months
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {history.map(h => {
              const isCur = h.year === year && h.month === month;
              return (
                <button key={`${h.year}-${h.month}`}
                  onClick={() => { setYear(h.year); setMonth(h.month); }}
                  style={{
                    background: isCur ? '#F5B800' : 'rgba(255,255,255,0.1)',
                    color:      isCur ? '#0B1E10' : '#fff',
                    border: `1px solid ${isCur ? '#F5B800' : 'rgba(255,255,255,0.18)'}`,
                    borderRadius: 10, padding: '8px 16px', cursor: 'pointer', textAlign: 'left',
                  }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{MN[h.month]} {h.year}</div>
                  <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{fmtV(h.total)}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
