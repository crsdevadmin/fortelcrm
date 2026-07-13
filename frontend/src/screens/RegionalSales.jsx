import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const API  = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const MN   = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const now  = new Date();
const CUR_Y = now.getFullYear();
const CUR_M = now.getMonth() + 1;

const fmtV  = v => { const n = parseFloat(v)||0; return n>=100000?`₹${(n/100000).toFixed(1)}L`:n>=1000?`₹${(n/1000).toFixed(1)}K`:`₹${Math.round(n)}`; };
const fmtN  = v => { const n = parseFloat(v)||0; return n > 0 ? `₹${n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—'; };

// Week → representative sale_date day
const WEEK_DAY = { 1: '01', 2: '08', 3: '15', 4: '22' };
const WEEKS    = [1, 2, 3, 4];

const lbl = { fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5, display: 'block' };
const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid #ddd', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const ddStyle   = { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, maxHeight: 280, overflowY: 'auto', marginTop: 4 };
const ddItem    = { padding: '10px 14px', cursor: 'pointer', borderBottom: '0.5px solid #f5f5f5' };

export default function RegionalSales() {
  const { user: me } = useAuth();

  const [year,  setYear]  = useState(CUR_Y);
  const [month, setMonth] = useState(CUR_M);

  /* master data */
  const [doctors,  setDoctors]  = useState([]);
  const [products, setProducts] = useState([]);

  /* entry form */
  const [showForm,   setShowForm]   = useState(false);
  const [selDoctor,  setSelDoctor]  = useState(null);
  const [docQ,       setDocQ]       = useState('');
  const [docOpen,    setDocOpen]    = useState(false);
  const [prodQ,      setProdQ]      = useState('');
  const [prodOpen,   setProdOpen]   = useState(false);
  const [rows,       setRows]       = useState([]);   // {uid, product, w1,w2,w3,w4}
  const [busy,       setBusy]       = useState(false);
  const [err,        setErr]        = useState('');
  const [success,    setSuccess]    = useState('');

  /* summary / history */
  const [summary,   setSummary]   = useState(null);
  const [loadingSum, setLoadingSum] = useState(false);
  const [expanded,  setExpanded]  = useState({});

  const docRef  = useRef(null);
  const prodRef = useRef(null);

  /* outside-click */
  useEffect(() => {
    const h = e => {
      if (docRef.current  && !docRef.current.contains(e.target))  setDocOpen(false);
      if (prodRef.current && !prodRef.current.contains(e.target)) setProdOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  /* load master data */
  useEffect(() => {
    if (!me?.id) return;
    Promise.all([
      axios.get(`${API}/doctors/`, { params: { include_inactive: false } }),
      axios.get(`${API}/products/`),
    ]).then(([dr, pr]) => {
      setDoctors(dr.data  || []);
      setProducts(pr.data || []);
    }).catch(() => {});
  }, [me?.id]);

  /* load monthly summary */
  const loadSummary = (y, m) => {
    if (!me?.id) return;
    setLoadingSum(true);
    axios.get(`${API}/exports/regional-summary`, { params: { year: y, month: m, viewer_id: me.id } })
      .then(r => { setSummary(r.data); setExpanded({}); })
      .catch(() => setSummary(null))
      .finally(() => setLoadingSum(false));
  };

  useEffect(() => { loadSummary(year, month); }, [me?.id, year, month]);

  /* month nav */
  const goMonth = delta => {
    let y = year, m = month + delta;
    if (m < 1)  { m = 12; y -= 1; }
    if (m > 12) { m = 1;  y += 1; }
    setYear(y); setMonth(m);
  };

  /* doctor pick — load existing week data */
  const pickDoctor = d => {
    setSelDoctor(d); setDocQ(''); setDocOpen(false); setRows([]); setErr(''); setSuccess('');
    // Load existing weekly data for this doctor+month
    axios.get(`${API}/exports/weekly-sales`, { params: { doctor_id: d.id, year, month } })
      .then(r => {
        if (r.data.products?.length > 0) {
          setRows(r.data.products.map(p => ({
            uid: `${p.product_id}-loaded`,
            product: { id: p.product_id, name: p.product_name, gst: p.gst, rate: p.rate, mrp: p.mrp },
            w1: p.w1 > 0 ? String(p.w1) : '',
            w2: p.w2 > 0 ? String(p.w2) : '',
            w3: p.w3 > 0 ? String(p.w3) : '',
            w4: p.w4 > 0 ? String(p.w4) : '',
          })));
        }
      }).catch(() => {});
  };

  const clearDoctor = () => { setSelDoctor(null); setDocQ(''); setRows([]); setErr(''); setSuccess(''); };

  const addProduct = p => {
    setProdQ(''); setProdOpen(false);
    if (rows.find(r => r.product.id === p.id)) return;
    setRows(prev => [...prev, { uid: `${p.id}-${Date.now()}`, product: p, w1:'', w2:'', w3:'', w4:'' }]);
  };

  const updRow  = (uid, field, val) => setRows(prev => prev.map(r => r.uid === uid ? { ...r, [field]: val } : r));
  const delRow  = uid => setRows(prev => prev.filter(r => r.uid !== uid));

  const rowTotal = r => ['w1','w2','w3','w4'].reduce((s,k) => s + (parseFloat(r[k])||0), 0);
  const grandTotal = rows.reduce((s,r) => s + rowTotal(r), 0);

  const submit = async () => {
    if (!selDoctor) { setErr('Select a doctor first'); return; }
    if (rows.length === 0) { setErr('Add at least one product'); return; }
    setBusy(true); setErr('');
    try {
      // Submit one batch per week that has any data
      for (const wk of WEEKS) {
        const wKey = `w${wk}`;
        const entries = rows
          .filter(r => parseFloat(r[wKey]) > 0)
          .map(r => ({ product_id: r.product.id, quantity: 0, value: parseFloat(r[wKey]) }));
        if (entries.length === 0) continue;

        const saleDate = `${year}-${String(month).padStart(2,'0')}-${WEEK_DAY[wk]}`;
        await axios.post(`${API}/sales/submit`, {
          doctor_id:    selDoctor.id,
          associate_id: me.id,
          sale_date:    saleDate,
          entries,
        });
      }
      setSuccess(`Saved for ${selDoctor.name} — ${MN[month]} ${year}`);
      clearDoctor();
      setShowForm(false);
      loadSummary(year, month);
    } catch (e) {
      setErr(e.response?.data?.detail || 'Submit failed');
    } finally {
      setBusy(false);
    }
  };

  /* filter lists */
  const docList  = docQ.trim()
    ? doctors.filter(d => (d.name||'').toLowerCase().includes(docQ.toLowerCase()) || (d.hospital||'').toLowerCase().includes(docQ.toLowerCase())).slice(0,10)
    : doctors.slice(0,10);

  const prodList = prodQ.trim()
    ? products.filter(p => (p.name||'').toLowerCase().includes(prodQ.toLowerCase())).slice(0,12)
    : products.slice(0,12);

  const totalDocs  = summary?.doctors?.length || 0;
  const grandSumTotal = summary?.grand_total || 0;

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#0B1E10 0%,#1A3A1A 60%,#2D5A27 100%)', fontFamily: "'Inter','Segoe UI',sans-serif", paddingBottom: 40 }}>

      {/* ── Header ── */}
      <div style={{ padding: '20px 24px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ color: '#fff', fontSize: 22, fontWeight: 900, letterSpacing: -0.5 }}>Regional Sales</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 }}>Weekly sales by doctor — enter or review any month</div>
          </div>
          <button onClick={() => { setShowForm(f => !f); setSelDoctor(null); setRows([]); setErr(''); setSuccess(''); }}
            style={{ background: showForm ? 'rgba(255,255,255,0.15)' : '#F5B800', color: showForm ? '#fff' : '#0B1E10', border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
            {showForm ? '✕ Cancel' : '+ New Entry'}
          </button>
        </div>

        {/* Month nav + summary chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.12)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', overflow: 'hidden' }}>
            <button onClick={() => goMonth(-1)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, padding: '6px 12px', cursor: 'pointer' }}>‹</button>
            <span style={{ fontWeight: 700, fontSize: 13, minWidth: 80, textAlign: 'center', color: '#fff' }}>{MN[month]} {year}</span>
            <button onClick={() => goMonth(1)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, padding: '6px 12px', cursor: 'pointer', opacity: (year===CUR_Y&&month===CUR_M)?0.25:0.85 }} disabled={year===CUR_Y&&month===CUR_M}>›</button>
          </div>
          {[
            { label: 'Revenue',  value: fmtV(grandSumTotal), color: '#4ade80' },
            { label: 'Doctors',  value: totalDocs,            color: '#60a5fa' },
          ].map((c, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '6px 14px', border: '1px solid rgba(255,255,255,0.15)' }}>
              <div style={{ fontSize: 9, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{c.label}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: c.color }}>{c.value}</div>
            </div>
          ))}
        </div>

        {success && (
          <div style={{ marginTop: 12, background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: '#065f46', fontWeight: 600 }}>
            ✅ {success}
          </div>
        )}
      </div>

      <div style={{ padding: '0 24px' }}>

        {/* ══ ENTRY FORM ══════════════════════════════════════════════════════ */}
        {showForm && (
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #3D8C40', boxShadow: '0 4px 24px rgba(61,140,64,0.15)', padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#065F46', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: '#3D8C40', color: '#fff', borderRadius: 8, padding: '3px 10px', fontSize: 11 }}>ENTRY — {MN[month]} {year}</span>
              Weekly sales per doctor
            </div>

            {/* Doctor search */}
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Doctor / Pharmacy</label>
              {selDoctor ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#EAF5EA', border: '1.5px solid #3D8C40' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: '#1D5C20', fontSize: 13 }}>✓ {selDoctor.name}</span>
                      {selDoctor.expected_multiple && (
                        <span style={{ background: '#F5B800', color: '#0B1E10', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 20 }}>🎯 Target {selDoctor.expected_multiple}×</span>
                      )}
                    </div>
                    {selDoctor.hospital && <div style={{ fontSize: 12, color: '#1D5C20', marginTop: 3, fontWeight: 600 }}>🏥 {selDoctor.hospital}</div>}
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{[selDoctor.specialty||selDoctor.customer_type, selDoctor.city].filter(Boolean).join(' · ')}</div>
                    {rows.length > 0 && <div style={{ fontSize: 10, color: '#3D8C40', marginTop: 4, fontWeight: 600 }}>📋 Loaded existing data for {MN[month]} {year}</div>}
                  </div>
                  <button onClick={clearDoctor} style={{ background: 'none', border: 'none', fontSize: 16, color: '#888', cursor: 'pointer', marginTop: 2 }}>✕</button>
                </div>
              ) : (
                <div ref={docRef} style={{ position: 'relative' }}>
                  <input value={docQ} onChange={e => { setDocQ(e.target.value); setDocOpen(true); }}
                    onFocus={() => setDocOpen(true)} placeholder="Type to search…" style={inputStyle} />
                  {docOpen && docList.length > 0 && (
                    <div style={ddStyle}>
                      {docList.map(d => (
                        <div key={d.id} onClick={() => pickDoctor(d)} style={ddItem}
                          onMouseEnter={e => e.currentTarget.style.background='#f0faf0'}
                          onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                            {d.expected_multiple && <span style={{ background: '#FEF3C7', color: '#92400E', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10 }}>🎯 {d.expected_multiple}×</span>}
                          </div>
                          {d.hospital && <div style={{ fontSize: 11, color: '#3D8C40', marginTop: 1 }}>🏥 {d.hospital}</div>}
                          <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{[d.specialty||d.customer_type, d.city].filter(Boolean).join(' · ')}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Product search */}
            {selDoctor && (
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Add Product</label>
                <div ref={prodRef} style={{ position: 'relative' }}>
                  <input value={prodQ} onChange={e => { setProdQ(e.target.value); setProdOpen(true); }}
                    onFocus={() => setProdOpen(true)} placeholder={`Search ${products.length} products…`} style={inputStyle} />
                  {prodOpen && prodList.length > 0 && (
                    <div style={ddStyle}>
                      {prodList.map(p => (
                        <div key={p.id} onClick={() => addProduct(p)}
                          style={{ ...ddItem, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                          onMouseEnter={e => e.currentTarget.style.background='#f0faf0'}
                          onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                            {p.composition && <div style={{ fontSize: 10, color: '#888', marginTop: 1 }}>{p.composition}</div>}
                          </div>
                          <div style={{ textAlign: 'right', marginLeft: 12 }}>
                            {p.rate > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: '#3D8C40' }}>₹{p.rate}</div>}
                            <div style={{ fontSize: 10, color: '#aaa' }}>{p.gst || '5%'} GST</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Week grid */}
            {rows.length > 0 && (
              <div style={{ background: '#f9fafb', borderRadius: 12, border: '1px solid #e5e7eb', marginBottom: 12, overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px 90px 90px 36px', padding: '8px 14px', background: '#0B1E10', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.5, gap: 4 }}>
                  <div>Product</div>
                  <div style={{ textAlign: 'center' }}>Week 1</div>
                  <div style={{ textAlign: 'center' }}>Week 2</div>
                  <div style={{ textAlign: 'center' }}>Week 3</div>
                  <div style={{ textAlign: 'center' }}>Week 4</div>
                  <div style={{ textAlign: 'right', color: '#F5B800' }}>Total</div>
                  <div/>
                </div>

                {/* Date hints below header */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px 90px 90px 36px', padding: '3px 14px 6px', background: '#1A3A1A', fontSize: 9, color: 'rgba(255,255,255,0.35)', gap: 4 }}>
                  <div/>
                  <div style={{ textAlign: 'center' }}>1–7 {MN[month]}</div>
                  <div style={{ textAlign: 'center' }}>8–14 {MN[month]}</div>
                  <div style={{ textAlign: 'center' }}>15–21 {MN[month]}</div>
                  <div style={{ textAlign: 'center' }}>22+ {MN[month]}</div>
                  <div/>
                  <div/>
                </div>

                {rows.map((r, idx) => {
                  const tot = rowTotal(r);
                  return (
                    <div key={r.uid} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px 90px 90px 36px', alignItems: 'center', padding: '8px 14px', background: tot > 0 ? '#fafff8' : '#fff', borderTop: '1px solid #f0f0f0', gap: 4 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{r.product.name}</div>
                        {r.product.rate > 0 && <div style={{ fontSize: 10, color: '#aaa' }}>PTS ₹{r.product.rate}</div>}
                      </div>
                      {WEEKS.map(wk => (
                        <div key={wk} style={{ textAlign: 'center' }}>
                          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                            <span style={{ position: 'absolute', left: 5, fontSize: 10, color: '#bbb', pointerEvents: 'none' }}>₹</span>
                            <input type="number" min="0" step="0.01" placeholder="0"
                              value={r[`w${wk}`]}
                              onChange={ev => updRow(r.uid, `w${wk}`, ev.target.value)}
                              style={{ width: 78, padding: '5px 4px 5px 14px', border: '1px solid #ddd', borderRadius: 7, fontSize: 12, textAlign: 'right', outline: 'none' }}
                              onFocus={ev => ev.target.style.borderColor='#3D8C40'}
                              onBlur={ev  => ev.target.style.borderColor='#ddd'}
                            />
                          </div>
                        </div>
                      ))}
                      {/* Total */}
                      <div style={{ textAlign: 'right' }}>
                        {tot > 0
                          ? <div style={{ fontSize: 13, fontWeight: 700, color: '#0B1E10' }}>{fmtN(tot)}</div>
                          : <div style={{ fontSize: 13, color: '#ddd' }}>—</div>}
                      </div>
                      {/* Delete */}
                      <div style={{ textAlign: 'center' }}>
                        <button onClick={() => delRow(r.uid)}
                          style={{ background: '#fee2e2', border: 'none', cursor: 'pointer', fontSize: 11, color: '#DC2626', padding: '4px 7px', borderRadius: 6, fontWeight: 700 }}
                          onMouseEnter={ev => { ev.currentTarget.style.background='#DC2626'; ev.currentTarget.style.color='#fff'; }}
                          onMouseLeave={ev => { ev.currentTarget.style.background='#fee2e2'; ev.currentTarget.style.color='#DC2626'; }}>✕</button>
                      </div>
                    </div>
                  );
                })}

                {/* Grand total row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px 90px 90px 36px', padding: '10px 14px', background: '#0B1E10', borderRadius: '0 0 12px 12px', fontWeight: 700, fontSize: 13, color: '#fff', alignItems: 'center', gap: 4 }}>
                  <div style={{ color: '#F5B800', fontSize: 12 }}>
                    Grand Total
                    <div style={{ fontSize: 10, fontWeight: 400, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>{rows.length} product{rows.length !== 1 ? 's' : ''}</div>
                  </div>
                  {WEEKS.map(wk => {
                    const wkTotal = rows.reduce((s,r) => s + (parseFloat(r[`w${wk}`])||0), 0);
                    return (
                      <div key={wk} style={{ textAlign: 'center', fontSize: 12, color: wkTotal > 0 ? '#4ade80' : 'rgba(255,255,255,0.2)' }}>
                        {wkTotal > 0 ? fmtV(wkTotal) : '—'}
                      </div>
                    );
                  })}
                  <div style={{ textAlign: 'right', color: '#F5B800', fontSize: 15 }}>{fmtV(grandTotal)}</div>
                  <div/>
                </div>
              </div>
            )}

            {err && <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 9, padding: '9px 14px', fontSize: 13, color: '#DC2626', marginBottom: 10 }}>{err}</div>}

            {selDoctor && rows.length > 0 && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={submit} disabled={busy}
                  style={{ background: grandTotal > 0 ? '#3D8C40' : '#e5e7eb', color: grandTotal > 0 ? '#fff' : '#aaa', border: 'none', borderRadius: 10, padding: '11px 24px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                  {busy ? 'Saving…' : `✅ Submit — ${fmtV(grandTotal)}`}
                </button>
                <button onClick={() => setRows([])} style={{ background: 'none', color: '#aaa', border: '1px solid #ddd', borderRadius: 10, padding: '10px 16px', fontSize: 13, cursor: 'pointer' }}>Clear</button>
                <div style={{ fontSize: 12, color: '#bbb' }}>{rows.length} products · {selDoctor.name} · {MN[month]} {year}</div>
              </div>
            )}
          </div>
        )}

        {/* ══ MONTHLY SUMMARY ═════════════════════════════════════════════════ */}
        {loadingSum && <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.4)' }}>Loading…</div>}

        {!loadingSum && (!summary || summary.doctors?.length === 0) && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'rgba(255,255,255,0.4)' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>No entries for {MN[month]} {year}</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Click "+ New Entry" to record weekly sales</div>
          </div>
        )}

        {!loadingSum && summary?.doctors?.map(doc => {
          const open = !!expanded[doc.doctor_id];
          return (
            <div key={doc.doctor_id} style={{ background: '#fff', borderRadius: 14, border: '0.5px solid rgba(255,255,255,0.1)', marginBottom: 10, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>

              {/* Doctor row */}
              <div onClick={() => setExpanded(p => ({ ...p, [doc.doctor_id]: !p[doc.doctor_id] }))}
                style={{ display: 'flex', alignItems: 'center', padding: '12px 18px', cursor: 'pointer', background: open ? '#f9fafb' : '#fff', userSelect: 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{doc.doctor_name}</div>
                  {(doc.hospital || doc.city) && (
                    <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{[doc.hospital, doc.city].filter(Boolean).join(' · ')}</div>
                  )}
                </div>

                {/* Week chips */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginRight: 14 }}>
                  {WEEKS.map(wk => {
                    const val = doc[`w${wk}`];
                    return (
                      <div key={wk} style={{ textAlign: 'center', background: val > 0 ? '#EAF5EA' : '#f3f4f6', borderRadius: 7, padding: '3px 8px', minWidth: 48 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: val > 0 ? '#1D5C20' : '#ccc' }}>{val > 0 ? fmtV(val) : '—'}</div>
                        <div style={{ fontSize: 9, color: '#aaa' }}>W{wk}</div>
                      </div>
                    );
                  })}
                  <div style={{ background: '#0B1E10', borderRadius: 8, padding: '4px 10px', marginLeft: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#F5B800' }}>{fmtV(doc.total)}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>Total</div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: '#ccc' }}>{open ? '▲' : '▼'}</div>
              </div>

              {/* Expanded: edit button */}
              {open && (
                <div style={{ borderTop: '1px solid #f0f0f0', padding: '12px 18px', background: '#fafff8', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 12, color: '#555', flex: 1 }}>
                    <span style={{ color: '#3D8C40', fontWeight: 700 }}>W1:</span> {fmtN(doc.w1)} &nbsp;
                    <span style={{ color: '#3D8C40', fontWeight: 700 }}>W2:</span> {fmtN(doc.w2)} &nbsp;
                    <span style={{ color: '#3D8C40', fontWeight: 700 }}>W3:</span> {fmtN(doc.w3)} &nbsp;
                    <span style={{ color: '#3D8C40', fontWeight: 700 }}>W4:</span> {fmtN(doc.w4)}
                  </div>
                  <button onClick={() => { setShowForm(true); pickDoctor(doctors.find(d => d.id === doc.doctor_id) || { id: doc.doctor_id, name: doc.doctor_name, hospital: doc.hospital, city: doc.city }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    style={{ background: '#EAF5EA', color: '#1D5C20', border: '1px solid #3D8C40', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    ✏️ Edit
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
