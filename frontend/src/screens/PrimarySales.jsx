import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { primarySalesAPI } from '../api';
import { useAuth } from '../context/AuthContext';


const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PRIMARY_SALES_UPLOADER_EMAILS = new Set(['staff1@fortel.in', 'staff2@fortel.in']);

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

function weekForDate(value) {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  return Math.min(4, Math.max(1, Math.floor((date.getDate() - 1) / 7) + 1));
}

function weekLabel(year, month, week) {
  if (!week) return `${MONTHS[month]} · All Weeks`;
  const start = ((week - 1) * 7) + 1;
  const end = week === 4 ? new Date(year, month, 0).getDate() : start + 6;
  return `Week ${week} · ${start}–${end} ${MONTHS[month]}`;
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
  const [week, setWeek] = useState(weekForDate(now));
  const [region, setRegion] = useState('ALL');
  const [territory, setTerritory] = useState('ALL');
  const [stockistId, setStockistId] = useState('');
  const [summary, setSummary] = useState(null);
  const [citySummary, setCitySummary] = useState(null);
  const [cityFilter, setCityFilter] = useState('ALL');
  const [cityTerritory, setCityTerritory] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [cityLoading, setCityLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deletingUploadId, setDeletingUploadId] = useState(null);
  const [deletingCityUploadId, setDeletingCityUploadId] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedCityFile, setSelectedCityFile] = useState(null);
  const [cityUploading, setCityUploading] = useState(false);
  const [cityUploadProgress, setCityUploadProgress] = useState(null);
  const fileRef = useRef(null);
  const cityFileRef = useRef(null);
  const initialPeriodResolved = useRef(false);
  const summaryRequestId = useRef(0);
  const cityRequestId = useRef(0);
  const canUpload = user?.role === 'back_office' && PRIMARY_SALES_UPLOADER_EMAILS.has((user?.email || '').trim().toLowerCase());
  const canManageStockists = ['admin', 'md', 'back_office'].includes(user?.role);

  const load = useCallback(async () => {
    const requestId = summaryRequestId.current + 1;
    summaryRequestId.current = requestId;
    setLoading(true);
    setError('');
    try {
      const response = await primarySalesAPI.summary({
        year, month, week: week || undefined,
        region: region === 'ALL' ? undefined : region,
        territory: territory === 'ALL' ? undefined : territory,
        stockist_id: stockistId || undefined,
      });
      if (requestId !== summaryRequestId.current) return;
      const data = response.data;
      if (!initialPeriodResolved.current) {
        initialPeriodResolved.current = true;
        const latestPeriodEnd = data.recent_uploads?.[0]?.period_end;
        if (Number(data.line_count || 0) === 0 && latestPeriodEnd) {
          const latestYear = Number(latestPeriodEnd.slice(0, 4));
          const latestMonth = Number(latestPeriodEnd.slice(5, 7));
          if (latestYear !== year || latestMonth !== month || week !== 0) {
            setYear(latestYear);
            setMonth(latestMonth);
            setWeek(0);
            setRegion('ALL');
            setTerritory('ALL');
            setStockistId('');
            return;
          }
        }
      }
      setSummary(data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to load primary sales');
    } finally {
      if (requestId === summaryRequestId.current) setLoading(false);
    }
  }, [year, month, week, region, territory, stockistId]);

  useEffect(() => { load(); }, [load]);

  const loadCitySplit = useCallback(async () => {
    const requestId = cityRequestId.current + 1;
    cityRequestId.current = requestId;
    setCityLoading(true);
    try {
      const response = await primarySalesAPI.citySplitSummary({
        year, month, week: week || undefined,
        city: cityFilter === 'ALL' ? undefined : cityFilter,
        territory: cityTerritory === 'ALL' ? undefined : cityTerritory,
      });
      if (requestId === cityRequestId.current) setCitySummary(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to load the Tamil Nadu city split');
    } finally {
      if (requestId === cityRequestId.current) setCityLoading(false);
    }
  }, [year, month, week, cityFilter, cityTerritory]);

  useEffect(() => { loadCitySplit(); }, [loadCitySplit]);

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
      setSuccess(`${result.message}. Gross Amount with Discount: ${fullMoney(result.upload?.total_sales_amount)}`);
      const periodEnd = result.upload?.period_end;
      if (periodEnd) {
        setYear(Number(periodEnd.slice(0, 4)));
        setMonth(Number(periodEnd.slice(5, 7)));
        setWeek(0);
        setRegion('ALL');
        setTerritory('ALL');
        setStockistId('');
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

  const deleteUpload = async row => {
    const confirmation = window.prompt(
      `Delete ${row.filename}?\n\nThis permanently removes the sales rows currently attached to this upload. Previous file versions will not be restored.\n\nType DELETE UPLOAD to continue.`
    );
    if (confirmation === null) return;
    if (confirmation.trim().toUpperCase() !== 'DELETE UPLOAD') {
      setError('Deletion cancelled. Type DELETE UPLOAD exactly to confirm.');
      return;
    }
    setDeletingUploadId(row.id);
    setError('');
    setSuccess('');
    try {
      const response = await primarySalesAPI.deleteUpload(row.id, confirmation);
      setSuccess(`${response.data?.filename || row.filename} deleted · ${response.data?.deleted_rows || 0} sales rows removed.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to delete this Primary Sales upload');
    } finally {
      setDeletingUploadId(null);
    }
  };

  const uploadCitySplit = async event => {
    event.preventDefault();
    if (!selectedCityFile) { setError('Select the Tamil Nadu city-split Excel file first'); return; }
    setCityUploading(true);
    setCityUploadProgress(null);
    setError('');
    setSuccess('');
    try {
      const response = await primarySalesAPI.uploadCitySplit(selectedCityFile, (completed, total) => setCityUploadProgress({ completed, total }));
      const result = response.data;
      setSuccess(`${result.message}. Nexus onward sales: ${fullMoney(result.upload?.total_sales_amount)}.`);
      const periodEnd = result.upload?.period_end;
      if (periodEnd) {
        setYear(Number(periodEnd.slice(0, 4)));
        setMonth(Number(periodEnd.slice(5, 7)));
        setWeek(0);
        setCityFilter('ALL');
        setCityTerritory('ALL');
      }
      await loadCitySplit();
      setSelectedCityFile(null);
      if (cityFileRef.current) cityFileRef.current.value = '';
    } catch (err) {
      setError(err.response?.data?.detail || 'Tamil Nadu city-split upload failed');
    } finally {
      setCityUploading(false);
      setCityUploadProgress(null);
    }
  };

  const deleteCityUpload = async row => {
    const confirmation = window.prompt(
      `Delete Tamil Nadu city split ${row.filename}?\n\nThis permanently removes the city rows attached to this upload.\n\nType DELETE UPLOAD to continue.`
    );
    if (confirmation === null) return;
    if (confirmation.trim().toUpperCase() !== 'DELETE UPLOAD') {
      setError('Deletion cancelled. Type DELETE UPLOAD exactly to confirm.');
      return;
    }
    setDeletingCityUploadId(row.id);
    setError('');
    setSuccess('');
    try {
      const response = await primarySalesAPI.deleteCitySplitUpload(row.id, confirmation);
      setSuccess(`${response.data?.filename || row.filename} deleted · ${response.data?.deleted_rows || 0} city rows removed.`);
      await loadCitySplit();
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to delete this city-split upload');
    } finally {
      setDeletingCityUploadId(null);
    }
  };

  const maxStockist = Math.max(...(summary?.by_stockist || []).map(row => Number(row.sales_amount) || 0), 1);
  const reconciliation = citySummary?.reconciliation || {};

  return (
    <div style={{ minHeight: '100vh', background: '#f6f8fb', paddingBottom: 36 }}>
      <div style={{ background: 'linear-gradient(135deg,#102a43,#174e63 58%,#0f766e)', color: '#fff', padding: '19px 24px 22px', borderRadius: '0 0 20px 20px', boxShadow: '0 8px 28px rgba(15,42,67,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 21, fontWeight: 900 }}>Primary Sales</div>
            <div style={{ fontSize: 11, opacity: 0.72, marginTop: 3 }}>Company invoices to stockists · calculated from Excel Gross Amount with Discount</div>
          </div>
          <span style={{ background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, padding: '6px 11px', fontSize: 10, fontWeight: 800 }}>No approval required</span>
        </div>
      </div>

      <div style={{ padding: '16px 24px 0' }}>
        {canUpload && (
          <form onSubmit={upload} style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 14, padding: 15, marginBottom: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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

        {canUpload && (
          <form onSubmit={uploadCitySplit} style={{ background: '#f8fafc', border: '1px solid #bfdbfe', borderRadius: 14, padding: 15, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 280px' }}>
              <div style={{ fontWeight: 900, fontSize: 13, color: '#172033' }}>Upload Nexus Tamil Nadu city split</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Separate city detail · values are used exactly as uploaded and are not added again to company Primary Sales</div>
            </div>
            <input ref={cityFileRef} type="file" accept=".xls,.xlsx" onChange={event => setSelectedCityFile(event.target.files?.[0] || null)} style={{ ...fieldStyle, flex: '1 1 230px' }} />
            <button type="submit" disabled={cityUploading} style={{ border: 'none', borderRadius: 10, padding: '10px 18px', background: cityUploading ? '#94a3b8' : '#2563eb', color: '#fff', fontWeight: 900, cursor: cityUploading ? 'wait' : 'pointer' }}>
              {cityUploading
                ? cityUploadProgress?.total
                  ? `Uploading ${cityUploadProgress.completed}/${cityUploadProgress.total}…`
                  : 'Preparing…'
                : 'Upload city split'}
            </button>
          </form>
        )}

        {error && <div style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '10px 13px', borderRadius: 10, marginBottom: 12, fontSize: 12, fontWeight: 700 }}>{error}</div>}
        {success && <div style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '10px 13px', borderRadius: 10, marginBottom: 12, fontSize: 12, fontWeight: 700 }}>{success}</div>}

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
          <span style={{ flexBasis: '100%', height: 0 }} />
          <span style={{ color: '#64748b', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.7 }}>Period</span>
          {[1, 2, 3, 4].map(value => (
            <button key={value} type="button" onClick={() => setWeek(value)} style={{ ...fieldStyle, minHeight: 32, padding: '6px 12px', cursor: 'pointer', fontWeight: 900, borderColor: week === value ? '#0f766e' : '#dbe2ea', background: week === value ? '#ecfdf5' : '#fff', color: week === value ? '#0f766e' : '#64748b' }}>
              Week {value}
            </button>
          ))}
          <button type="button" onClick={() => setWeek(0)} style={{ ...fieldStyle, minHeight: 32, padding: '6px 12px', cursor: 'pointer', fontWeight: 900, borderColor: week === 0 ? '#0f766e' : '#dbe2ea', background: week === 0 ? '#ecfdf5' : '#fff', color: week === 0 ? '#0f766e' : '#64748b' }}>
            All Weeks
          </button>
          <span style={{ color: '#64748b', fontSize: 10 }}>{weekLabel(year, month, week)}</span>
        </div>

        <div style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: 14, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#1e3a8a' }}>Fortel + Nexus sales reconciliation</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{weekLabel(year, month, week)} {year} · overall figures before region, territory or city filters</div>
            </div>
            <span style={{ padding: '5px 9px', borderRadius: 20, background: reconciliation.is_complete ? '#dcfce7' : '#fef3c7', color: reconciliation.is_complete ? '#166534' : '#92400e', fontSize: 10, fontWeight: 900 }}>
              {reconciliation.is_complete ? 'Both sheets loaded' : 'Upload both sheets'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 9 }}>
            <MetricCard label="Fortel total" value={money(reconciliation.fortel_total_including_nexus)} note="includes Nexus primary value" color="#0f766e" />
            <MetricCard label="Nexus in Fortel" value={money(reconciliation.nexus_primary_value)} note="original Fortel invoice value" color="#64748b" />
            <MetricCard label="Nexus onward sales" value={money(reconciliation.nexus_onward_sales)} note="higher selling value · returns deducted" color="#2563eb" />
            <MetricCard label="Nexus value difference" value={money(reconciliation.nexus_value_difference)} note="onward sales minus Nexus in Fortel" color={Number(reconciliation.nexus_value_difference || 0) >= 0 ? '#15803d' : '#be123c'} />
            <MetricCard label="Adjusted primary sales" value={money(reconciliation.adjusted_primary_sales)} note="Fortel total with Nexus value replaced" color="#7c3aed" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 14 }}>
          <MetricCard label="Primary sales" value={money(summary?.total_sales_amount)} note={`${weekLabel(year, month, week)} ${year} · Gross Amount with Discount`} color="#0f766e" />
          <MetricCard label="Stockists" value={summary?.stockist_count || 0} note="with sales in selection" color="#2563eb" />
          <MetricCard label="Invoices" value={summary?.bill_count || 0} note={`${summary?.line_count || 0} product lines`} color="#7c3aed" />
          <MetricCard label="Quantity" value={Number(summary?.total_quantity || 0).toLocaleString('en-IN')} note="total billed units" color="#d97706" />
        </div>

        {!loading && Number(summary?.line_count || 0) === 0 && (summary?.by_stockist || []).length > 0 && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 10, padding: '10px 13px', marginBottom: 12, fontSize: 11, fontWeight: 700 }}>
            No invoices were recorded for {weekLabel(year, month, week)}. Sales by stockist below still shows the complete month.
          </div>
        )}

        {loading ? (
          <div style={{ padding: 50, textAlign: 'center', color: '#64748b' }}>Loading primary sales…</div>
        ) : (summary?.by_stockist || []).length === 0 ? (
          <div style={{ background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 14, padding: 45, textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>▦</div>
            <div style={{ fontWeight: 900, color: '#334155' }}>No primary sales for {weekLabel(year, month, week)} {year}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>{canUpload ? 'Upload the company Excel report above.' : 'The back-office team has not uploaded this period yet.'}</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(300px,0.8fr)', gap: 14, marginBottom: 14 }}>
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ padding: '13px 15px', borderBottom: '1px solid #eef2f7' }}>
                  <div style={{ fontSize: 13, fontWeight: 900 }}>Sales by stockist · Complete month</div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{MONTHS[month]} {year} · all bills · region → territory → distributor</div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead><tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left' }}>
                      {['Stockist', 'Region / territory', 'Bills', 'Qty', 'Gross Amount with Discount'].map(label => <th key={label} style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{label}</th>)}
                    </tr></thead>
                    <tbody>{summary.by_stockist.map(row => (
                      <tr key={row.stockist_id} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 12px', minWidth: 190 }}>
                          <div style={{ fontWeight: 900, color: '#172033' }}>{row.stockist_name}</div>
                          <div style={{ height: 4, background: '#ecfdf5', borderRadius: 4, marginTop: 6 }}><div style={{ height: '100%', width: `${Math.max(2, (row.sales_amount / maxStockist) * 100)}%`, background: '#0f766e', borderRadius: 4 }} /></div>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>{row.region}<br /><strong style={{ color: '#334155' }}>{row.territory}</strong></td>
                        <td style={{ padding: '10px 12px' }}>{row.bill_count}</td>
                        <td style={{ padding: '10px 12px' }}>{Number(row.quantity).toLocaleString('en-IN')}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 900, color: '#0f766e', whiteSpace: 'nowrap' }}>{fullMoney(row.sales_amount)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>

              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 15 }}>
                <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 10 }}>Territory contribution</div>
                {(summary.by_territory || []).map((row, index) => {
                  const pct = summary.total_sales_amount ? (row.sales_amount / summary.total_sales_amount) * 100 : 0;
                  return (
                    <div key={`${row.region}-${row.territory}`} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
                        <span><strong>{row.territory}</strong><span style={{ color: '#94a3b8' }}> · {row.region}</span></span>
                        <strong>{money(row.sales_amount)}</strong>
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
                  <thead><tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left' }}><th style={{ padding: '9px 12px' }}>Product</th><th style={{ padding: '9px 12px' }}>Quantity</th><th style={{ padding: '9px 12px' }}>Lines</th><th style={{ padding: '9px 12px' }}>Gross Amount with Discount</th></tr></thead>
                  <tbody>{(summary.by_product || []).slice(0, 20).map(row => (
                    <tr key={row.product_name} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: '9px 12px', fontWeight: 800 }}>{row.product_name}</td><td style={{ padding: '9px 12px' }}>{Number(row.quantity).toLocaleString('en-IN')}</td><td style={{ padding: '9px 12px' }}>{row.line_count}</td><td style={{ padding: '9px 12px', fontWeight: 900 }}>{fullMoney(row.sales_amount)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <section style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 16, padding: 15, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 900, color: '#1e3a8a' }}>Tamil Nadu city split · Nexus Biocare</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>City-level reference only · Gross Amount with Discount already includes the higher distributor value · not added to the company Primary total</div>
            </div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <select value={cityTerritory} onChange={event => { setCityTerritory(event.target.value); setCityFilter('ALL'); }} style={fieldStyle}>
                <option value="ALL">All TN territories</option>
                {(citySummary?.options?.territories || []).map(value => <option key={value}>{value}</option>)}
              </select>
              <select value={cityFilter} onChange={event => setCityFilter(event.target.value)} style={fieldStyle}>
                <option value="ALL">All cities</option>
                {(citySummary?.options?.cities || []).map(value => <option key={value}>{value}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 9, marginBottom: 12 }}>
            <MetricCard label="City-split value" value={money(citySummary?.total_sales_amount)} note={`${weekLabel(year, month, week)} · separate reference`} color="#2563eb" />
            <MetricCard label="Customers" value={(citySummary?.by_customer || []).length} note={`${citySummary?.bill_count || 0} invoices`} color="#7c3aed" />
            <MetricCard label="Quantity" value={Number(citySummary?.total_quantity || 0).toLocaleString('en-IN')} note={`${citySummary?.line_count || 0} product lines`} color="#0f766e" />
            <MetricCard label="Returns" value={fullMoney(citySummary?.return_amount)} note={`${citySummary?.return_line_count || 0} return lines · already deducted`} color="#be123c" />
          </div>

          {cityLoading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>Loading Tamil Nadu city split…</div>
          ) : Number(citySummary?.line_count || 0) === 0 ? (
            <div style={{ background: '#fff', border: '1px dashed #93c5fd', borderRadius: 12, padding: 28, textAlign: 'center', color: '#64748b', fontSize: 11 }}>
              No Nexus city-split rows for {weekLabel(year, month, week)} {year}.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 12 }}>
              <div style={{ background: '#fff', border: '1px solid #dbeafe', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '11px 13px', fontSize: 12, fontWeight: 900, borderBottom: '1px solid #eff6ff' }}>Sales by city</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead><tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left' }}><th style={{ padding: '8px 10px' }}>City / territory</th><th style={{ padding: '8px 10px' }}>Customers</th><th style={{ padding: '8px 10px' }}>Qty</th><th style={{ padding: '8px 10px' }}>Value</th></tr></thead>
                    <tbody>{(citySummary?.by_city || []).map(row => (
                      <tr key={`${row.city}-${row.territory}`} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '9px 10px' }}><strong>{row.city}</strong><div style={{ color: '#94a3b8', marginTop: 2 }}>{row.territory}</div></td>
                        <td style={{ padding: '9px 10px' }}>{row.customer_count}</td>
                        <td style={{ padding: '9px 10px' }}>{Number(row.quantity).toLocaleString('en-IN')}</td>
                        <td style={{ padding: '9px 10px', fontWeight: 900, color: Number(row.sales_amount) < 0 ? '#be123c' : '#1d4ed8' }}>{fullMoney(row.sales_amount)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>

              <div style={{ background: '#fff', border: '1px solid #dbeafe', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '11px 13px', fontSize: 12, fontWeight: 900, borderBottom: '1px solid #eff6ff' }}>Sales by customer / distributor</div>
                <div style={{ overflowX: 'auto', maxHeight: 390 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead><tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left', position: 'sticky', top: 0 }}><th style={{ padding: '8px 10px' }}>Customer</th><th style={{ padding: '8px 10px' }}>Bills</th><th style={{ padding: '8px 10px' }}>Qty</th><th style={{ padding: '8px 10px' }}>Value</th></tr></thead>
                    <tbody>{(citySummary?.by_customer || []).map(row => (
                      <tr key={row.customer_name} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '9px 10px', minWidth: 190 }}><strong>{row.customer_name}</strong><div style={{ color: '#94a3b8', marginTop: 2 }}>{row.city} · {row.territory}</div></td>
                        <td style={{ padding: '9px 10px' }}>{row.bill_count}</td>
                        <td style={{ padding: '9px 10px' }}>{Number(row.quantity).toLocaleString('en-IN')}</td>
                        <td style={{ padding: '9px 10px', fontWeight: 900, color: Number(row.sales_amount) < 0 ? '#be123c' : '#1d4ed8' }}>{fullMoney(row.sales_amount)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {canManageStockists && (citySummary?.recent_uploads || []).length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #dbeafe', borderRadius: 12, padding: 13, marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 7 }}>Recent Nexus city-split uploads</div>
              {citySummary.recent_uploads.map(row => (
                <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: '1px solid #eff6ff', fontSize: 11, flexWrap: 'wrap' }}>
                  <div><strong>{row.filename}</strong><div style={{ color: '#94a3b8', marginTop: 2 }}>{row.uploaded_by_name} · {row.period_start || '—'} to {row.period_end || '—'}</div></div>
                  <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
                    <strong style={{ color: '#1d4ed8' }}>{fullMoney(row.total_sales_amount)}</strong>
                    {canUpload && <button type="button" disabled={deletingCityUploadId === row.id} onClick={() => deleteCityUpload(row)} style={{ border: '1px solid #fecaca', borderRadius: 8, padding: '6px 9px', background: '#fff1f2', color: '#be123c', fontSize: 10, fontWeight: 900, cursor: deletingCityUploadId === row.id ? 'wait' : 'pointer' }}>{deletingCityUploadId === row.id ? 'Deleting…' : 'Delete'}</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {canManageStockists && (summary?.recent_uploads || []).length > 0 && (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 15 }}>
            <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 9 }}>Recent Excel uploads</div>
            {summary.recent_uploads.map(row => (
              <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid #f1f5f9', fontSize: 11, flexWrap: 'wrap' }}>
                <div><strong>{row.filename}</strong><div style={{ color: '#94a3b8', marginTop: 2 }}>{row.uploaded_by_name} · {row.period_start || '—'} to {row.period_end || '—'}</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ textAlign: 'right' }}><strong style={{ color: '#0f766e' }}>{fullMoney(row.total_sales_amount)}</strong><div style={{ color: '#94a3b8', marginTop: 2 }}>{row.inserted_count} new · {row.updated_count} refreshed</div></div>
                  {canUpload && (
                    <button type="button" disabled={deletingUploadId === row.id} onClick={() => deleteUpload(row)} style={{ border: '1px solid #fecaca', borderRadius: 8, padding: '6px 9px', background: '#fff1f2', color: '#be123c', fontSize: 10, fontWeight: 900, cursor: deletingUploadId === row.id ? 'wait' : 'pointer' }}>
                      {deletingUploadId === row.id ? 'Deleting…' : 'Delete'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
