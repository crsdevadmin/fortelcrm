import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { reportsAPI } from '../api';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtInr(value) {
  const amount = Number(value) || 0;
  if (Math.abs(amount) >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (Math.abs(amount) >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (Math.abs(amount) >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

function previousCompletedWeek(today = new Date()) {
  let year = today.getFullYear();
  let month = today.getMonth() + 1;
  const currentWeek = Math.min(4, Math.max(1, Math.floor((today.getDate() - 1) / 7) + 1));
  let week = currentWeek - 1;
  if (week < 1) {
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
    week = 4;
  }
  return { year, month, week };
}

function SummaryCard({ label, value, detail, accent = '#0F6E56', delta }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderTop: `3px solid ${accent}`, borderRadius: 12, padding: '13px 15px' }}>
      <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: .5, fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 900, color: accent, marginTop: 5 }}>{value}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 7, marginTop: 4 }}>
        <span style={{ fontSize: 9, color: '#94a3b8' }}>{detail}</span>
        {delta != null && <span style={{ fontSize: 9, fontWeight: 800, color: delta >= 0 ? '#047857' : '#b91c1c' }}>{delta >= 0 ? '+' : ''}{delta}%</span>}
      </div>
    </div>
  );
}

export default function WeeklyReports() {
  const { user } = useAuth();
  const initial = previousCompletedWeek();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [week, setWeek] = useState(initial.week);
  const [scope, setScope] = useState('overall');
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadReport = useCallback(async (refresh = false) => {
    if (!user?.id) return;
    setLoading(true);
    setError('');
    try {
      const response = await reportsAPI.weekly({ viewer_id: user.id, year, month, week, scope, refresh });
      setReport(response.data || null);
      const historyResponse = await reportsAPI.history(user.id, scope);
      setHistory(historyResponse.data || []);
    } catch (err) {
      setReport(null);
      setError(err.response?.data?.detail || 'Unable to generate this weekly report.');
    } finally {
      setLoading(false);
    }
  }, [user?.id, year, month, week, scope]);

  useEffect(() => { loadReport(false); }, [loadReport]);

  const previous = useMemo(() => history.find(item => (
    item.report_id !== report?.report_id
    && (item.year < year || (item.year === year && item.month < month) || (item.year === year && item.month === month && item.week < week))
  )), [history, report?.report_id, year, month, week]);
  const deltaPct = (current, prior) => {
    const a = Number(current) || 0;
    const b = Number(prior) || 0;
    if (!previous || b === 0) return null;
    return Math.round(((a - b) / Math.abs(b)) * 100);
  };
  const summary = report?.summary || {};
  const priorSummary = previous?.summary || {};
  const statusColors = { green: '#047857', amber: '#b45309', red: '#b91c1c' };
  const statusBgs = { green: '#ecfdf5', amber: '#fffbeb', red: '#fef2f2' };

  const changeMonth = delta => {
    let nextYear = year;
    let nextMonth = month + delta;
    if (nextMonth < 1) { nextMonth = 12; nextYear -= 1; }
    if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
    const now = new Date();
    if (nextYear > now.getFullYear() || (nextYear === now.getFullYear() && nextMonth > now.getMonth() + 1)) return;
    const completed = previousCompletedWeek(now);
    const nextWeek = nextYear === completed.year && nextMonth === completed.month ? completed.week : 4;
    setYear(nextYear); setMonth(nextMonth); setWeek(nextWeek);
  };

  const downloadPdf = async () => {
    if (!report?.report_id) return;
    try {
      const response = await reportsAPI.downloadPdf(report.report_id);
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Fortel_Weekly_Report_${year}_${String(month).padStart(2, '0')}_W${week}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.detail || 'Unable to download this report PDF.');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', padding: '22px 24px 42px' }}>
      <div style={{ background: 'linear-gradient(135deg,#0f2027,#203a43,#2c5364)', borderRadius: 18, padding: '20px 22px', color: '#fff', marginBottom: 18, boxShadow: '0 8px 28px rgba(15,32,39,.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 9, opacity: .55, fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase' }}>Management Reporting</div>
            <div style={{ fontSize: 23, fontWeight: 900, marginTop: 4 }}>Weekly Management Report</div>
            <div style={{ fontSize: 10, opacity: .65, marginTop: 4 }}>Saved weekly snapshots · comparison · PDF download · management actions</div>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {['overall', 'mine', 'team'].map(value => (
              <button key={value} onClick={() => setScope(value)} style={{ border: scope === value ? '1px solid #F5B800' : '1px solid rgba(255,255,255,.2)', background: scope === value ? 'rgba(245,184,0,.22)' : 'rgba(255,255,255,.08)', color: scope === value ? '#FDE68A' : '#fff', borderRadius: 9, padding: '7px 11px', fontSize: 10, fontWeight: 900, cursor: 'pointer' }}>
                {value === 'overall' ? 'Overall' : value === 'mine' ? 'My Business' : 'My Team'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginTop: 17 }}>
          <button onClick={() => changeMonth(-1)} style={{ border: 'none', background: 'rgba(255,255,255,.1)', color: '#fff', borderRadius: 8, padding: '7px 11px', cursor: 'pointer' }}>‹</button>
          <span style={{ minWidth: 85, textAlign: 'center', fontSize: 12, fontWeight: 900 }}>{MONTHS[month]} {year}</span>
          <button onClick={() => changeMonth(1)} style={{ border: 'none', background: 'rgba(255,255,255,.1)', color: '#fff', borderRadius: 8, padding: '7px 11px', cursor: 'pointer' }}>›</button>
          {[1, 2, 3, 4].map(value => <button key={value} onClick={() => setWeek(value)} style={{ border: week === value ? '1px solid #9FE1CB' : '1px solid rgba(255,255,255,.18)', background: week === value ? 'rgba(15,110,86,.7)' : 'rgba(255,255,255,.07)', color: '#fff', borderRadius: 8, padding: '7px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>Week {value}</button>)}
          <button onClick={() => loadReport(true)} disabled={loading} style={{ marginLeft: 'auto', border: '1px solid rgba(255,255,255,.25)', background: 'rgba(255,255,255,.12)', color: '#fff', borderRadius: 9, padding: '7px 11px', fontSize: 10, fontWeight: 900, cursor: loading ? 'wait' : 'pointer' }}>↻ Refresh snapshot</button>
          {report?.report_id && <button onClick={downloadPdf} style={{ border: 'none', background: '#F5B800', color: '#3b2f00', borderRadius: 9, padding: '8px 12px', fontSize: 10, fontWeight: 900, cursor: 'pointer' }}>Download PDF</button>}
        </div>
      </div>

      {loading ? <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>Generating and saving weekly report…</div> : error ? (
        <div style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 12, padding: 18 }}>{error}</div>
      ) : report && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: '#64748b' }}><strong>{report.week_start}</strong> to <strong>{report.week_end}</strong> · saved {new Date(report.saved_at).toLocaleString('en-IN')}</div>
            {previous && <div style={{ fontSize: 9, color: '#64748b', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 20, padding: '4px 9px' }}>Compared with {MONTHS[previous.month]} Week {previous.week}</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(175px,1fr))', gap: 10, marginBottom: 18 }}>
            <SummaryCard label="Regional Sales" value={fmtInr(summary.regional_week)} detail={`MTD ${fmtInr(summary.regional_mtd)}`} accent="#2563eb" delta={deltaPct(summary.regional_week, priorSummary.regional_week)} />
            <SummaryCard label="Doctor-wise Sales" value={fmtInr(summary.doctor_week)} detail={`MTD ${fmtInr(summary.doctor_mtd)}`} accent="#047857" delta={deltaPct(summary.doctor_week, priorSummary.doctor_week)} />
            <SummaryCard label="Investment" value={fmtInr(summary.investment_week)} detail="Entered this week" accent="#c2410c" delta={deltaPct(summary.investment_week, priorSummary.investment_week)} />
            <SummaryCard label="Doctor Visits" value={summary.visits_week || 0} detail="Visits this week" accent="#7c3aed" delta={deltaPct(summary.visits_week, priorSummary.visits_week)} />
            <SummaryCard label="Tasks Completed" value={`${summary.tasks_completed || 0}/${summary.tasks_total || 0}`} detail={`${summary.overdue_tasks || 0} overdue`} accent="#0f766e" />
            <SummaryCard label="Required Actions" value={summary.actions || 0} detail={`${summary.status_counts?.red || 0} immediate follow-up`} accent="#b91c1c" />
          </div>

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', marginBottom: 18 }}>
            <div style={{ padding: '13px 15px', fontSize: 13, fontWeight: 900, borderBottom: '1px solid #e5e7eb' }}>Territory Performance</div>
            <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#f8fafc' }}>{['Territory', 'Regional Week', 'Regional MTD', 'Doctor Week', 'Doctor MTD', 'Investment', 'Visits', 'Doctors'].map(label => <th key={label} style={{ padding: 9, textAlign: 'left', fontSize: 8, color: '#64748b', textTransform: 'uppercase' }}>{label}</th>)}</tr></thead>
              <tbody>{(report.territories || []).map(row => <tr key={row.territory} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: 10, fontSize: 11, fontWeight: 900 }}>{row.territory}</td><td style={{ padding: 10, fontSize: 10, color: '#2563eb', fontWeight: 800 }}>{fmtInr(row.regional_week)}</td><td style={{ padding: 10, fontSize: 10 }}>{fmtInr(row.regional_mtd)}</td><td style={{ padding: 10, fontSize: 10, color: '#047857', fontWeight: 800 }}>{fmtInr(row.doctor_week)}</td><td style={{ padding: 10, fontSize: 10 }}>{fmtInr(row.doctor_mtd)}</td><td style={{ padding: 10, fontSize: 10 }}>{fmtInr(row.investment_week)}</td><td style={{ padding: 10, fontSize: 10 }}>{row.visits_week}</td><td style={{ padding: 10, fontSize: 10 }}>{row.active_doctors}</td>
              </tr>)}</tbody>
            </table></div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', marginBottom: 18 }}>
            <div style={{ padding: '13px 15px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e5e7eb' }}><span style={{ fontSize: 13, fontWeight: 900 }}>Team Scorecard</span><span style={{ fontSize: 9, color: '#64748b' }}>{summary.status_counts?.green || 0} green · {summary.status_counts?.amber || 0} amber · {summary.status_counts?.red || 0} red</span></div>
            <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#f8fafc' }}>{['Rank', 'Person', 'Score', 'Status', 'Doctor Sales', 'Regional Sales', 'Recovery', 'Visits', 'Weekly', 'Tasks'].map(label => <th key={label} style={{ padding: 9, textAlign: 'left', fontSize: 8, color: '#64748b', textTransform: 'uppercase' }}>{label}</th>)}</tr></thead>
              <tbody>{(report.people || []).map((person, index) => <tr key={person.user_id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: 10, fontSize: 10, color: '#94a3b8' }}>{index + 1}</td><td style={{ padding: 10 }}><div style={{ fontSize: 10, fontWeight: 900 }}>{person.name}</div><div style={{ fontSize: 8, color: '#94a3b8' }}>{person.display_role}</div></td><td style={{ padding: 10, fontSize: 13, fontWeight: 900, color: statusColors[person.status] }}>{person.score}</td><td style={{ padding: 10 }}><span style={{ fontSize: 8, fontWeight: 900, color: statusColors[person.status], background: statusBgs[person.status], borderRadius: 12, padding: '3px 7px' }}>{person.status.toUpperCase()}</span></td><td style={{ padding: 10, fontSize: 10 }}>{person.doctor_count ? `${person.doctor_sales_pct}%` : 'N/A'}</td><td style={{ padding: 10, fontSize: 10 }}>{person.regional_required ? `${person.regional_sales_pct}%` : 'N/A'}</td><td style={{ padding: 10, fontSize: 10 }}>{person.recovery_expected ? `${person.recovery_pct}%` : 'N/A'}</td><td style={{ padding: 10, fontSize: 10 }}>{person.visit_coverage_pct}%</td><td style={{ padding: 10, fontSize: 10 }}>{person.weekly_score}%</td><td style={{ padding: 10, fontSize: 10 }}>{person.task_score}%</td>
              </tr>)}</tbody>
            </table></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
            <div style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: 14, padding: '14px 16px' }}><div style={{ fontSize: 13, fontWeight: 900, color: '#991b1b', marginBottom: 10 }}>Management Actions</div>{(report.actions || []).length ? report.actions.slice(0, 15).map((action, index) => <div key={`${action.person}-${action.reason}-${index}`} style={{ padding: '7px 0', borderTop: '1px solid #fee2e2', display: 'flex', justifyContent: 'space-between', gap: 10 }}><span style={{ fontSize: 10 }}><strong>{action.person}</strong> · {action.reason}</span><span style={{ fontSize: 8, fontWeight: 900, color: statusColors[action.status] }}>{action.status.toUpperCase()}</span></div>) : <div style={{ color: '#047857', fontSize: 11 }}>No immediate actions</div>}</div>
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '14px 16px' }}><div style={{ fontSize: 13, fontWeight: 900, marginBottom: 9 }}>Top Doctors</div>{(report.top_doctors || []).map((row, index) => <div key={`${row.name}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #f1f5f9', fontSize: 10 }}><span>{index + 1}. {row.name} <span style={{ color: '#94a3b8' }}>· {row.city}</span></span><strong style={{ color: '#047857' }}>{fmtInr(row.sales)}</strong></div>)}</div>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '14px 16px' }}><div style={{ fontSize: 13, fontWeight: 900, marginBottom: 9 }}>Top Products</div>{(report.top_products || []).map((row, index) => <div key={`${row.name}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #f1f5f9', fontSize: 10 }}><span>{index + 1}. {row.name} <span style={{ color: '#94a3b8' }}>· Qty {row.qty}</span></span><strong style={{ color: '#2563eb' }}>{fmtInr(row.sales)}</strong></div>)}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
