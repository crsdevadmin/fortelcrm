import React, { useEffect, useRef, useState } from 'react';
import { collectionsAPI, primarySalesAPI } from '../api';

const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const dateTime = value => value ? new Date(value).toLocaleString('en-IN') : '—';
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function UploadCard({ type, title, description, color, stockistId, stockistName, onComplete }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const upload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!stockistId) {
      setMessage({ ok: false, text: 'Select the source distributor before uploading.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await collectionsAPI.upload(file, type, stockistId);
      const row = response.data;
      setMessage({ ok: true, text: row.duplicate
        ? `${file.name} was already uploaded. The existing report is shown below.`
        : `${row.row_count} rows imported for ${row.stockist_name} · ${money(row.total_amount)}` });
      onComplete(row);
    } catch (error) {
      setMessage({ ok: false, text: error.response?.data?.detail || 'Upload failed. Check the report and try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 22, boxShadow: '0 5px 18px rgba(15,23,42,.06)' }}>
      <div style={{ display: 'flex', gap: 13, alignItems: 'center', marginBottom: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: `${color}18`, color, display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 900 }}>₹</div>
        <div><div style={{ fontSize: 17, fontWeight: 850, color: '#172033' }}>{title}</div><div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{description}</div></div>
      </div>
      <input ref={inputRef} type="file" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={upload} style={{ display: 'none' }} />
      <button disabled={busy || !stockistId} onClick={() => inputRef.current?.click()} style={{ width: '100%', border: 0, borderRadius: 10, padding: '11px 14px', color: '#fff', background: busy || !stockistId ? '#9ca3af' : color, cursor: busy ? 'wait' : !stockistId ? 'not-allowed' : 'pointer', fontWeight: 800 }}>
        {busy ? 'Reading report…' : `Upload ${title}`}
      </button>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>{stockistName ? `${stockistName} · ` : ''}Excel .xls or .xlsx · maximum 15 MB</div>
      {message && <div style={{ marginTop: 12, padding: '9px 11px', borderRadius: 8, fontSize: 12, color: message.ok ? '#166534' : '#b91c1c', background: message.ok ? '#dcfce7' : '#fee2e2' }}>{message.text}</div>}
    </div>
  );
}

function NexusSalesUploadCard({ onComplete }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState(null);

  const upload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setProgress(null);
    setMessage(null);
    try {
      const response = await primarySalesAPI.uploadCitySplit(file, (completed, total) => setProgress({ completed, total }));
      const result = response.data;
      setMessage({ ok: true, text: `${result.upload?.source_row_count || 0} Nexus sales rows imported · ${money(result.upload?.total_sales_amount)}` });
      onComplete(result.upload);
    } catch (error) {
      setMessage({ ok: false, text: error.response?.data?.detail || 'Nexus sales upload failed. Check the report and try again.' });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 16, padding: 22, marginBottom: 18, boxShadow: '0 5px 18px rgba(37,99,235,.06)' }}>
      <div style={{ display: 'flex', gap: 13, alignItems: 'center', marginBottom: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: '#dbeafe', color: '#1d4ed8', display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 900 }}>N</div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 850, color: '#172033' }}>Nexus Monthly Sales</div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>Customerwise Purchase Report – Productwise, including customer, bill, product, quantity, rate and value.</div>
        </div>
      </div>
      <input ref={inputRef} type="file" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={upload} style={{ display: 'none' }} />
      <button disabled={busy} onClick={() => inputRef.current?.click()} style={{ width: '100%', border: 0, borderRadius: 10, padding: '11px 14px', color: '#fff', background: busy ? '#94a3b8' : '#2563eb', cursor: busy ? 'wait' : 'pointer', fontWeight: 800 }}>
        {busy ? (progress?.total ? `Uploading ${progress.completed}/${progress.total}…` : 'Reading Nexus report…') : 'Upload Nexus Monthly Sales'}
      </button>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>Excel .xls or .xlsx · saved in Primary Sales · not counted as cash received or outstanding</div>
      {message && <div style={{ marginTop: 12, padding: '9px 11px', borderRadius: 8, fontSize: 12, color: message.ok ? '#166534' : '#b91c1c', background: message.ok ? '#dcfce7' : '#fee2e2' }}>{message.text}</div>}
    </div>
  );
}

