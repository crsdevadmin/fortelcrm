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
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, marginTop: 22, overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #e5e7eb', fontWeight: 850, color: '#172033' }}>Upload history</div>
        {loading ? <div style={{ padding: 24, color: '#64748b' }}>Loading…</div> : uploads.length === 0 ? <div style={{ padding: 24, color: '#64748b' }}>No reports uploaded yet.</div> : (
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b' }}>
            {['Report', 'File', 'Customers', 'Period', 'Rows', 'Total', 'Uploaded by', 'Uploaded'].map(label => <th key={label} style={{ padding: '11px 14px' }}>{label}</th>)}
          </tr></thead><tbody>{uploads.map(row => <tr key={row.id} style={{ borderTop: '1px solid #eef2f7' }}>
            <td style={{ padding: '12px 14px', fontWeight: 800, textTransform: 'capitalize', verticalAlign: 'top' }}>{row.report_type}</td><td style={{ padding: '12px 14px', verticalAlign: 'top' }}>{row.filename}</td><td style={{ padding: '12px 14px', minWidth: 340 }}>
              {(row.customer_amounts || []).length ? <div style={{ border: '1px solid #e2e8f0', borderRadius: 9, overflow: 'hidden' }}>
                {(row.customer_amounts || []).map(customer => <div key={customer.customer_name} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '7px 9px', borderBottom: '1px solid #f1f5f9', background: '#fff' }}><span style={{ color: '#334155', fontWeight: 700 }}>{customer.customer_name}</span><span style={{ color: '#0f766e', fontWeight: 850, whiteSpace: 'nowrap' }}>{money(customer.amount)}</span></div>)}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '8px 9px', background: '#f8fafc', borderTop: '2px solid #cbd5e1', fontWeight: 900 }}><span>Total · {row.customer_count} customers</span><span style={{ color: '#172033', whiteSpace: 'nowrap' }}>{money(row.total_amount)}</span></div>
              </div> : '—'}
            </td><td style={{ padding: '12px 14px', verticalAlign: 'top' }}>{row.period_start || '—'} to {row.period_end || '—'}</td><td style={{ padding: '12px 14px', verticalAlign: 'top' }}>{row.row_count}</td><td style={{ padding: '12px 14px', fontWeight: 800, verticalAlign: 'top' }}>{money(row.total_amount)}</td><td style={{ padding: '12px 14px', verticalAlign: 'top' }}>{row.uploaded_by || '—'}</td><td style={{ padding: '12px 14px', verticalAlign: 'top' }}>{dateTime(row.uploaded_at)}</td>
          </tr>)}</tbody></table></div>
        )}
      </div>
    </div>
  );
}
