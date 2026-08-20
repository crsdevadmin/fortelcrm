import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { primarySalesAPI } from '../api';
import { useAuth } from '../context/AuthContext';


const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TERRITORIES = {
  'Tamil Nadu': ['Chennai', 'Madurai', 'Coimbatore 1', 'Coimbatore 2'],
  Telangana: ['Hyderabad'],
  Kerala: ['Cochin'],
};

function money(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function fullMoney(value) {
  return `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
}

function MetricCard({ label, value, note, color }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${color}30`, borderRadius: 14, padding: '14px 16px', boxShadow: '0 2px 10px rgba(15,23,42,0.04)' }}>
      <div style={{ color: '#64748b', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7 }}>{label}</div>
      <div style={{ color, fontSize: 24, fontWeight: 900, marginTop: 5 }}>{value}</div>
      <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 3 }}>{note}</div>
    </div>
  );
}

const fieldStyle = {
  border: '1px solid #dbe2ea', borderRadius: 9, padding: '8px 10px', background: '#fff',
  fontSize: 12, color: '#172033', minHeight: 36,
};

export default function PrimarySales() {
  const { user } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [region, setRegion] = useState('ALL');
  const [territory, setTerritory] = useState('ALL');
  const [stockistId, setStockistId] = useState('');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [mappingDrafts, setMappingDrafts] = useState({});
  const fileRef = useRef(null);
  const canUpload = ['admin', 'md', 'back_office'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await primarySalesAPI.summary({
        year, month,
        region: region === 'ALL' ? undefined : region,
        territory: territory === 'ALL' ? undefined : territory,
        stockist_id: stockistId || undefined,
      });
      setSummary(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to load primary sales');
    } finally {
      setLoading(false);
    }
  }, [year, month, region, territory, stockistId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!summary?.unassigned_stockists) return;
    setMappingDrafts(current => {
      const next = { ...current };
      summary.unassigned_stockists.forEach(row => {
        next[row.id] = next[row.id] || {
          region: row.region === 'Unassigned' ? 'Tamil Nadu' : row.region,
          territory: row.territory === 'Unassigned' ? '' : row.territory,
        };
      });
      return next;
    });
  }, [summary?.unassigned_stockists]);

  const stockistOptions = useMemo(() => (summary?.options?.stockists || []).filter(row =>
    (region === 'ALL' || row.region === region) &&
    (territory === 'ALL' || row.territory === territory)
  ), [summary, region, territory]);

  const goMonth = delta => {
    let nextYear = year;
    let nextMonth = month + delta;
    if (nextMonth < 1) { nextMonth = 12; nextYear -= 1; }
    if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
    setYear(nextYear);
    setMonth(nextMonth);
  };

  const upload = async event => {
    event.preventDefault();
    if (!selectedFile) { setError('Select the primary-sales Excel file first'); return; }
    setUploading(true);
    setUploadProgress(null);
    setError('');
    setSuccess('');
    try {
      const response = await primarySalesAPI.upload(selectedFile, (completed, total) => setUploadProgress({ completed, total }));
      const result = response.data;
      setSuccess(result.status === 'duplicate'
        ? result.message
        : `${result.message}. Net Amount: ${fullMoney(result.upload?.total_net_amount)}`);
      const periodEnd = result.upload?.period_end;
      if (periodEnd) {
        setYear(Number(periodEnd.slice(0, 4)));
        setMonth(Number(periodEnd.slice(5, 7)));
      }
      await load();
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err.response?.data?.detail || 'Excel upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const saveMapping = async row => {
    const draft = mappingDrafts[row.id];
    if (!draft?.region || !draft?.territory) { setError(`Select a territory for ${row.name}`); return; }
    setError('');
    try {
      await primarySalesAPI.updateStockist(row.id, draft);
      setSuccess(`${row.name} assigned to ${draft.territory}, ${draft.region}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to update stockist territory');
    }
  };

  const maxStockist = Math.max(...(summary?.by_stockist || []).map(row => Number(row.net_amount) || 0), 1);

  return (
    <div style={{ minHeight: '100vh', background: '#f6f8fb', paddingBottom: 36 }}>
      <div style={{ background: 'linear-gradient(135deg,#102a43,#174e63 58%,#0f766e)', color: '#fff', padding: '19px 24px 22px', borderRadius: '0 0 20px 20px', boxShadow: '0 8px 28px rgba(15,42,67,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 21, fontWeight: 900 }}>Primary Sales</div>
            <div style={{ fontSize: 11, opacity: 0.72, marginTop: 3 }}>Company invoices to stockists · calculated from the Excel Net Amount column</div>
          </div>
          <span style={{ background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, padding: '6px 11px', fontSize: 10, fontWeight: 800 }}>No approval required</span>
        </div>
      </div>

      <div style={{ padding: '16px 24px 0' }}>
        {canUpload && (
          <form onSubmit={upload} style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 14, padding: 15, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 280px' }}>
              <div style={{ fontWeight: 900, fontSize: 13, color: '#172033' }}>Upload company sales Excel</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>.xls or .xlsx · cumulative reports are refreshed without double-counting</div>
            </div>
            <input ref={fileRef} type="file" accept=".xls,.xlsx" onChange={event => setSelectedFile(event.target.files?.[0] || null)} style={{ ...fieldStyle, flex: '1 1 230px' }} />
            <button type="submit" disabled={uploading} style={{ border: 'none', borderRadius: 10, padding: '10px 18px', background: uploading ? '#94a3b8' : '#0f766e', color: '#fff', fontWeight: 900, cursor: uploading ? 'wait' : 'pointer' }}>
              {uploading
                ? uploadProgress?.total
                  ? `Uploading ${uploadProgress.completed}/${uploadProgress.total}…`
                  : 'Preparing…'
                : 'Upload Excel'}
            </button>
          </form>
        )}

        {error && <div style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '10px 13px', borderRadius: 10, marginBottom: 12, fontSize: 12, fontWeight: 700 }}>{error}</div>}
        {success && <div style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '10px 13px', borderRadius: 10, marginBottom: 12, fontSize: 12, fontWeight: 700 }}>{success}</div>}

        {canUpload && (summary?.unassigned_stockists || []).length > 0 && (
          <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 13, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: '#92400e' }}>Territory mapping required</div>
            <div style={{ fontSize: 10, color: '#a16207', margin: '3px 0 10px' }}>Sales are visible under “Unassigned” until the stockist is mapped.</div>
            {(summary.unassigned_stockists || []).map(row => {
              const draft = mappingDrafts[row.id] || { region: 'Tamil Nadu', territory: '' };
              return (
                <div key={row.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(190px,1fr) 150px 170px auto', gap: 8, alignItems: 'center', marginTop: 7 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#422006' }}>{row.name}</div>
                  <select value={draft.region} onChange={event => setMappingDrafts(current => ({ ...current, [row.id]: { region: event.target.value, territory: '' } }))} style={fieldStyle}>
                    {Object.keys(TERRITORIES).map(value => <option key={value}>{value}</option>)}
                  </select>
                  <select value={draft.territory} onChange={event => setMappingDrafts(current => ({ ...current, [row.id]: { ...draft, territory: event.target.value } }))} style={fieldStyle}>
                    <option value="">Select territory</option>
                    {(TERRITORIES[draft.region] || []).map(value => <option key={value}>{value}</option>)}
                  </select>
                  <button type="button" onClick={() => saveMapping(row)} style={{ border: 'none', borderRadius: 9, padding: '9px 13px', background: '#d97706', color: '#fff', fontWeight: 900, cursor: 'pointer' }}>Save</button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => goMonth(-1)} style={{ ...fieldStyle, cursor: 'pointer', fontWeight: 900 }}>‹</button>
          <select value={month} onChange={event => setMonth(Number(event.target.value))} style={fieldStyle}>
            {MONTHS.slice(1).map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
          </select>
          <select value={year} onChange={event => setYear(Number(event.target.value))} style={fieldStyle}>
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(value => <option key={value}>{value}</option>)}
          </select>
          <button onClick={() => goMonth(1)} style={{ ...fieldStyle, cursor: 'pointer', fontWeight: 900 }}>›</button>
          <select value={region} onChange={event => { setRegion(event.target.value); setTerritory('ALL'); setStockistId(''); }} style={{ ...fieldStyle, minWidth: 150 }}>
            <option value="ALL">All regions</option>
            {(summary?.options?.regions || []).map(value => <option key={value}>{value}</option>)}
          </select>
          <select value={territory} onChange={event => { setTerritory(event.target.value); setStockistId(''); }} style={{ ...fieldStyle, minWidth: 150 }}>
            <option value="ALL">All territories</option>
            {(summary?.options?.territories || []).filter(value => region === 'ALL' || (summary?.options?.stockists || []).some(row => row.region === region && row.territory === value)).map(value => <option key={value}>{value}</option>)}
          </select>
          <select value={stockistId} onChange={event => setStockistId(event.target.value)} style={{ ...fieldStyle, minWidth: 210, flex: '1 1 210px' }}>
            <option value="">All stockists</option>
            {stockistOptions.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 14 }}>
          <MetricCard label="Primary sales" value={money(summary?.total_net_amount)} note={`${MONTHS[month]} ${year} · Net Amount`} color="#0f766e" />
          <MetricCard label="Stockists" value={summary?.stockist_count || 0} note="with sales in selection" color="#2563eb" />
          <MetricCard label="Invoices" value={summary?.bill_count || 0} note={`${summary?.line_count || 0} product lines`} color="#7c3aed" />
          <MetricCard label="Quantity" value={Number(summary?.total_quantity || 0).toLocaleString('en-IN')} note="total billed units" color="#d97706" />
        </div>

        {loading ? (
          <div style={{ padding: 50, textAlign: 'center', color: '#64748b' }}>Loading primary sales…</div>
        ) : (summary?.by_stockist || []).length === 0 ? (
          <div style={{ background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 14, padding: 45, textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>▦</div>
            <div style={{ fontWeight: 900, color: '#334155' }}>No primary sales for {MONTHS[month]} {year}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>{canUpload ? 'Upload the company Excel report above.' : 'The back-office team has not uploaded this period yet.'}</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(300px,0.8fr)', gap: 14, marginBottom: 14 }}>
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ padding: '13px 15px', borderBottom: '1px solid #eef2f7' }}>
                  <div style={{ fontSize: 13, fontWeight: 900 }}>Sales by stockist</div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Region → territory → distributor</div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead><tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left' }}>
                      {['Stockist', 'Region / territory', 'Bills', 'Qty', 'Net Amount'].map(label => <th key={label} style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{label}</th>)}
                    </tr></thead>
                    <tbody>{summary.by_stockist.map(row => (
                      <tr key={row.stockist_id} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 12px', minWidth: 190 }}>
                          <div style={{ fontWeight: 900, color: '#172033' }}>{row.stockist_name}</div>
                          <div style={{ height: 4, background: '#ecfdf5', borderRadius: 4, marginTop: 6 }}><div style={{ height: '100%', width: `${Math.max(2, (row.net_amount / maxStockist) * 100)}%`, background: '#0f766e', borderRadius: 4 }} /></div>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>{row.region}<br /><strong style={{ color: '#334155' }}>{row.territory}</strong></td>
                        <td style={{ padding: '10px 12px' }}>{row.bill_count}</td>
                        <td style={{ padding: '10px 12px' }}>{Number(row.quantity).toLocaleString('en-IN')}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 900, color: '#0f766e', whiteSpace: 'nowrap' }}>{fullMoney(row.net_amount)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>

              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 15 }}>
                <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 10 }}>Territory contribution</div>
                {(summary.by_territory || []).map((row, index) => {
                  const pct = summary.total_net_amount ? (row.net_amount / summary.total_net_amount) * 100 : 0;
                  return (
                    <div key={`${row.region}-${row.territory}`} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
                        <span><strong>{row.territory}</strong><span style={{ color: '#94a3b8' }}> · {row.region}</span></span>
                        <strong>{money(row.net_amount)}</strong>
                      </div>
                      <div style={{ height: 6, background: '#eef2f7', borderRadius: 6, marginTop: 5 }}><div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: ['#0f766e', '#2563eb', '#7c3aed', '#d97706'][index % 4], borderRadius: 6 }} /></div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ padding: '13px 15px', borderBottom: '1px solid #eef2f7', fontSize: 13, fontWeight: 900 }}>Products in primary sales</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead><tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left' }}><th style={{ padding: '9px 12px' }}>Product</th><th style={{ padding: '9px 12px' }}>Quantity</th><th style={{ padding: '9px 12px' }}>Lines</th><th style={{ padding: '9px 12px' }}>Net Amount</th></tr></thead>
                  <tbody>{(summary.by_product || []).slice(0, 20).map(row => (
                    <tr key={row.product_name} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: '9px 12px', fontWeight: 800 }}>{row.product_name}</td><td style={{ padding: '9px 12px' }}>{Number(row.quantity).toLocaleString('en-IN')}</td><td style={{ padding: '9px 12px' }}>{row.line_count}</td><td style={{ padding: '9px 12px', fontWeight: 900 }}>{fullMoney(row.net_amount)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {canUpload && (summary?.recent_uploads || []).length > 0 && (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 15 }}>
            <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 9 }}>Recent Excel uploads</div>
            {summary.recent_uploads.map(row => (
              <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid #f1f5f9', fontSize: 11, flexWrap: 'wrap' }}>
                <div><strong>{row.filename}</strong><div style={{ color: '#94a3b8', marginTop: 2 }}>{row.uploaded_by_name} · {row.period_start || '—'} to {row.period_end || '—'}</div></div>
                <div style={{ textAlign: 'right' }}><strong style={{ color: '#0f766e' }}>{fullMoney(row.total_net_amount)}</strong><div style={{ color: '#94a3b8', marginTop: 2 }}>{row.inserted_count} new · {row.updated_count} refreshed</div></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
