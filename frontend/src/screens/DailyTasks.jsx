import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { tasksAPI } from '../api';
import { useAuth } from '../context/AuthContext';

const API = process.env.REACT_APP_API_URL || '';
const MANAGER_ROLES = new Set(['admin', 'md', 'director', 'senior_manager', 'manager']);

const todayIso = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16 };
const input = { width: '100%', boxSizing: 'border-box', padding: '10px 11px', border: '1px solid #d1d5db', borderRadius: 9, background: '#fff', fontSize: 13, color: '#111827' };
const label = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 10, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 };

export default function DailyTasks() {
  const { user } = useAuth();
  const [canAssign, setCanAssign] = useState(MANAGER_ROLES.has(user?.role));
  const draftKey = `fortel_task_draft_${user?.id || 'user'}`;
  const [assignees, setAssignees] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [filterDate, setFilterDate] = useState(todayIso());
  const [statusFilter, setStatusFilter] = useState('all');
  const [form, setForm] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) || '{}');
      return { assigned_to_id: '', doctor_id: '', task_date: todayIso(), details: '', ...saved };
    } catch (_) {
      return { assigned_to_id: '', doctor_id: '', task_date: todayIso(), details: '' };
    }
  });
  const [completion, setCompletion] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [duplicateTask, setDuplicateTask] = useState(null);

  const loadTasks = useCallback(() => {
    if (!user?.id) return;
    setLoading(true);
    tasksAPI.list(user.id, { task_date: filterDate || undefined, status: statusFilter })
      .then(res => {
        const rows = Array.isArray(res.data) ? res.data : [];
        setTasks(rows);
        if (user.role === 'rep') {
          rows.filter(task => !task.is_read).forEach(task => tasksAPI.markRead(task.id, user.id).catch(() => {}));
        }
      })
      .catch(err => setError(err?.response?.data?.detail || 'Unable to load tasks'))
      .finally(() => setLoading(false));
  }, [user?.id, user?.role, filterDate, statusFilter]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  useEffect(() => {
    if (!user?.id) return;
    setCanAssign(MANAGER_ROLES.has(user.role));
    tasksAPI.assignees(user.id).then(async assigneeRes => {
      const reps = Array.isArray(assigneeRes.data) ? assigneeRes.data : [];
      const doctorRes = await axios.get(`${API}/doctors/`, { params: { viewer_id: user.id, include_inactive: false } });
      const doctorList = Array.isArray(doctorRes.data) ? doctorRes.data : [];
      setCanAssign(true);
      setAssignees(reps);
      setDoctors(doctorList);
      setForm(prev => ({ ...prev, assigned_to_id: prev.assigned_to_id || String(reps[0]?.id || '') }));
    }).catch(err => {
      if (err?.response?.status === 403) {
        setCanAssign(false);
        setAssignees([]);
        setDoctors([]);
        return;
      }
      setError(err?.response?.data?.detail || 'Unable to load representatives and doctors');
    });
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!canAssign) return;
    localStorage.setItem(draftKey, JSON.stringify(form));
  }, [form, canAssign, draftKey]);

  const selectedDoctor = (Array.isArray(doctors) ? doctors : []).find(doctor => String(doctor.id) === String(form.doctor_id));
  const duplicatePreview = useMemo(() => (Array.isArray(tasks) ? tasks : []).find(task =>
    String(task.assigned_to_id) === String(form.assigned_to_id)
    && String(task.doctor_id) === String(form.doctor_id)
    && task.task_date === form.task_date
    && (task.details || '').trim().toLowerCase().replace(/\s+/g, ' ') === form.details.trim().toLowerCase().replace(/\s+/g, ' ')
  ), [tasks, form]);

  const updateForm = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setDuplicateTask(null);
    setMessage('');
    setError('');
  };

  const assignTask = async (event) => {
    event.preventDefault();
    if (!form.assigned_to_id || !form.doctor_id || !form.task_date || !form.details.trim()) {
      setError('Representative, doctor, date and task details are required.');
      return;
    }
    if (duplicatePreview) {
      setDuplicateTask(duplicatePreview);
      setError('This task is already assigned. The existing task is shown below.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await tasksAPI.create({
        assigned_by_id: user.id,
        assigned_to_id: Number(form.assigned_to_id),
        doctor_id: Number(form.doctor_id),
        task_date: form.task_date,
        details: form.details.trim(),
      });
      if (res.data?.duplicate) {
        setDuplicateTask(res.data.task);
        setError('This task was already assigned. The existing task is shown below.');
      } else {
        setMessage(`Task assigned to ${res.data?.task?.assigned_to_name || 'representative'}.`);
        setForm(prev => ({ ...prev, doctor_id: '', details: '' }));
        localStorage.removeItem(draftKey);
        loadTasks();
      }
    } catch (err) {
      setError(err?.response?.data?.detail || 'Unable to assign task');
    } finally {
      setSaving(false);
    }
  };

  const completeTask = async (task) => {
    const comments = (completion[task.id] || '').trim();
    if (!comments) {
      setError('Enter completion comments before finishing the task.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await tasksAPI.complete(task.id, user.id, comments);
      setCompletion(prev => ({ ...prev, [task.id]: '' }));
      setMessage('Task marked as completed.');
      loadTasks();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Unable to complete task');
    } finally {
      setSaving(false);
    }
  };

  const renderTask = task => {
    const done = task.status === 'completed';
    return (
      <div key={task.id} style={{ ...card, borderLeft: `4px solid ${done ? '#22c55e' : '#f59e0b'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#111827' }}>{task.doctor_name}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{[task.hospital, task.city].filter(Boolean).join(' · ')}</div>
          </div>
          <span style={{ padding: '4px 9px', borderRadius: 999, fontSize: 10, fontWeight: 900, background: done ? '#dcfce7' : '#fef3c7', color: done ? '#166534' : '#92400e', textTransform: 'uppercase' }}>{task.status}</span>
        </div>
        <div style={{ marginTop: 12, padding: 11, borderRadius: 9, background: '#f9fafb', color: '#374151', fontSize: 13, lineHeight: 1.5 }}>{task.details}</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: 11, color: '#6b7280' }}>
          <span><strong>Date:</strong> {task.task_date}</span>
          <span><strong>Rep:</strong> {task.assigned_to_name}</span>
          <span><strong>Assigned by:</strong> {task.assigned_by_name}</span>
        </div>
        {done && task.completion_comments && (
          <div style={{ marginTop: 10, padding: 10, background: '#f0fdf4', borderRadius: 9, color: '#166534', fontSize: 12 }}><strong>Completion comments:</strong> {task.completion_comments}</div>
        )}
        {!canAssign && !done && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <textarea value={completion[task.id] || ''} onChange={e => setCompletion(prev => ({ ...prev, [task.id]: e.target.value }))}
              placeholder="Enter completion comments..." rows={2} style={{ ...input, flex: 1, minWidth: 240, resize: 'vertical' }} />
            <button onClick={() => completeTask(task)} disabled={saving}
              style={{ border: 'none', borderRadius: 9, background: '#0F6E56', color: '#fff', padding: '10px 16px', fontWeight: 900, cursor: saving ? 'default' : 'pointer' }}>Mark Completed</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '20px 24px 40px', maxWidth: 1280 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 23, fontWeight: 900, color: '#111827' }}>Daily Tasks</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{user?.role === 'md' ? 'Assign tasks and review tasks assigned by every manager.' : canAssign ? 'Assign doctor-specific daily work to representatives.' : 'Review and complete tasks assigned by your manager.'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ ...input, width: 150 }} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...input, width: 140 }}>
            <option value="all">All Status</option><option value="pending">Pending</option><option value="completed">Completed</option>
          </select>
          <button onClick={() => setFilterDate('')} style={{ border: '1px solid #d1d5db', borderRadius: 9, background: '#fff', padding: '9px 12px', fontWeight: 800, cursor: 'pointer' }}>All Dates</button>
        </div>
      </div>

      {error && <div style={{ marginBottom: 12, padding: 11, borderRadius: 9, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 13 }}>{error}</div>}
      {message && <div style={{ marginBottom: 12, padding: 11, borderRadius: 9, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontSize: 13 }}>{message}</div>}

      {canAssign && (
        <form onSubmit={assignTask} style={{ ...card, marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#111827', marginBottom: 12 }}>Assign a Task</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(240px, 1.4fr) minmax(150px, .7fr)', gap: 10 }}>
            <label style={label}>Representative<select value={form.assigned_to_id} onChange={e => updateForm('assigned_to_id', e.target.value)} style={input}><option value="">Select rep</option>{assignees.map(rep => <option key={rep.id} value={rep.id}>{rep.name}{rep.display_role ? ` — ${rep.display_role}` : ''}</option>)}</select></label>
            <label style={label}>Doctor / Hospital<select value={form.doctor_id} onChange={e => updateForm('doctor_id', e.target.value)} style={input}><option value="">Select doctor</option>{doctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.hospital ? ` — ${doctor.hospital}` : ''}</option>)}</select></label>
            <label style={label}>Task Date<input type="date" value={form.task_date} onChange={e => updateForm('task_date', e.target.value)} style={input} /></label>
          </div>
          {selectedDoctor && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8 }}>Selected: {selectedDoctor.name} · {[selectedDoctor.hospital, selectedDoctor.city].filter(Boolean).join(' · ')}</div>}
          <label style={{ ...label, marginTop: 12 }}>Task Details<textarea value={form.details} onChange={e => updateForm('details', e.target.value)} rows={3} placeholder="Example: Meet the doctor, discuss product feedback and record next action." style={{ ...input, resize: 'vertical' }} /></label>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Draft is saved automatically on this device. Duplicate tasks are checked again on the server.</div>
            <button type="submit" disabled={saving} style={{ border: 'none', borderRadius: 9, background: '#0F6E56', color: '#fff', padding: '10px 18px', fontWeight: 900, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Assigning...' : 'Assign Task'}</button>
          </div>
        </form>
      )}

      {duplicateTask && <div style={{ marginBottom: 14 }}><div style={{ fontSize: 12, fontWeight: 900, color: '#92400e', marginBottom: 7 }}>Existing matching task</div>{renderTask(duplicateTask)}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}><div style={{ fontSize: 15, fontWeight: 900, color: '#111827' }}>{filterDate ? `Tasks for ${filterDate}` : 'All Tasks'}</div><div style={{ fontSize: 12, color: '#6b7280' }}>{tasks.length} task{tasks.length === 1 ? '' : 's'}</div></div>
      {loading ? <div style={{ ...card, textAlign: 'center', color: '#6b7280' }}>Loading tasks...</div> : tasks.length ? <div style={{ display: 'grid', gap: 10 }}>{tasks.map(renderTask)}</div> : <div style={{ ...card, textAlign: 'center', color: '#6b7280' }}>No tasks found for this selection.</div>}
    </div>
  );
}
