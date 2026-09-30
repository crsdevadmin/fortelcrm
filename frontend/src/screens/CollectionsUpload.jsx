import React, { useEffect, useRef, useState } from 'react';
import { collectionsAPI } from '../api';

const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const dateTime = value => value ? new Date(value).toLocaleString('en-IN') : '—';

function UploadCard({ type, title, description, color, onComplete }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const upload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await collectionsAPI.upload(file, type);
      const row = response.data;
      setMessage({ ok: true, text: row.duplicate
        ? `${file.name} was already uploaded. The existing report is shown below.`
        : `${row.row_count} rows imported · ${money(row.total_amount)}` });
      onComplete();
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
      <button disabled={busy} onClick={() => inputRef.current?.click()} style={{ width: '100%', border: 0, borderRadius: 10, padding: '11px 14px', color: '#fff', background: busy ? '#9ca3af' : color, cursor: busy ? 'wait' : 'pointer', fontWeight: 800 }}>
        {busy ? 'Reading report…' : `Upload ${title}`}
      </button>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>Excel .xls or .xlsx · maximum 15 MB</div>
      {message && <div style={{ marginTop: 12, padding: '9px 11px', borderRadius: 8, fontSize: 12, color: message.ok ? '#166534' : '#b91c1c', background: message.ok ? '#dcfce7' : '#fee2e2' }}>{message.text}</div>}
    </div>
  );
}

function ReportHistoryCard({ row }) {
  const period = row.period_start || row.period_end
    ? `${row.period_start || '—'} to ${row.period_end || '—'}`
    : '—';

  return (
    <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 850, color: '#172033', textTransform: 'capitalize' }}>{row.report_type} report</div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>{row.filename}</div>
        </div>
        <div style={{ color: row.report_type === 'receipt' ? '#047857' : '#b45309', fontWeight: 900, fontSize: 16 }}>{money(row.total_amount)}</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 18px', marginTop: 9, color: '#64748b', fontSize: 11 }}>
        <span>{period}</span><span>{row.customer_count} customers</span><span>{row.row_count} rows</span><span>{row.uploaded_by || '—'}</span><span>{dateTime(row.uploaded_at)}</span>
      </div>
    </div>
  );
}

const customerKey = value => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();

function CollectionsReconciliation({ uploads }) {
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
        <div style={{ fontWeight: 900, color: '#172033', fontSize: 17 }}>Customer collection position</div>
        <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>Latest receipt and outstanding reports combined customer-wise.</div>
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
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = () => collectionsAPI.uploads().then(response => setUploads(response.data || [])).catch(() => setUploads([])).finally(() => setLoading(false));
  useEffect(load, []);

  return (
    <div style={{ padding: '24px', maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 25, color: '#172033' }}>Receipts & Outstanding</h1>
        <p style={{ margin: '7px 0 0', color: '#64748b', fontSize: 13 }}>Upload the amount received report and pending collection report. The latest reports are shown only on the MD dashboard.</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 18 }}>
        <UploadCard type="receipt" title="Receipt Report" description="Amounts received by Fortel" color="#047857" onComplete={load} />
        <UploadCard type="outstanding" title="Outstanding Report" description="Amounts still pending from customers" color="#b45309" onComplete={load} />
      </div>
      {!loading && <CollectionsReconciliation uploads={uploads} />}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, marginTop: 22, overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #e5e7eb', fontWeight: 850, color: '#172033' }}>Upload history</div>
        {loading ? <div style={{ padding: 24, color: '#64748b' }}>Loading…</div> : uploads.length === 0 ? <div style={{ padding: 24, color: '#64748b' }}>No reports uploaded yet.</div> : (
          <div>{uploads.map(row => <ReportHistoryCard key={row.id} row={row} />)}</div>
        )}
      </div>
    </div>
  );
}