function ReportHistoryCard({ row, deleting, onDelete }) {
  const period = row.period_start || row.period_end
    ? `${row.period_start || '—'} to ${row.period_end || '—'}`
    : '—';

  return (
    <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 850, color: '#172033', textTransform: 'capitalize' }}>{row.report_type} report</div>
          <div style={{ color: '#334155', fontSize: 12, fontWeight: 750, marginTop: 3 }}>{row.stockist_name}</div>
          <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{row.region} · {row.territory} · {row.filename}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: row.report_type === 'receipt' ? '#047857' : '#b45309', fontWeight: 900, fontSize: 16 }}>{money(row.total_amount)}</div>
          <button type="button" disabled={deleting} onClick={() => onDelete(row)} style={{ marginTop: 7, border: '1px solid #fecaca', borderRadius: 7, padding: '5px 8px', background: '#fff', color: '#b91c1c', cursor: deleting ? 'wait' : 'pointer', fontSize: 10, fontWeight: 800 }}>{deleting ? 'Removing…' : 'Remove report'}</button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 18px', marginTop: 9, color: '#64748b', fontSize: 11 }}>
        <span>{period}</span><span>{row.customer_count} customers</span><span>{row.row_count} rows</span><span>{row.uploaded_by || '—'}</span><span>{dateTime(row.uploaded_at)}</span>
      </div>
    </div>
  );
}

const customerKey = value => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();

