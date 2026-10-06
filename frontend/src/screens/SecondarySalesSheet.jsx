import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { secondaryAPI } from '../api';

// Secondary sales from the weekly stockist sheet (October 2026 onward).
// Value = weekly Sales qty x rate (sheet A-Rate, or Product Master PTS when blank).

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKS = [1, 2, 3, 4];

const inr = value => `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
const qty = value => (Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const shortInr = value => {
  const v = Number(value) || 0;
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
};

function emptyWeeks() {
  return WEEKS.reduce((acc, w) => ({ ...acc, [w]: { qty: 0, value: 0, closing: 0, closingValue: 0, hasClosing: false } }), {});
}

// Closing stock is a point-in-time figure: use the latest week that has one.
function latestClosing(weeks) {
  for (let w = 4; w >= 1; w -= 1) {
    if (weeks[w].hasClosing) return { qty: weeks[w].closing, value: weeks[w].closingValue, week: w };
  }
  return { qty: 0, value: 0, week: null };
}

function summarise(lines, groupKey, labelOf) {
  const groups = {};
  lines.forEach(line => {
    const key = groupKey(line);
    const group = groups[key] || (groups[key] = { key, label: labelOf(line), line, weeks: emptyWeeks(), items: {} });
    const week = group.weeks[line.week] || group.weeks[4];
    week.qty += Number(line.sales_qty) || 0;
    week.value += Number(line.sales_value) || 0;
    if (Number(line.closing_qty) > 0) {
      week.closing += Number(line.closing_qty) || 0;
      week.closingValue += Number(line.closing_value) || 0;
      week.hasClosing = true;
    }
    const itemKey = `${line.associate_id}|${line.stockist_key}|${line.source_product_name}`;
    const item = group.items[itemKey] || (group.items[itemKey] = { line, weeks: emptyWeeks() });
    const itemWeek = item.weeks[line.week] || item.weeks[4];
    itemWeek.qty += Number(line.sales_qty) || 0;
    itemWeek.value += Number(line.sales_value) || 0;
    if (Number(line.closing_qty) > 0) {
      itemWeek.closing += Number(line.closing_qty) || 0;
      itemWeek.closingValue += Number(line.closing_value) || 0;
      itemWeek.hasClosing = true;
    }
  });
  return Object.values(groups).map(group => {
    const items = Object.values(group.items).map(item => {
      const closing = latestClosing(item.weeks);
      return {
        ...item,
        units: WEEKS.reduce((s, w) => s + item.weeks[w].qty, 0),
        value: WEEKS.reduce((s, w) => s + item.weeks[w].value, 0),
        closing,
      };
    });
    return {
      ...group,
      items,
      units: WEEKS.reduce((s, w) => s + group.weeks[w].qty, 0),
      value: WEEKS.reduce((s, w) => s + group.weeks[w].value, 0),
      // Group closing = sum of each item's latest closing (not the sum of weeks).
      closingQty: items.reduce((s, item) => s + item.closing.qty, 0),
      closingValue: items.reduce((s, item) => s + item.closing.value, 0),
    };
  }).sort((a, b) => b.value - a.value || b.closingValue - a.closingValue);
}

const cell = { padding: '9px 11px', fontSize: 12, whiteSpace: 'nowrap' };
const num = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const head = { ...cell, fontSize: 10, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #e5e7eb' };

function WeekCells({ weeks, selectedWeek, showValue }) {
  return WEEKS.map(w => {
    const data = weeks[w];
    const active = selectedWeek === w;
    return (
      <td key={w} style={{ ...num, background: active ? '#fefce8' : undefined, color: data.qty ? '#0f172a' : '#cbd5e1' }}>
        <div style={{ fontWeight: 800 }}>{showValue ? (data.value ? inr(data.value) : '—') : (data.qty ? qty(data.qty) : '—')}</div>
        {showValue && data.qty > 0 && <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>{qty(data.qty)} units</div>}
      </td>
    );
  });
}

export default function SecondarySalesSheet({ me, year, month, stateCode, city, week, readOnly, onImported }) {
  const [data, setData] = useState({ uploads: [], lines: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('stockist');
  const [open, setOpen] = useState({});
  const inputRef = useRef(null);
  const selectedWeek = week || 0;
  const showRep = readOnly;

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = { year, month };
    if (stateCode && stateCode !== 'ALL') params.state_code = stateCode;
    if (city && city !== 'ALL') params.city = city;
    return secondaryAPI.summary(params)
      .then(response => setData(response.data || { uploads: [], lines: [] }))
      .catch(err => {
        setData({ uploads: [], lines: [] });
        setError(err?.response?.data?.detail || 'Unable to load secondary sales.');
      })
      .finally(() => setLoading(false));
  }, [year, month, stateCode, city]);

  useEffect(() => { load(); setOpen({}); }, [load]);

  const myUpload = useMemo(
    () => data.uploads.find(upload => upload.associate_id === me?.id && upload.city === city) || null,
    [data.uploads, me?.id, city]
  );

  const upload = async file => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError('Upload the stockist sheet as an Excel .xlsx file.');
      return;
    }
    if (myUpload && !window.confirm(`This replaces ${myUpload.filename} for ${city}, ${MONTHS[month]} ${year}. Continue?`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await secondaryAPI.upload(file, {
        associate_id: me.id, state_code: stateCode, city, year, month,
      });
      const result = response.data || {};
      setNotice(`${result.sheet_name || 'Sheet'} imported · ${result.stockist_count} stockists · ${inr(result.total_sales_value)} secondary sales`);
      await load();
      onImported && onImported();
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Unable to read the sheet.');
    } finally {
      setBusy(false);
    }
  };

  const download = async item => {
    const response = await secondaryAPI.download(item.id);
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = item.filename || 'secondary-sales.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  };

  const remove = async item => {
    if (!window.confirm(`Remove ${item.filename}? All ${MONTHS[month]} secondary sales for ${item.city} from this sheet will be cleared.`)) return;
    setBusy(true);
    try {
      await secondaryAPI.remove(item.id);
      setNotice(`${item.filename} removed.`);
      await load();
      onImported && onImported();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Unable to remove the sheet.');
    } finally {
      setBusy(false);
    }
  };

  const stockists = useMemo(() => summarise(
    data.lines,
    line => `${line.associate_id}|${line.stockist_key}`,
    line => line.stockist,
  ), [data.lines]);
  const products = useMemo(() => summarise(
    data.lines,
    line => (line.product_id ? `p${line.product_id}` : `s${line.source_product_name.toLowerCase()}`),
    line => line.product_name || line.source_product_name,
  ), [data.lines]);

  const totals = useMemo(() => {
    const weeks = emptyWeeks();
    stockists.forEach(group => WEEKS.forEach(w => {
      weeks[w].qty += group.weeks[w].qty;
      weeks[w].value += group.weeks[w].value;
    }));
    return {
      weeks,
      units: stockists.reduce((s, g) => s + g.units, 0),
      value: stockists.reduce((s, g) => s + g.value, 0),
      closingQty: stockists.reduce((s, g) => s + g.closingQty, 0),
      closingValue: stockists.reduce((s, g) => s + g.closingValue, 0),
      selling: stockists.filter(g => g.units > 0).length,
    };
  }, [stockists]);

  const warnings = useMemo(() => {
    const list = [];
    data.uploads.forEach(item => (item.warnings || []).forEach(text => list.push({ text, who: data.uploads.length > 1 ? `${item.associate_name} · ${item.city}` : '' })));
    return list;
  }, [data.uploads]);

  const periodValue = selectedWeek ? totals.weeks[selectedWeek].value : totals.value;
  const periodUnits = selectedWeek ? totals.weeks[selectedWeek].qty : totals.units;
  const groups = view === 'stockist' ? stockists : products;
  const noStockSales = stockists.filter(g => g.units === 0 && g.closingQty > 0);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {!readOnly && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#0f172a' }}>Stockist sheet · {city} · {MONTHS[month]} {year}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 3, maxWidth: 620 }}>
                Upload your weekly stockist sheet (.xlsx). The <b>{MONTHS[month]}</b> tab is read: every stockist, Week 1–4 Sales and Closing.
                Secondary sales = Sales units × A-Rate (Product Master PTS if the rate is blank). Each upload replaces the month.
              </div>
            </div>
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}
              style={{ padding: '10px 16px', borderRadius: 10, border: 0, background: busy ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 12, fontWeight: 900, cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Reading sheet…' : myUpload ? 'Upload updated sheet' : 'Upload sheet'}
            </button>
            <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }}
              onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }} />
          </div>
          {myUpload && (
            <div style={{ marginTop: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 11px', borderRadius: 9, background: '#f0fdfa', border: '1px solid #99f6e4' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: '#134e4a', overflow: 'hidden', textOverflow: 'ellipsis' }}>{myUpload.filename}</div>
                <div style={{ fontSize: 10, color: '#0f766e', marginTop: 2 }}>
                  Sheet “{myUpload.sheet_name}” · {myUpload.stockist_count} stockists · uploaded {myUpload.uploaded_at ? new Date(`${myUpload.uploaded_at}Z`).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => download(myUpload)} style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontSize: 10, fontWeight: 900, cursor: 'pointer' }}>Download</button>
                <button type="button" disabled={busy} onClick={() => remove(myUpload)} style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', fontSize: 10, fontWeight: 900, cursor: busy ? 'default' : 'pointer' }}>Remove</button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, padding: 12, fontSize: 13, fontWeight: 700 }}>{error}</div>}
      {notice && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 10, padding: 12, fontSize: 13, fontWeight: 700 }}>{notice}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {[
          [selectedWeek ? `Secondary sales · Week ${selectedWeek}` : `Secondary sales · ${MONTHS[month]}`, inr(periodValue), `${qty(periodUnits)} units sold`, '#0f766e'],
          ['Closing stock at stockists', inr(totals.closingValue), `${qty(totals.closingQty)} units · latest week reported`, '#1d4ed8'],
          ['Stockists', `${totals.selling} / ${stockists.length}`, 'with sales / on the sheet', '#7c3aed'],
          ['Sheets uploaded', data.uploads.length, readOnly ? 'reps in this view' : 'for this city', '#b45309'],
        ].map(([label, value, sub, color]) => (
          <div key={label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderTop: `3px solid ${color}`, borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color, marginTop: 4 }}>{value}</div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      {warnings.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: '#92400e', marginBottom: 4 }}>Check the sheet</div>
          {warnings.map((item, index) => (
            <div key={index} style={{ fontSize: 11, color: '#92400e', marginTop: 3 }}>• {item.who && <b>{item.who}: </b>}{item.text}</div>
          ))}
          {noStockSales.length > 0 && (
            <div style={{ fontSize: 11, color: '#92400e', marginTop: 3 }}>
              • Closing stock but no sales entered: {noStockSales.map(g => g.label).join(', ')}.
            </div>
          )}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '11px 13px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a' }}>
            {view === 'stockist' ? 'Secondary sales by stockist' : 'Secondary sales by product'}
            <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', marginLeft: 8 }}>value = units × rate · tap a row for detail</span>
          </div>
          <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 9, overflow: 'hidden' }}>
            {[['stockist', 'By stockist'], ['product', 'By product']].map(([key, label]) => (
              <button key={key} type="button" onClick={() => { setView(key); setOpen({}); }}
                style={{ padding: '6px 12px', border: 0, background: view === key ? '#0f766e' : '#fff', color: view === key ? '#fff' : '#475569', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ ...head, textAlign: 'left' }}>{view === 'stockist' ? 'Stockist' : 'Product'}</th>
                {showRep && view === 'stockist' && <th style={{ ...head, textAlign: 'left' }}>Rep · City</th>}
                {WEEKS.map(w => <th key={w} style={{ ...head, textAlign: 'right', background: selectedWeek === w ? '#fef9c3' : head.background }}>Week {w}</th>)}
                <th style={{ ...head, textAlign: 'right' }}>Units</th>
                <th style={{ ...head, textAlign: 'right' }}>Secondary sales</th>
                <th style={{ ...head, textAlign: 'right' }}>Closing stock</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ ...cell, textAlign: 'center', color: '#64748b', padding: 30 }}>Loading…</td></tr>
              ) : groups.length === 0 ? (
                <tr><td colSpan={9} style={{ ...cell, textAlign: 'center', color: '#64748b', padding: 30, whiteSpace: 'normal' }}>
                  {readOnly ? 'No stockist sheets uploaded for this selection yet.' : `No sheet uploaded for ${city} in ${MONTHS[month]} yet. Upload the stockist sheet above.`}
                </td></tr>
              ) : groups.map(group => {
                const expanded = Boolean(open[group.key]);
                const unmatched = view === 'product' && !group.line.product_id;
                return (
                  <React.Fragment key={group.key}>
                    <tr onClick={() => setOpen(prev => ({ ...prev, [group.key]: !prev[group.key] }))}
                      style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer', background: expanded ? '#f8fafc' : '#fff' }}>
                      <td style={{ ...cell, fontWeight: 900, color: '#0f172a' }}>
                        <span style={{ display: 'inline-block', width: 14, color: '#94a3b8' }}>{expanded ? '▾' : '▸'}</span>
                        {group.label}
                        {unmatched && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 900, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '1px 5px' }}>not in Product Master</span>}
                        {view === 'stockist' && group.units === 0 && group.closingQty > 0 && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 900, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '1px 5px' }}>stock only</span>}
                      </td>
                      {showRep && view === 'stockist' && <td style={{ ...cell, color: '#475569' }}>{group.line.associate_name} · {group.line.city}</td>}
                      <WeekCells weeks={group.weeks} selectedWeek={selectedWeek} showValue />
                      <td style={{ ...num, fontWeight: 800 }}>{qty(group.units)}</td>
                      <td style={{ ...num, fontWeight: 900, color: '#0f766e' }}>{inr(group.value)}</td>
                      <td style={{ ...num }}>
                        <div style={{ fontWeight: 800, color: '#1e3a8a' }}>{group.closingQty ? shortInr(group.closingValue) : '—'}</div>
                        {group.closingQty > 0 && <div style={{ fontSize: 10, color: '#64748b' }}>{qty(group.closingQty)} units</div>}
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={9} style={{ padding: '0 0 10px 0', background: '#f8fafc' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={{ ...head, paddingLeft: 32, textAlign: 'left', background: '#f1f5f9' }}>{view === 'stockist' ? 'Product' : 'Stockist'}</th>
                                <th style={{ ...head, textAlign: 'right', background: '#f1f5f9' }}>Rate</th>
                                {WEEKS.map(w => <th key={w} style={{ ...head, textAlign: 'right', background: selectedWeek === w ? '#fef9c3' : '#f1f5f9' }}>W{w} units</th>)}
                                <th style={{ ...head, textAlign: 'right', background: '#f1f5f9' }}>Units</th>
                                <th style={{ ...head, textAlign: 'right', background: '#f1f5f9' }}>Value</th>
                                <th style={{ ...head, textAlign: 'right', background: '#f1f5f9' }}>Closing</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.items.sort((a, b) => b.value - a.value || b.closing.qty - a.closing.qty).map((item, index) => (
                                <tr key={index} style={{ borderTop: '1px solid #e2e8f0' }}>
                                  <td style={{ ...cell, paddingLeft: 32, color: '#0f172a' }}>
                                    {view === 'stockist' ? item.line.source_product_name : item.line.stockist}
                                    {view === 'stockist' && item.line.product_name && item.line.product_name !== item.line.source_product_name && (
                                      <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 6 }}>→ {item.line.product_name}</span>
                                    )}
                                    {view === 'stockist' && !item.line.product_id && (
                                      <span style={{ fontSize: 9, color: '#c2410c', marginLeft: 6, fontWeight: 900 }}>not in Product Master</span>
                                    )}
                                    {showRep && view === 'product' && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 6 }}>{item.line.associate_name}</span>}
                                  </td>
                                  <td style={{ ...num, color: '#475569' }}>
                                    {inr(item.line.rate)}
                                    {item.line.rate_source === 'product_master' && <div style={{ fontSize: 9, color: '#94a3b8' }}>PTS (sheet blank)</div>}
                                    {item.line.rate_source === 'missing' && <div style={{ fontSize: 9, color: '#dc2626', fontWeight: 800 }}>no rate</div>}
                                  </td>
                                  <WeekCells weeks={item.weeks} selectedWeek={selectedWeek} />
                                  <td style={{ ...num, fontWeight: 800 }}>{qty(item.units)}</td>
                                  <td style={{ ...num, fontWeight: 900, color: '#0f766e' }}>{item.value ? inr(item.value) : '—'}</td>
                                  <td style={{ ...num, color: '#1e3a8a' }}>
                                    {item.closing.qty ? `${qty(item.closing.qty)}` : '—'}
                                    {item.closing.week && <div style={{ fontSize: 9, color: '#94a3b8' }}>W{item.closing.week}</div>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            {!loading && groups.length > 0 && (
              <tfoot>
                <tr style={{ background: '#ecfdf5', borderTop: '2px solid #10b981' }}>
                  <td style={{ ...cell, fontWeight: 900, color: '#065f46' }}>TOTAL</td>
                  {showRep && view === 'stockist' && <td style={cell} />}
                  <WeekCells weeks={totals.weeks} selectedWeek={selectedWeek} showValue />
                  <td style={{ ...num, fontWeight: 900, color: '#065f46' }}>{qty(totals.units)}</td>
                  <td style={{ ...num, fontWeight: 900, color: '#065f46' }}>{inr(totals.value)}</td>
                  <td style={{ ...num, fontWeight: 900, color: '#1e3a8a' }}>{shortInr(totals.closingValue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
