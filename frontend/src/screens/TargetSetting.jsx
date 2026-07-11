import React, { useEffect, useMemo, useState } from 'react';
import { targetsAPI } from '../api';
import { useAuth } from '../context/AuthContext';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CUR_YEAR = new Date().getFullYear();
const CUR_MONTH = new Date().getMonth() + 1;

const fmtInr = (value) => {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

const fmtNum = (value) => {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toFixed(1);
};

export default function TargetSetting() {
  const { user } = useAuth();
  const [year, setYear] = useState(CUR_YEAR);
  const [month, setMonth] = useState(CUR_MONTH);
  const [assignees, setAssignees] = useState([]);
  const [ownerId, setOwnerId] = useState('');
  const [context, setContext] = useState(null);
  const [rows, setRows] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const isMd = user?.role === 'md';

  useEffect(() => {
    if (!user?.id || !isMd) return;
    setLoadingUsers(true);
    targetsAPI.assignees(user.id)
      .then(res => {
        const list = res.data || [];
        setAssignees(list);
        if (list.length && !ownerId) setOwnerId(String(list[0].id));
      })
      .catch(err => setError(err?.response?.data?.detail || 'Failed to load managers and reps'))
      .finally(() => setLoadingUsers(false));
  }, [user?.id, isMd]);

  useEffect(() => {
    if (!user?.id || !ownerId || !isMd) return;
    setLoadingRows(true);
    setError('');
    setMessage('');
    targetsAPI.context(user.id, Number(ownerId), year, month)
      .then(res => {
        setContext(res.data);
        setRows((res.data?.products || []).map(row => ({
          ...row,
          target_units: row.target_units || '',
          target_value: row.target_value || '',
        })));
      })
      .catch(err => setError(err?.response?.data?.detail || 'Failed to load target context'))
      .finally(() => setLoadingRows(false));
  }, [user?.id, ownerId, year, month, isMd]);

  const totals = useMemo(() => rows.reduce((acc, row) => {
    acc.avgUnits += Number(row.avg_units) || 0;
    acc.avgValue += Number(row.avg_value) || 0;
    acc.targetUnits += Number(row.target_units) || 0;
    acc.targetValue += Number(row.target_value) || 0;
    return acc;
  }, { avgUnits: 0, avgValue: 0, targetUnits: 0, targetValue: 0 }), [rows]);

  const updateRow = (productId, field, value) => {
    setRows(prev => prev.map(row => {
      if (row.product_id !== productId) return row;
      const next = { ...row, [field]: value };
      if (field === 'target_units') {
        const units = Number(value) || 0;
        const rate = Number(row.rate) || 0;
        next.target_value = units && rate ? Math.round(units * rate) : '';
      }
      return next;
    }));
  };

  const copyAverage = () => {
    setRows(prev => prev.map(row => ({
      ...row,
      target_units: row.avg_units ? Math.round(Number(row.avg_units)) : '',
      target_value: row.avg_value ? Math.round(Number(row.avg_value)) : '',
    })));
  };

  const increaseBy = (pct) => {
    setRows(prev => prev.map(row => {
      const units = Math.round((Number(row.avg_units) || 0) * (1 + pct / 100));
      const value = Math.round((Number(row.avg_value) || 0) * (1 + pct / 100));
      return { ...row, target_units: units || '', target_value: value || '' };
    }));
  };

  const saveTargets = async () => {
    if (!ownerId) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        actor_id: user.id,
        owner_user_id: Number(ownerId),
        year,
        month,
        items: rows.map(row => ({
          product_id: row.product_id,
          target_units: Number(row.target_units) || 0,
          target_value: Number(row.target_value) || 0,
        })),
      };
      const res = await targetsAPI.save(payload);
      setMessage(`${res.data?.targets_saved || 0} product targets saved for ${context?.owner?.name || 'selected user'}.`);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to save targets');
    } finally {
      setSaving(false);
    }
  };

  if (!isMd) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24, color: '#991b1b' }}>
          Target setting is available only for MD.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 24px 40px', maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#111827' }}>Target Setting</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
            Set product-wise monthly targets using last 3 months average units and sales.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            style={{ padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff' }}>
            {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            style={{ padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff' }}>
            {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 420px) repeat(4, minmax(130px, 1fr))', gap: 10, alignItems: 'end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase' }}>
            Manager / Rep
            <select value={ownerId} onChange={e => setOwnerId(e.target.value)} disabled={loadingUsers}
              style={{ padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', fontSize: 13, color: '#111827' }}>
              {assignees.map(u => (
                <option key={u.id} value={u.id}>{u.name} - {u.display_role || u.role}</option>
              ))}
            </select>
          </label>
          {[
            ['3M Avg Units', fmtNum(totals.avgUnits)],
            ['3M Avg Sales', fmtInr(totals.avgValue)],
            ['Target Units', fmtNum(totals.targetUnits)],
            ['Target Value', fmtInr(totals.targetValue)],
          ].map(([label, value]) => (
            <div key={label} style={{ background: '#f9fafb', border: '1px solid #eef2f7', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#111827', marginTop: 3 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={copyAverage}
          style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
          Copy 3M Average
        </button>
        {[10, 15, 20].map(pct => (
          <button key={pct} onClick={() => increaseBy(pct)}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
            Avg +{pct}%
          </button>
        ))}
        <button onClick={saveTargets} disabled={saving || loadingRows}
          style={{ marginLeft: 'auto', padding: '9px 16px', border: 'none', borderRadius: 9, background: saving ? '#9ca3af' : '#0F6E56', color: '#fff', cursor: saving ? 'default' : 'pointer', fontWeight: 800 }}>
          {saving ? 'Saving...' : 'Save Targets'}
        </button>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, padding: 12, marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 10, padding: 12, marginBottom: 12 }}>{message}</div>}

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(5, minmax(110px, 0.8fr))', gap: 0, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: 11, fontWeight: 800, color: '#4b5563', textTransform: 'uppercase' }}>
          {['Product', 'Rate', 'Avg Units', 'Avg Sales', 'Target Units', 'Target Value'].map(h => (
            <div key={h} style={{ padding: '10px 12px' }}>{h}</div>
          ))}
        </div>

        {loadingRows ? (
          <div style={{ padding: 44, textAlign: 'center', color: '#6b7280' }}>Loading target data...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 44, textAlign: 'center', color: '#6b7280' }}>No active products found.</div>
        ) : rows.map(row => (
          <div key={row.product_id} style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(5, minmax(110px, 0.8fr))', borderBottom: '1px solid #f3f4f6', alignItems: 'center' }}>
            <div style={{ padding: '10px 12px', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.product_name}</div>
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                {(row.last_3_months || []).map(m => `${MONTHS[m.month]} ${fmtNum(m.units)}u`).join(' | ')}
              </div>
            </div>
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#4b5563' }}>{fmtInr(row.rate)}</div>
            <div style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700 }}>{fmtNum(row.avg_units)}</div>
            <div style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700 }}>{fmtInr(row.avg_value)}</div>
            <div style={{ padding: '10px 12px' }}>
              <input type="number" min="0" value={row.target_units}
                onChange={e => updateRow(row.product_id, 'target_units', e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 9px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }} />
            </div>
            <div style={{ padding: '10px 12px' }}>
              <input type="number" min="0" value={row.target_value}
                onChange={e => updateRow(row.product_id, 'target_value', e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 9px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