function CollectionsReconciliation({ uploads, stockist, periodLabel }) {
  const receipt = uploads.find(row => row.report_type === 'receipt');
  const outstanding = uploads.find(row => row.report_type === 'outstanding');
  if (!receipt && !outstanding) return null;

  const customers = new Map();
  const addCustomers = (items, field) => (items || []).forEach(item => {
    const key = customerKey(item.customer_name);
    if (!key) return;
    const current = customers.get(key) || { name: item.customer_name, received: 0, pending: 0 };
    current[field] += Number(item.amount || 0);
    if (field === 'received' || !current.name) current.name = item.customer_name;
    customers.set(key, current);
  });
  addCustomers(receipt?.customer_amounts, 'received');
  addCustomers(outstanding?.customer_amounts, 'pending');

  const rows = Array.from(customers.values())
    .map(row => ({ ...row, total: row.received + row.pending }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const receivedTotal = rows.reduce((sum, row) => sum + row.received, 0);
  const pendingTotal = rows.reduce((sum, row) => sum + row.pending, 0);
  const combinedTotal = receivedTotal + pendingTotal;
  const recovery = combinedTotal ? (receivedTotal / combinedTotal) * 100 : 0;
  const summary = [
    { label: 'Received', value: money(receivedTotal), color: '#047857', background: '#ecfdf5' },
    { label: 'Pending', value: money(pendingTotal), color: '#b45309', background: '#fff7ed' },
    { label: 'Total value', value: money(combinedTotal), color: '#1d4ed8', background: '#eff6ff' },
    { label: 'Recovery', value: `${recovery.toFixed(1)}%`, color: '#7c3aed', background: '#f5f3ff' },
  ];

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, marginTop: 22, overflow: 'hidden', boxShadow: '0 5px 18px rgba(15,23,42,.05)' }}>
      <div style={{ padding: '17px 18px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontWeight: 900, color: '#172033', fontSize: 17 }}>{stockist?.name || 'Distributor'} collection position</div>
        <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{periodLabel} · {stockist?.region} · received and outstanding combined customer-wise.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 12, padding: 16 }}>
        {summary.map(item => <div key={item.label} style={{ padding: '14px 15px', borderRadius: 12, background: item.background }}>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 750, textTransform: 'uppercase' }}>{item.label}</div>
          <div style={{ color: item.color, fontSize: 20, fontWeight: 950, marginTop: 4 }}>{item.value}</div>
        </div>)}
      </div>
      <div style={{ overflowX: 'auto', borderTop: '1px solid #e5e7eb' }}>
        <table style={{ width: '100%', minWidth: 700, borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left' }}>
            <th style={{ padding: '11px 14px' }}>Customer</th>
            <th style={{ padding: '11px 14px', textAlign: 'right' }}>Received</th>
            <th style={{ padding: '11px 14px', textAlign: 'right' }}>Pending</th>
            <th style={{ padding: '11px 14px', textAlign: 'right' }}>Total</th>
            <th style={{ padding: '11px 14px', textAlign: 'right' }}>Recovered</th>
          </tr></thead>
          <tbody>
            {rows.map(row => {
              const recovered = row.total ? (row.received / row.total) * 100 : 0;
              return <tr key={customerKey(row.name)} style={{ borderTop: '1px solid #eef2f7' }}>
                <td style={{ padding: '11px 14px', color: '#334155', fontWeight: 750 }}>{row.name}</td>
                <td style={{ padding: '11px 14px', textAlign: 'right', color: '#047857', fontWeight: 850, whiteSpace: 'nowrap' }}>{money(row.received)}</td>
                <td style={{ padding: '11px 14px', textAlign: 'right', color: row.pending ? '#b45309' : '#94a3b8', fontWeight: 850, whiteSpace: 'nowrap' }}>{money(row.pending)}</td>
                <td style={{ padding: '11px 14px', textAlign: 'right', color: '#172033', fontWeight: 900, whiteSpace: 'nowrap' }}>{money(row.total)}</td>
                <td style={{ padding: '11px 14px', textAlign: 'right', color: recovered >= 75 ? '#047857' : recovered >= 40 ? '#b45309' : '#b91c1c', fontWeight: 850, whiteSpace: 'nowrap' }}>{recovered.toFixed(1)}%</td>
              </tr>;
            })}
            <tr style={{ borderTop: '2px solid #cbd5e1', background: '#f8fafc' }}>
              <td style={{ padding: '12px 14px', fontWeight: 950 }}>Total · {rows.length} customers</td>
              <td style={{ padding: '12px 14px', textAlign: 'right', color: '#047857', fontWeight: 950 }}>{money(receivedTotal)}</td>
              <td style={{ padding: '12px 14px', textAlign: 'right', color: '#b45309', fontWeight: 950 }}>{money(pendingTotal)}</td>
              <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 950 }}>{money(combinedTotal)}</td>
              <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 950 }}>{recovery.toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CollectionsUpload() {
  const now = new Date();
  const [uploads, setUploads] = useState([]);
  const [stockists, setStockists] = useState([]);
  const [stockistId, setStockistId] = useState('');
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [periodResolved, setPeriodResolved] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [pageMessage, setPageMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = () => collectionsAPI.uploads().then(response => setUploads(response.data || [])).catch(() => setUploads([])).finally(() => setLoading(false));
  useEffect(load, []);
  useEffect(() => {
    collectionsAPI.sources().then(response => {
      const sources = response.data || [];
      setStockists(sources);
      const fortel = sources.find(row => row.label === 'Fortel');
      const initial = fortel || sources[0];
      if (initial) {
        setStockistId(String(initial.id));
      }
      setSourcesError('');
    }).catch(error => {
      setStockists([]);
      setSourcesError(error.response?.data?.detail || 'Unable to load Fortel and Nexus options. Refresh the page and try again.');
    }).finally(() => setSourcesLoading(false));
  }, []);

  const selectedStockist = stockists.find(row => String(row.id) === String(stockistId));
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
  const selectedUploads = uploads.filter(row =>
    String(row.stockist_id) === String(stockistId) &&
    (!row.period_start || row.period_start <= monthEnd) &&
    (!row.period_end || row.period_end >= monthStart)
  );
  const years = [...new Set([
    now.getFullYear(),
    ...uploads.flatMap(row => [row.period_start, row.period_end]).filter(Boolean).map(value => Number(String(value).slice(0, 4))),
  ])].filter(Boolean).sort((a, b) => b - a);

  useEffect(() => {
    if (periodResolved || uploads.length === 0) return;
    const latest = uploads.find(row => row.period_end || row.period_start);
    const value = latest?.period_end || latest?.period_start;
    if (value) {
      setYear(Number(value.slice(0, 4)));
      setMonth(Number(value.slice(5, 7)));
    }
    setPeriodResolved(true);
  }, [uploads, periodResolved]);

  const uploadComplete = row => {
    const value = row?.period_end || row?.period_start;
    if (value) {
      setYear(Number(value.slice(0, 4)));
      setMonth(Number(value.slice(5, 7)));
      setPeriodResolved(true);
    }
    load();
  };

  const nexusSalesComplete = row => {
    const value = row?.period_end || row?.period_start;
    if (value) {
      setYear(Number(value.slice(0, 4)));
      setMonth(Number(value.slice(5, 7)));
      setPeriodResolved(true);
    }
    setPageMessage({ ok: true, text: 'Nexus monthly sales imported successfully. View its customer, city and product totals in Primary Sales.' });
  };

  const removeUpload = async row => {
    const confirmation = window.prompt(
      `Remove ${row.filename} from ${row.stockist_name} for ${MONTHS[month]} ${year}?\n\nThis will also remove all ${row.row_count || 0} imported customer rows from this report.\n\nType DELETE REPORT to continue.`
    );
    if (confirmation === null) return;
    if (confirmation.trim().toUpperCase() !== 'DELETE REPORT') {
      setPageMessage({ ok: false, text: 'Removal cancelled. Type DELETE REPORT exactly to confirm.' });
      return;
    }
    setDeletingId(row.id);
    setPageMessage(null);
    try {
      const response = await collectionsAPI.deleteUpload(row.id, confirmation);
      setPageMessage({ ok: true, text: `${response.data.filename} removed with ${response.data.deleted_rows} imported rows.` });
      await load();
    } catch (error) {
      setPageMessage({ ok: false, text: error.response?.data?.detail || 'Unable to remove this report.' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 25, color: '#172033' }}>Receipts & Outstanding</h1>
        <p style={{ margin: '7px 0 0', color: '#64748b', fontSize: 13 }}>Choose Fortel or Nexus, then upload the Received Amount and Outstanding Amount files for that source.</p>
      </div>
      {pageMessage && <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 9, fontSize: 12, color: pageMessage.ok ? '#166534' : '#b91c1c', background: pageMessage.ok ? '#dcfce7' : '#fee2e2' }}>{pageMessage.text}</div>}
      <div style={{ background: '#fff', border: '1px solid #dbe3ed', borderRadius: 16, padding: 18, marginBottom: 18, boxShadow: '0 5px 18px rgba(15,23,42,.05)' }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: '#172033' }}>Select report source</div>
        <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>Fortel and Nexus accept received and outstanding reports. Nexus also accepts its monthly customer/product sales report.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 13 }}>
          {sourcesLoading ? <div style={{ gridColumn: '1 / -1', padding: 13, color: '#64748b', fontSize: 12 }}>Loading Fortel and Nexus options…</div> : stockists.map(row => {
            const active = String(row.id) === String(stockistId);
            const label = row.label;
            return <button key={row.id} type="button" onClick={() => setStockistId(String(row.id))} style={{ border: active ? '2px solid #0f766e' : '1px solid #cbd5e1', borderRadius: 11, padding: '13px 14px', background: active ? '#ecfdf5' : '#fff', color: active ? '#065f46' : '#334155', cursor: 'pointer', fontSize: 14, fontWeight: 900 }}>
              {label}<span style={{ display: 'block', marginTop: 3, color: '#64748b', fontSize: 10, fontWeight: 650 }}>{label === 'Nexus' ? 'Tamil Nadu distributor' : 'Company collections'}</span>
            </button>;
          })}
        </div>
        {sourcesError && <div style={{ marginTop: 10, padding: '9px 11px', borderRadius: 8, background: '#fee2e2', color: '#b91c1c', fontSize: 12 }}>{sourcesError}</div>}
        <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 15, paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 850, color: '#172033' }}>Select report month</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 9 }}>
            <label style={{ color: '#64748b', fontSize: 10, fontWeight: 750 }}>Month
              <select value={month} onChange={event => setMonth(Number(event.target.value))} style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #cbd5e1', borderRadius: 9, padding: '9px 10px', background: '#fff', color: '#172033', fontSize: 12 }}>
                {MONTHS.slice(1).map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
              </select>
            </label>
            <label style={{ color: '#64748b', fontSize: 10, fontWeight: 750 }}>Year
              <select value={year} onChange={event => setYear(Number(event.target.value))} style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #cbd5e1', borderRadius: 9, padding: '9px 10px', background: '#fff', color: '#172033', fontSize: 12 }}>
                {years.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>
      {selectedStockist?.label === 'Nexus' && <NexusSalesUploadCard onComplete={nexusSalesComplete} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 18 }}>
        <UploadCard type="receipt" title="Received Amount" description="Upload the file containing amounts received" color="#047857" stockistId={stockistId} stockistName={selectedStockist?.name} onComplete={uploadComplete} />
        <UploadCard type="outstanding" title="Outstanding Amount" description="Upload the file containing pending amounts" color="#b45309" stockistId={stockistId} stockistName={selectedStockist?.name} onComplete={uploadComplete} />
      </div>
      {!loading && <CollectionsReconciliation uploads={selectedUploads} stockist={selectedStockist} periodLabel={`${MONTHS[month]} ${year}`} />}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, marginTop: 22, overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #e5e7eb', fontWeight: 850, color: '#172033' }}>Upload history{selectedStockist ? ` · ${selectedStockist.name}` : ''} · {MONTHS[month]} {year}</div>
        {loading ? <div style={{ padding: 24, color: '#64748b' }}>Loading…</div> : selectedUploads.length === 0 ? <div style={{ padding: 24, color: '#64748b' }}>No reports uploaded for this distributor yet.</div> : (
          <div>{selectedUploads.map(row => <ReportHistoryCard key={row.id} row={row} deleting={deletingId === row.id} onDelete={removeUpload} />)}</div>
        )}
      </div>
    </div>
  );
}
