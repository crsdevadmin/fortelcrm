import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { salesAPI } from '../api';
import { useAuth } from '../context/AuthContext';

const API = 'http://localhost:8000';
const MN  = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const now = new Date();
const CUR_Y = now.getFullYear();
const CUR_M = now.getMonth() + 1;

const today   = () => new Date().toISOString().split('T')[0];
const fmtD    = s => { if (!s) return ''; const [y,m,d]=s.split('-'); return `${+d} ${MN[+m]} ${y}`; };
const fmtV    = v => { const n=parseFloat(v)||0; return n>=100000?`₹${(n/100000).toFixed(1)}L`:n>=1000?`₹${(n/1000).toFixed(1)}K`:`₹${Math.round(n)}`; };
const dayName = s => { if (!s) return ''; return new Date(s).toLocaleDateString('en-IN',{weekday:'short'}); };

export default function SalesScreen() {
  const { user: me } = useAuth();

  /* ── master data ── */
  const [doctors,  setDoctors]  = useState([]);
  const [products, setProducts] = useState([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  /* ── entry form state ── */
  const [showForm,  setShowForm]  = useState(false);
  const [saleDate,  setSaleDate]  = useState(today());
  const [selDoctor, setSelDoctor] = useState(null);
  const [docQ,      setDocQ]      = useState('');
  const [docOpen,   setDocOpen]   = useState(false);
  const [prodQ,     setProdQ]     = useState('');
  const [prodOpen,  setProdOpen]  = useState(false);
  const [entries,   setEntries]   = useState([]);
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState('');

  /* ── history state ── */
  const [year,     setYear]     = useState(CUR_Y);
  const [month,    setMonth]    = useState(CUR_M);
  const [histData, setHistData] = useState([]);
  const [histLoad, setHistLoad] = useState(false);
  const [expanded, setExpanded] = useState({});

  /* ── outside-click refs ── */
  const docRef  = useRef(null);
  const prodRef = useRef(null);

  /* close dropdowns on outside click */
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
      setLoadingMaster(false);
    }).catch(() => setLoadingMaster(false));
  }, [me?.id]);

  /* load history */
  const loadHistory = (y, m) => {
    if (!me?.id) return;
    setHistLoad(true);
    axios.get(`${API}/sales/my-sales`, { params: { associate_id: me.id, year: y, month: m } })
      .then(r => {
        const d = r.data || [];
        setHistData(d);
        if (d.length > 0) setExpanded({ [d[0].date]: true });
        setHistLoad(false);
      }).catch(() => setHistLoad(false));
  };

  useEffect(() => { loadHistory(year, month); }, [me?.id, year, month]);

  const goMonth = delta => {
    let y = year, m = month + delta;
    if (m < 1)  { m = 12; y -= 1; }
    if (m > 12) { m = 1;  y += 1; }
    if (y > CUR_Y || (y === CUR_Y && m > CUR_M)) return;
    setYear(y); setMonth(m);
  };

  const toggleDay = date => setExpanded(prev => ({ ...prev, [date]: !prev[date] }));

  /* ── form helpers ── */
  const docList = docQ.trim()
    ? doctors.filter(d =>
        (d.name||'').toLowerCase().includes(docQ.toLowerCase()) ||
        (d.hospital||'').toLowerCase().includes(docQ.toLowerCase()) ||
        (d.city||'').toLowerCase().includes(docQ.toLowerCase())
      ).slice(0, 10)
    : doctors.slice(0, 10);

  const prodList = prodQ.trim()
    ? products.filter(p => (p.name||'').toLowerCase().includes(prodQ.toLowerCase())).slice(0, 12)
    : products.slice(0, 12);

  const pickDoctor = d => { setSelDoctor(d); setDocQ(''); setDocOpen(false); setEntries([]); setErr(''); };
  const clearDoctor = () => { setSelDoctor(null); setDocQ(''); setDocOpen(false); setEntries([]); setErr(''); };

  const addProduct = p => {
    setProdQ(''); setProdOpen(false);
    if (entries.find(e => e.product.id === p.id)) {
      document.getElementById(`qty-${p.id}`)?.focus(); return;
    }
    setEntries(prev => [...prev, { uid: `${p.id}-${Date.now()}`, product: p, qty: '', value: p.rate > 0 ? String(p.rate) : '' }]);
    setTimeout(() => document.getElementById(`qty-${p.id}`)?.focus(), 60);
  };

  const updEntry = (uid, f, v) => setEntries(prev => prev.map(e => e.uid === uid ? { ...e, [f]: v } : e));
  const delEntry = uid => setEntries(prev => prev.filter(e => e.uid !== uid));

  const grandTotal = entries.reduce((s,e) => s + (parseFloat(e.value)||0), 0);
  const grandQty   = entries.reduce((s,e) => s + (parseFloat(e.qty)||0),   0);

  const resetForm = () => {
    clearDoctor(); setEntries([]); setProdQ(''); setErr(''); setShowForm(false);
  };

  const submit = async () => {
    if (!selDoctor)    { setErr('Select a doctor first.'); return; }
    if (!entries.length){ setErr('Add at least one product.'); return; }
    const rows = entries.filter(e => (parseFloat(e.value)||0) > 0);
    if (!rows.length)  { setErr('Enter a value for at least one product.'); return; }
    setErr(''); setBusy(true);
    try {
      await salesAPI.submit({
        doctor_id:    selDoctor.id,
        associate_id: me?.id,
        sale_date:    saleDate,
        entries: rows.map(e => ({ product_id: e.product.id, quantity: parseFloat(e.qty)||0, value: parseFloat(e.value)||0 })),
        remarks: '',
      });
      resetForm();
      // Refresh history if the submitted date is in the current viewed month
      const [sy, sm] = saleDate.split('-').map(Number);
      if (sy === year && sm === month) loadHistory(year, month);
    } catch (e) {
      setErr(e.response?.data?.detail || 'Submit failed — try again.');
    } finally {
      setBusy(false);
    }
  };

  /* ── summary ── */
  const grandHistTotal = histData.reduce((s,d) => s + d.day_total, 0);
  const totalDocs      = histData.reduce((s,d) => s + d.doctors.length, 0);
  const totalVisits    = histData.length;

  if (loadingMaster) return <div style={{ padding: 60, textAlign: 'center', color: '#aaa' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 900, padding: '0 0 40px' }}>

      {/* ══ HERO STRIP ══════════════════════════════════════════════════════ */}
      <div style={{
        background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
        borderRadius: '0 0 20px 20px', padding: '20px 24px 24px', color: '#fff', marginBottom: 20,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 130, height: 130, borderRadius: '50%', background: 'rgba(61,140,64,0.15)', pointerEvents: 'none' }} />

        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>📋 My Sales</div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>Record visits · Track revenue · View history</div>
          </div>
          <button
            onClick={() => { setShowForm(f => !f); setErr(''); }}
            style={{
              background: showForm ? 'rgba(255,255,255,0.15)' : '#F5B800',
              color: showForm ? '#fff' : '#1A1A1A',
              border: 'none', borderRadius: 12, padding: '10px 20px',
              fontSize: 13, fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s',
            }}>
            {showForm ? '✕ Cancel' : '+ Add Entry'}
          </button>
        </div>

        {/* Month nav + summary chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.12)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', overflow: 'hidden' }}>
            <button onClick={() => goMonth(-1)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, padding: '6px 12px', cursor: 'pointer', opacity: 0.85 }}>‹</button>
            <span style={{ fontWeight: 700, fontSize: 13, minWidth: 80, textAlign: 'center' }}>{MN[month]} {year}</span>
            <button onClick={() => goMonth(1)} disabled={year === CUR_Y && month === CUR_M}
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, padding: '6px 12px', cursor: 'pointer', opacity: (year === CUR_Y && month === CUR_M) ? 0.2 : 0.85 }}>›</button>
          </div>
          {histData.length > 0 && [
            { label: 'Revenue',    value: fmtV(grandHistTotal), color: '#4ade80' },
            { label: 'Visit Days', value: totalVisits,           color: '#facc15' },
            { label: 'Doctors',    value: totalDocs,             color: '#60a5fa' },
          ].map((s, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '6px 14px', border: '1px solid rgba(255,255,255,0.15)' }}>
              <div style={{ fontSize: 9, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 24px' }}>

        {/* ══ ENTRY FORM (slide-down) ════════════════════════════════════════ */}
        {showForm && (
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #3D8C40', boxShadow: '0 4px 24px #3D8C4022', padding: '20px', marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#065F46', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: '#3D8C40', color: '#fff', borderRadius: 8, padding: '3px 10px', fontSize: 11 }}>NEW ENTRY</span>
              Record a visit and products sold
            </div>

            {/* Date + Doctor row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 16, marginBottom: 16, alignItems: 'start' }}>
              <div>
                <label style={lbl}>Date</label>
                <input type="date" value={saleDate} max={today()}
                  onChange={e => setSaleDate(e.target.value)}
                  style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid #ddd', fontSize: 13, outline: 'none' }} />
              </div>
              <div>
                <label style={lbl}>Doctor / Pharmacy ({doctors.length} available)</label>
                {selDoctor ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#EAF5EA', border: '1.5px solid #3D8C40' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: '#1D5C20', fontSize: 13 }}>✓ {selDoctor.name}</div>
                      <div style={{ fontSize: 11, color: '#555', marginTop: 1 }}>
                        {[selDoctor.specialty||selDoctor.customer_type, selDoctor.hospital, selDoctor.city].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <button onClick={clearDoctor} style={{ background: 'none', border: 'none', fontSize: 16, color: '#888', cursor: 'pointer' }}>✕</button>
                  </div>
                ) : (
                  <div ref={docRef} style={{ position: 'relative' }}>
                    <input value={docQ}
                      onChange={e => { setDocQ(e.target.value); setDocOpen(true); }}
                      onFocus={() => setDocOpen(true)}
                      placeholder="Type to search…"
                      style={inputStyle} />
                    {docOpen && docList.length > 0 && (
                      <div style={ddStyle}>
                        {docList.map(d => (
                          <div key={d.id} onClick={() => pickDoctor(d)} style={ddItem}
                            onMouseEnter={e => e.currentTarget.style.background='#f0faf0'}
                            onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</div>
                            <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{[d.specialty||d.customer_type,d.hospital,d.city].filter(Boolean).join(' · ')}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {docOpen && docQ && docList.length === 0 && (
                      <div style={{ ...ddStyle, padding: '12px 14px', fontSize: 12, color: '#aaa' }}>No match for "{docQ}"</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Product search */}
            {selDoctor && (
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Add Product</label>
                <div ref={prodRef} style={{ position: 'relative' }}>
                  <input value={prodQ}
                    onChange={e => { setProdQ(e.target.value); setProdOpen(true); }}
                    onFocus={() => setProdOpen(true)}
                    placeholder={`Browse ${products.length} products…`}
                    style={inputStyle} />
                  {prodOpen && prodList.length > 0 && (
                    <div style={ddStyle}>
                      {prodList.map(p => (
                        <div key={p.id} onClick={() => addProduct(p)}
                          style={{ ...ddItem, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                          onMouseEnter={e => e.currentTarget.style.background='#f0faf0'}
                          onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                            {p.pack_size && <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{p.pack_size}</div>}
                          </div>
                          {p.rate > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: '#3D8C40', marginLeft: 12 }}>₹{p.rate}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {prodOpen && prodQ && prodList.length === 0 && (
                    <div style={{ ...ddStyle, padding: '12px 14px', fontSize: 12, color: '#aaa' }}>No match for "{prodQ}"</div>
                  )}
                </div>
              </div>
            )}

            {/* Products table */}
            {entries.length > 0 && (
              <div style={{ background: '#f9fafb', borderRadius: 12, border: '1px solid #e5e7eb', marginBottom: 12, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 36px', padding: '7px 16px', background: '#f0f0f0', fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  <div>Product</div><div style={{textAlign:'center'}}>Qty</div><div style={{textAlign:'right'}}>Value ₹</div><div/>
                </div>
                {entries.map((e, idx) => {
                  const ok = (parseFloat(e.value)||0) > 0;
                  return (
                    <div key={e.uid} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 36px', alignItems: 'center', padding: '9px 16px', background: ok ? '#fafff8' : '#fff', borderTop: idx > 0 ? '1px solid #f0f0f0' : 'none' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{e.product.name}</div>
                        {e.product.pack_size && <div style={{ fontSize: 10, color: '#bbb' }}>{e.product.pack_size}</div>}
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <input id={`qty-${e.product.id}`} type="number" min="0" placeholder="0" value={e.qty}
                          onChange={ev => updEntry(e.uid,'qty',ev.target.value)}
                          style={{ width: 54, padding: '5px 4px', border: '1px solid #ddd', borderRadius: 7, fontSize: 12, textAlign: 'center', outline: 'none' }}
                          onFocus={ev => ev.target.style.borderColor='#3D8C40'}
                          onBlur={ev  => ev.target.style.borderColor='#ddd'} />
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                          <span style={{ position: 'absolute', left: 7, fontSize: 11, color: '#aaa' }}>₹</span>
                          <input type="number" min="0" placeholder="0.00" value={e.value}
                            onChange={ev => updEntry(e.uid,'value',ev.target.value)}
                            style={{ width: 90, padding: '5px 5px 5px 18px', border: `1px solid ${ok?'#3D8C40':'#ddd'}`, borderRadius: 7, fontSize: 12, textAlign: 'right', outline: 'none', background: ok?'#f0faf0':'#fafafa' }}
                            onFocus={ev => ev.target.style.borderColor='#3D8C40'}
                            onBlur={ev  => ev.target.style.borderColor=ok?'#3D8C40':'#ddd'} />
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <button onClick={() => delEntry(e.uid)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#ddd', padding: '3px 4px' }}
                          onMouseEnter={ev => ev.currentTarget.style.color='#DC2626'}
                          onMouseLeave={ev => ev.currentTarget.style.color='#ddd'}>✕</button>
                      </div>
                    </div>
                  );
                })}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 36px', padding: '10px 16px', background: '#1A1A1A', borderRadius: '0 0 12px 12px', fontWeight: 700, fontSize: 13, color: '#fff', alignItems: 'center' }}>
                  <div style={{ color: '#F5B800' }}>Grand Total</div>
                  <div style={{ textAlign: 'center', fontSize: 11, color: '#888' }}>{grandQty > 0 ? `${grandQty} units` : '—'}</div>
                  <div style={{ textAlign: 'right', color: '#F5B800', fontSize: 15 }}>{fmtV(grandTotal)}</div>
                  <div />
                </div>
              </div>
            )}

            {/* Error */}
            {err && <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 9, padding: '9px 14px', fontSize: 13, color: '#DC2626', marginBottom: 10 }}>{err}</div>}

            {/* Actions */}
            {selDoctor && entries.length > 0 && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={submit} disabled={busy}
                  style={{ background: grandTotal > 0 ? '#3D8C40' : '#e5e7eb', color: grandTotal > 0 ? '#fff' : '#aaa', border: 'none', borderRadius: 10, padding: '11px 24px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                  {busy ? 'Saving…' : `✅ Submit — ${fmtV(grandTotal)}`}
                </button>
                <button onClick={() => setEntries([])}
                  style={{ background: 'none', color: '#aaa', border: '1px solid #ddd', borderRadius: 10, padding: '10px 16px', fontSize: 13, cursor: 'pointer' }}>
                  Clear
                </button>
                <div style={{ fontSize: 12, color: '#bbb' }}>{entries.length} product{entries.length!==1?'s':''} · {fmtD(saleDate)} · {selDoctor.name}</div>
              </div>
            )}
          </div>
        )}

        {/* ══ HISTORY ═══════════════════════════════════════════════════════ */}
        {histLoad && <div style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>Loading…</div>}

        {!histLoad && histData.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#bbb' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>No entries for {MN[month]} {year}</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Click "+ Add Entry" above to record a visit</div>
          </div>
        )}

        {!histLoad && histData.map(day => {
          const open = !!expanded[day.date];
          return (
            <div key={day.date} style={{ background: '#fff', borderRadius: 14, border: '0.5px solid #e5e7eb', marginBottom: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>

              {/* Day header */}
              <div onClick={() => toggleDay(day.date)}
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
                  <div style={{ fontSize: 13, color: '#ccc' }}>{open ? '▲' : '▼'}</div>
                </div>
              </div>

              {/* Expanded */}
              {open && day.doctors.map((doc) => (
                <div key={doc.doctor_id} style={{ borderTop: '0.5px solid #f0f0f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px 6px', background: '#fafff8' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{doc.doctor_name}</div>
                      {(doc.hospital || doc.city) && (
                        <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{[doc.hospital,doc.city].filter(Boolean).join(', ')}</div>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#3D8C40' }}>{fmtV(doc.total)}</div>
                  </div>
                  {doc.products.map((p, pi) => (
                    <div key={p.entry_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 18px 6px 32px', borderTop: '0.5px solid #f5f5f5', background: pi % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <div style={{ fontSize: 12, color: '#555' }}>· {p.product_name}</div>
                      <div style={{ fontSize: 12, color: '#777', display: 'flex', gap: 12, alignItems: 'center' }}>
                        {p.quantity > 0 && <span style={{ color: '#aaa' }}>{p.quantity} qty</span>}
                        <span style={{ fontWeight: 700, color: '#1A1A1A' }}>₹{p.value.toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  ))}
                  {doc.products.length > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '5px 18px', background: '#f0faf0', borderTop: '0.5px solid #e0f0e0' }}>
                      <span style={{ fontSize: 11, color: '#3D8C40', fontWeight: 700 }}>{doc.products.length} products · {fmtV(doc.total)}</span>
                    </div>
                  )}
                </div>
              ))}

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
    </div>
  );
}

/* ── styles ── */
const lbl      = { display: 'block', fontSize: 10, color: '#999', fontWeight: 700, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 };
const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: 9, border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box', outline: 'none' };
const ddStyle  = { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999, background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.13)', marginTop: 4, maxHeight: 260, overflowY: 'auto' };
const ddItem   = { padding: '10px 14px', cursor: 'pointer', borderBottom: '0.5px solid #f5f5f5' };
