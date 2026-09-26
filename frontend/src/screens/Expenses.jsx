import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { expensesAPI } from '../api';

const EMPLOYEE_CATEGORIES = ['Daily Allowance', 'Travel Fare', 'Outstation Allowance', 'Courier & Photocopy', 'Food', 'Accommodation', 'Other'];
const COMPANY_CATEGORIES = ['Meeting', 'Shop Purchase', 'Stall', 'Transport', 'Food & Refreshments', 'Printing & Design', 'Event Setup', 'Other'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

const field = { width: '100%', padding: '10px 11px', border: '1px solid #d8d5cc', borderRadius: 9, background: '#fff', font: 'inherit' };
const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 14, padding: 16, boxShadow: 'var(--shadow-xs)' };

export default function Expenses() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [type, setType] = useState('employee');
  const [data, setData] = useState({ rows: [], totals: {}, grand_total: 0 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [warning, setWarning] = useState('');
  const [reviewQueue, setReviewQueue] = useState({ can_review: false, rows: [] });
  const billRef = useRef(null);
  const [form, setForm] = useState({
    expense_date: today(), category: EMPLOYEE_CATEGORIES[0], description: '', amount: '',
    location: '', travel_from: '', travel_to: '', distance_km: '', travel_mode: '', remarks: '', bill: null,
  });

  const categories = type === 'employee' ? EMPLOYEE_CATEGORIES : COMPANY_CATEGORIES;
  const rows = useMemo(() => data.rows || [], [data.rows]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await expensesAPI.list(year, month, type);
      setData(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to load expenses.');
    } finally { setLoading(false); }
  }, [year, month, type]);

  useEffect(() => { load(); }, [load]);

  const loadReviewQueue = useCallback(async () => {
    try {
      const response = await expensesAPI.reviewQueue();
      setReviewQueue(response.data);
    } catch (_) { setReviewQueue({ can_review: false, rows: [] }); }
  }, []);

  useEffect(() => { loadReviewQueue(); }, [loadReviewQueue]);

  const changeType = nextType => {
    setType(nextType);
    const nextCategories = nextType === 'employee' ? EMPLOYEE_CATEGORIES : COMPANY_CATEGORIES;
    setForm(current => ({ ...current, category: nextCategories[0] }));
    setError(''); setSuccess(''); setWarning('');
  };

  const setValue = (name, value) => setForm(current => ({ ...current, [name]: value }));

  const submit = async event => {
    event.preventDefault(); setSaving(true); setError(''); setSuccess(''); setWarning('');
    if (!form.bill) { setSaving(false); setError('Attach a bill for this expense line.'); return; }
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key !== 'bill' && value !== '' && value !== null) payload.append(key, value);
    });
    payload.append('expense_type', type);
    payload.append('bill', form.bill);
    try {
      const response = await expensesAPI.create(payload);
      const validation = response.data?.bill_validation;
      if (validation?.status === 'review_required') {
        setWarning(validation.reason);
      } else {
        setSuccess(`${type === 'employee' ? 'Employee' : 'Company'} expense saved. The bill and reported amount were validated.`);
      }
      setForm(current => ({ ...current, description: '', amount: '', location: '', travel_from: '', travel_to: '', distance_km: '', travel_mode: '', remarks: '', bill: null }));
      if (billRef.current) billRef.current.value = '';
      await load();
      await loadReviewQueue();
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to save this expense.');
    } finally { setSaving(false); }
  };

  const downloadBill = async row => {
    try {
      const response = await expensesAPI.downloadBill(row.id);
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url; link.download = row.bill_filename || 'bill'; link.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err.response?.data?.detail || 'Unable to download the bill.'); }
  };

  const remove = async row => {
    if (!window.confirm(`Delete ${row.description} and its attached bill?`)) return;
    try { await expensesAPI.delete(row.id); await load(); }
    catch (err) { setError(err.response?.data?.detail || 'Unable to delete the expense.'); }
  };

  const reviewBill = async (row, decision) => {
    const notes = window.prompt(decision === 'valid' ? 'Optional validation note' : 'Reason the bill is invalid');
    if (notes === null) return;
    try {
      await expensesAPI.reviewBill(row.id, decision, notes);
      setSuccess(decision === 'valid' ? 'Bill validated.' : 'Bill marked invalid.');
      setWarning(''); setError('');
      await loadReviewQueue();
      await load();
    } catch (err) { setError(err.response?.data?.detail || 'Unable to review the bill.'); }
  };

  const validationLabel = status => ({
    auto_validated: 'Bill validated', manager_validated: 'Manager validated',
    review_required: 'Manager review required', manager_rejected: 'Invalid bill',
  }[status] || 'Pending validation');

  const validationColor = status => status === 'review_required' || status === 'manager_rejected'
    ? { background: '#fff8d6', color: '#a05a00' }
    : { background: '#eaf5ea', color: '#2a6b2d' };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <div><h1 style={{ fontSize: 24, marginBottom: 4 }}>Monthly Expenses</h1><div style={{ color: 'var(--text-2)' }}>Record employee claims and company spending. Every line requires its own bill.</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={field}>{MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={field}>{[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(value => <option key={value}>{value}</option>)}</select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[['employee', 'Employee Expense'], ['company', 'Company Expense']].map(([value, label]) => <button key={value} onClick={() => changeType(value)} style={{ border: '1px solid', borderColor: type === value ? '#2a6b2d' : '#d8d5cc', background: type === value ? '#eaf5ea' : '#fff', color: type === value ? '#2a6b2d' : '#5c5a52', borderRadius: 10, padding: '10px 16px', fontWeight: 800, cursor: 'pointer' }}>{label}</button>)}
      </div>

      {(error || warning || success) && <div style={{ marginBottom: 12, padding: 11, borderRadius: 9, background: error ? '#fff0ef' : warning ? '#fff8d6' : '#eaf5ea', color: error ? '#b42318' : warning ? '#8a5200' : '#2a6b2d' }}>{error || warning || success}</div>}

      {reviewQueue.can_review && reviewQueue.rows.length > 0 && <div style={{ ...card, marginBottom: 16, borderColor: '#f5d060' }}>
        <h2 style={{ fontSize: 16, marginBottom: 3 }}>Bills requiring your validation</h2>
        <div style={{ color: 'var(--text-2)', fontSize: 12, marginBottom: 12 }}>These bills from your reporting employees could not be validated automatically.</div>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}><thead><tr style={{ textAlign: 'left', background: '#fff8d6' }}>{['Employee', 'Expense', 'Reported amount', 'Validation issue', 'Bill', 'Decision'].map(value => <th key={value} style={{ padding: 10, fontSize: 11 }}>{value}</th>)}</tr></thead><tbody>{reviewQueue.rows.map(row => <tr key={row.id} style={{ borderTop: '1px solid var(--border)' }}><td style={{ padding: 10 }}><strong>{row.employee_name}</strong><div style={{ fontSize: 11, color: 'var(--text-3)' }}>{row.expense_date}</div></td><td style={{ padding: 10 }}>{row.category}<div style={{ fontSize: 11 }}>{row.description}</div></td><td style={{ padding: 10, fontWeight: 900 }}>{money(row.amount)}</td><td style={{ padding: 10, maxWidth: 280, color: '#8a5200' }}>{row.bill_validation_reason}</td><td style={{ padding: 10 }}><button onClick={() => downloadBill(row)} style={{ border: 0, background: 'none', color: '#1a73e8', fontWeight: 700, cursor: 'pointer' }}>View bill</button></td><td style={{ padding: 10, whiteSpace: 'nowrap' }}><button onClick={() => reviewBill(row, 'valid')} style={{ border: 0, borderRadius: 7, padding: '7px 9px', background: '#2a6b2d', color: '#fff', fontWeight: 700, cursor: 'pointer', marginRight: 6 }}>Valid</button><button onClick={() => reviewBill(row, 'invalid')} style={{ border: '1px solid #f4a9a5', borderRadius: 7, padding: '7px 9px', background: '#fff0ef', color: '#b42318', fontWeight: 700, cursor: 'pointer' }}>Invalid</button></td></tr>)}</tbody></table></div>
      </div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 390px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }} className="expenses-grid">
        <form onSubmit={submit} style={card}>
          <h2 style={{ fontSize: 16, marginBottom: 3 }}>Add {type === 'employee' ? 'employee' : 'company'} expense</h2>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 14 }}>{type === 'employee' ? 'Travel, daily allowance, courier, food, and other monthly claims.' : 'Meetings, shop purchases, events, stalls, transport, food, and other company costs.'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label>Date<input required type="date" value={form.expense_date} onChange={e => setValue('expense_date', e.target.value)} style={field} /></label>
            <label>Category<select required value={form.category} onChange={e => setValue('category', e.target.value)} style={field}>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
          </div>
          <label>Description<input required maxLength="300" value={form.description} onChange={e => setValue('description', e.target.value)} placeholder={type === 'employee' ? 'Purpose of the claim' : 'Meeting, shop, or event expense'} style={field} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label>Amount (₹)<input required type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setValue('amount', e.target.value)} style={field} /></label>
            <label>Location<input value={form.location} onChange={e => setValue('location', e.target.value)} placeholder="City / venue / shop" style={field} /></label>
          </div>
          {type === 'employee' && <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><label>Travel from<input value={form.travel_from} onChange={e => setValue('travel_from', e.target.value)} style={field} /></label><label>Travel to<input value={form.travel_to} onChange={e => setValue('travel_to', e.target.value)} style={field} /></label></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><label>Distance (km)<input type="number" min="0" step="0.1" value={form.distance_km} onChange={e => setValue('distance_km', e.target.value)} style={field} /></label><label>Travel mode<input value={form.travel_mode} onChange={e => setValue('travel_mode', e.target.value)} placeholder="Train, cab, bus…" style={field} /></label></div>
          </>}
          <label>Remarks<textarea rows="2" maxLength="500" value={form.remarks} onChange={e => setValue('remarks', e.target.value)} style={{ ...field, resize: 'vertical' }} /></label>
          <label>Bill attachment <span style={{ color: '#d93025' }}>*</span><input ref={billRef} required type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={e => setValue('bill', e.target.files?.[0] || null)} style={field} /><span style={{ display: 'block', color: 'var(--text-3)', fontSize: 11, marginTop: 3 }}>PDF, JPG, PNG, or WebP. Maximum 10 MB.</span></label>
          <button disabled={saving} type="submit" style={{ width: '100%', border: 0, borderRadius: 10, padding: 11, background: saving ? '#94a3b8' : '#2a6b2d', color: '#fff', fontWeight: 900, cursor: saving ? 'wait' : 'pointer', marginTop: 8 }}>{saving ? 'Saving…' : 'Save expense and bill'}</button>
        </form>

        <div>
          <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}><div><div style={{ color: 'var(--text-2)', fontSize: 12 }}>{MONTHS[month - 1]} {year}</div><div style={{ fontSize: 22, fontWeight: 900 }}>{money(data.totals?.[type])}</div></div><div style={{ textAlign: 'right', color: 'var(--text-2)' }}><strong>{rows.length}</strong><br />line item{rows.length === 1 ? '' : 's'}</div></div>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            {loading ? <div style={{ padding: 24 }}>Loading expenses…</div> : rows.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-2)' }}>No {type} expenses recorded for this month.</div> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}><thead><tr style={{ background: '#f7f6f2', textAlign: 'left' }}>{['Date', 'Category and details', 'Amount', 'Bill', 'Bill validation', ''].map(value => <th key={value} style={{ padding: '11px 12px', fontSize: 11, color: 'var(--text-2)', borderBottom: '1px solid var(--border)' }}>{value}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: 12, whiteSpace: 'nowrap' }}>{new Date(`${row.expense_date}T00:00:00`).toLocaleDateString('en-IN')}</td><td style={{ padding: 12 }}><strong>{row.category}</strong><div>{row.description}</div><div style={{ color: 'var(--text-3)', fontSize: 11 }}>{[row.location, row.travel_from && row.travel_to ? `${row.travel_from} to ${row.travel_to}` : '', row.travel_mode].filter(Boolean).join(' · ')}</div></td><td style={{ padding: 12, fontWeight: 900, whiteSpace: 'nowrap' }}>{money(row.amount)}</td><td style={{ padding: 12 }}><button onClick={() => downloadBill(row)} style={{ border: 0, background: 'none', color: '#1a73e8', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>{row.bill_filename}</button></td><td style={{ padding: 12, minWidth: 180 }}><span style={{ ...validationColor(row.bill_validation_status), display: 'inline-block', borderRadius: 20, padding: '4px 8px', fontSize: 11, fontWeight: 800 }}>{validationLabel(row.bill_validation_status)}</span>{row.bill_validation_reason && <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 4 }}>{row.bill_validation_reason}</div>}</td><td style={{ padding: 12 }}><button onClick={() => remove(row)} aria-label="Delete expense" style={{ border: '1px solid #f4a9a5', background: '#fff0ef', color: '#b42318', borderRadius: 7, padding: '6px 9px', cursor: 'pointer' }}>Delete</button></td></tr>)}</tbody></table></div>}
          </div>
        </div>
      </div>
      <style>{`label{display:block;font-size:12px;font-weight:700;color:#5c5a52;margin-bottom:10px} label input,label select,label textarea{display:block;margin-top:4px;color:#1a1a1a;font-weight:400}@media(max-width:900px){.expenses-grid{grid-template-columns:1fr!important}}`}</style>
    </div>
  );
}
