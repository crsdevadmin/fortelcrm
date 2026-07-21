import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { tasksAPI } from '../api';
import { useAuth } from '../context/AuthContext';

const API = process.env.REACT_APP_API_URL || '';
const MANAGER_ROLES = new Set(['admin', 'md', 'director', 'senior_manager', 'manager']);
const NORMALIZE = value => (value || '').replace(/\s+/g, '').toLowerCase();
const STATE_NAMES = {
  tn: 'Tamil Nadu', tamilnadu: 'Tamil Nadu',
  kl: 'Kerala', kerala: 'Kerala',
  ka: 'Karnataka', karnataka: 'Karnataka',
  ts: 'Telangana', telangana: 'Telangana',
  ap: 'Andhra Pradesh', andhrapradesh: 'Andhra Pradesh',
  mh: 'Maharashtra', maharashtra: 'Maharashtra',
  dl: 'Delhi', delhi: 'Delhi',
};
const toStateName = value => STATE_NAMES[NORMALIZE(value)] || (value || '').trim();
const normCity = value => (value || '').trim().toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
const reporteeScopeIds = (reportees, userId) => {
  const scope = new Set([String(userId)]);
  let changed = true;
  while (changed) {
    changed = false;
    reportees.forEach(reportee => {
      if (scope.has(String(reportee.reports_to_id)) && !scope.has(String(reportee.id))) {
        scope.add(String(reportee.id));
        changed = true;
      }
    });
  }
  return scope;
};
const doctorBelongsTo = (doctor, userId, reportees = []) => {
  if (!userId) return true;
  const scope = reporteeScopeIds(reportees, userId);
  if (scope.has(String(doctor.manager_id))) return true;
  return (doctor.reps || []).some(rep => scope.has(String(rep.id)));
};

const todayIso = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16 };
const input = { width: '100%', boxSizing: 'border-box', padding: '10px 11px', border: '1px solid #d1d5db', borderRadius: 9, background: '#fff', fontSize: 13, color: '#111827' };
const label = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 10, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 };

function SearchPicker({ title, selected, search, onSearch, results, onSelect, onClear, placeholder, resultTitle, resultMeta, emptyText, disabled = false }) {
  return (
    <div style={label}>
      {title}
      {selected ? (
        <div style={{ minHeight: 43, display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', borderRadius: 9, background: '#f0fdf4', border: '1px solid #86efac', textTransform: 'none', letterSpacing: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#166534', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{resultTitle(selected)}</div>
            <div style={{ fontSize: 10, fontWeight: 500, color: '#6b7280', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{resultMeta(selected)}</div>
          </div>
          <button type="button" onClick={onClear} aria-label={`Clear ${title}`} style={{ border: 'none', background: 'none', color: '#6b7280', fontSize: 18, cursor: 'pointer', padding: 2 }}>×</button>
        </div>
      ) : (
        <div style={{ position: 'relative', textTransform: 'none', letterSpacing: 0 }}>
          <input value={search} onChange={event => onSearch(event.target.value)} placeholder={placeholder} disabled={disabled} style={{ ...input, background: disabled ? '#f3f4f6' : '#fff', cursor: disabled ? 'not-allowed' : 'text' }} />
          {search.trim() && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 80, maxHeight: 240, overflowY: 'auto', marginTop: 4, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 10px 28px rgba(0,0,0,0.14)' }}>
              {results.length ? results.map(row => (
                <button type="button" key={row.id} onClick={() => onSelect(row)} style={{ width: '100%', display: 'block', textAlign: 'left', border: 'none', borderBottom: '1px solid #f3f4f6', background: '#fff', padding: '10px 12px', cursor: 'pointer' }} onMouseEnter={event => { event.currentTarget.style.background = '#f9fafb'; }} onMouseLeave={event => { event.currentTarget.style.background = '#fff'; }}>
                  <div style={{ fontSize: 13, fontWeight: 750, color: '#111827' }}>{resultTitle(row)}</div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{resultMeta(row)}</div>
                </button>
              )) : <div style={{ padding: '12px', fontSize: 12, color: '#9ca3af' }}>{emptyText}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
      return { region: '', city: '', assigned_to_id: '', doctor_id: '', task_date: todayIso(), details: '', ...saved };
    } catch (_) {
      return { region: '', city: '', assigned_to_id: '', doctor_id: '', task_date: todayIso(), details: '' };
    }
  });
  const [completion, setCompletion] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [duplicateTask, setDuplicateTask] = useState(null);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [doctorSearch, setDoctorSearch] = useState('');

  const loadTasks = useCallback(() => {
    if (!user?.id) return;
    setLoading(true);
    tasksAPI.list(user.id, { task_date: filterDate || undefined, status: statusFilter })
      .then(res => {
        const rows = Array.isArray(res.data) ? res.data : [];
        setTasks(rows);
        rows.filter(task => String(task.assigned_to_id) === String(user.id) && !task.is_read)
          .forEach(task => tasksAPI.markRead(task.id, user.id).catch(() => {}));
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
      setForm(prev => {
        const selectedReporteeIsAvailable = reps.some(rep => String(rep.id) === String(prev.assigned_to_id));
        const selectedDoctorIsAvailable = selectedReporteeIsAvailable && doctorList.some(doctor => String(doctor.id) === String(prev.doctor_id) && doctorBelongsTo(doctor, prev.assigned_to_id, reps));
        return { ...prev, assigned_to_id: selectedReporteeIsAvailable ? prev.assigned_to_id : '', doctor_id: selectedDoctorIsAvailable ? prev.doctor_id : '' };
      });
    }).catch(err => {
      if (err?.response?.status === 403) {
        setCanAssign(false);
        setAssignees([]);
        setDoctors([]);
        return;
      }
      setError(err?.response?.data?.detail || 'Unable to load reportees and doctors');
    });
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!canAssign) return;
    localStorage.setItem(draftKey, JSON.stringify(form));
  }, [form, canAssign, draftKey]);

  const allRegions = useMemo(() => {
    const seen = new Set();
    doctors.forEach(doctor => {
      const region = toStateName(doctor.state_code);
      if (region) seen.add(region);
    });
    return [...seen].sort();
  }, [doctors]);

  const cityList = useMemo(() => {
    const regionDoctors = form.region
      ? doctors.filter(doctor => toStateName(doctor.state_code) === form.region)
      : doctors;
    const counts = {};
    regionDoctors.forEach(doctor => {
      const city = normCity(doctor.city);
      if (city) counts[city] = (counts[city] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [doctors, form.region]);

  const locationDoctors = useMemo(() => {
    let rows = form.region
      ? doctors.filter(doctor => toStateName(doctor.state_code) === form.region)
      : doctors;
    if (form.city) rows = rows.filter(doctor => normCity(doctor.city) === form.city);
    return rows;
  }, [doctors, form.region, form.city]);

  const filteredAssignees = useMemo(() => {
    if (!form.region && !form.city) return assignees;
    return assignees.filter(reportee => locationDoctors.some(doctor => doctorBelongsTo(doctor, reportee.id, assignees)));
  }, [assignees, locationDoctors, form.region, form.city]);

  const filteredDoctors = useMemo(() => {
    if (!form.assigned_to_id) return locationDoctors;
    return locationDoctors.filter(doctor => doctorBelongsTo(doctor, form.assigned_to_id, assignees));
  }, [locationDoctors, form.assigned_to_id, assignees]);

  const selectedAssignee = assignees.find(rep => String(rep.id) === String(form.assigned_to_id));
  const selectedDoctor = filteredDoctors.find(doctor => String(doctor.id) === String(form.doctor_id));
  const assigneeSearchResults = useMemo(() => {
    const query = assigneeSearch.trim().toLowerCase();
    if (!query) return [];
    return filteredAssignees.filter(reportee => [reportee.name, reportee.display_role, reportee.city, reportee.state].filter(Boolean).join(' ').toLowerCase().includes(query)).slice(0, 15);
  }, [filteredAssignees, assigneeSearch]);
  const doctorSearchResults = useMemo(() => {
    const query = doctorSearch.trim().toLowerCase();
    if (!query) return [];
    return filteredDoctors.filter(doctor => [doctor.name, doctor.hospital, doctor.city, doctor.specialty, doctor.client_code].filter(Boolean).join(' ').toLowerCase().includes(query)).slice(0, 20);
  }, [filteredDoctors, doctorSearch]);
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

  const selectRegion = region => {
    setForm(prev => ({
      ...prev,
      region: region || '',
      city: '',
      assigned_to_id: '',
      doctor_id: '',
    }));
    setAssigneeSearch('');
    setDoctorSearch('');
    setDuplicateTask(null);
    setMessage('');
    setError('');
  };

  const selectCity = city => {
    setForm(prev => ({ ...prev, city: city || '', assigned_to_id: '', doctor_id: '' }));
    setAssigneeSearch('');
    setDoctorSearch('');
    setDuplicateTask(null);
    setMessage('');
    setError('');
  };

  const assignTask = async (event) => {
    event.preventDefault();
    if (!form.assigned_to_id || !form.doctor_id || !form.task_date || !form.details.trim()) {
      setError('Reportee, doctor, date and task details are required.');
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
        setMessage(`Task assigned to ${res.data?.task?.assigned_to_name || 'reportee'}.`);
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
          <span><strong>Assigned to:</strong> {task.assigned_to_name}</span>
          <span><strong>Assigned by:</strong> {task.assigned_by_name}</span>
        </div>
        {done && task.completion_comments && (
          <div style={{ marginTop: 10, padding: 10, background: '#f0fdf4', borderRadius: 9, color: '#166534', fontSize: 12 }}><strong>Completion comments:</strong> {task.completion_comments}</div>
        )}
        {String(task.assigned_to_id) === String(user.id) && !done && (
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
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{user?.role === 'md' ? 'Assign tasks to reportees and review tasks assigned by every manager.' : canAssign ? 'Assign doctor-specific daily work to people in your reporting hierarchy.' : 'Review and complete tasks assigned by your manager.'}</div>
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
          {allRegions.length > 0 && (
            <div style={{ padding: '12px 14px', borderRadius: 11, background: '#f8fafc', border: '1px solid #e5e7eb', marginBottom: 13 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 9, color: '#6b7280', fontWeight: 900, letterSpacing: 1.3, textTransform: 'uppercase', marginRight: 4 }}>Region</span>
                {[{ label: 'All', value: '' }, ...allRegions.map(region => ({ label: region, value: region }))].map(({ label: regionLabel, value }) => {
                  const active = form.region === value;
                  const regionAccents = { 'Tamil Nadu': '#F97316', Kerala: '#10B981', Telangana: '#8B5CF6', Karnataka: '#EF4444', Maharashtra: '#3B82F6' };
                  const accent = regionAccents[value] || '#0F6E56';
                  return <button type="button" key={regionLabel} onClick={() => selectRegion(value)} style={{ padding: '5px 13px', borderRadius: 20, fontSize: 11, fontWeight: 800, cursor: 'pointer', border: active ? `2px solid ${accent}` : '2px solid #e5e7eb', background: active ? accent : '#fff', color: active ? '#fff' : '#6b7280' }}>{regionLabel}</button>;
                })}
              </div>
              {cityList.length > 0 && (() => {
                const topCities = cityList.slice(0, 5);
                const remainingCities = cityList.slice(5);
                return (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 9, color: '#6b7280', fontWeight: 900, letterSpacing: 1.3, textTransform: 'uppercase', marginRight: 4 }}>City</span>
                    <button type="button" onClick={() => selectCity('')} style={{ padding: '3px 11px', borderRadius: 20, fontSize: 10, fontWeight: 800, cursor: 'pointer', border: form.city === '' ? '2px solid #3D8C40' : '2px solid #e5e7eb', background: form.city === '' ? '#3D8C40' : '#fff', color: form.city === '' ? '#fff' : '#6b7280' }}>All</button>
                    {topCities.map(([city, count]) => {
                      const active = form.city === city;
                      return <button type="button" key={city} onClick={() => selectCity(active ? '' : city)} style={{ padding: '3px 11px', borderRadius: 20, fontSize: 10, fontWeight: 700, cursor: 'pointer', border: active ? '2px solid #3D8C40' : '2px solid #e5e7eb', background: active ? '#3D8C40' : '#fff', color: active ? '#fff' : '#6b7280' }}>{city} <span style={{ opacity: 0.65 }}>({count})</span></button>;
                    })}
                    {remainingCities.length > 0 && (
                      <select value={remainingCities.some(([city]) => city === form.city) ? form.city : ''} onChange={event => selectCity(event.target.value)} style={{ padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: '#fff', color: '#4b5563', border: '2px solid #e5e7eb' }}>
                        <option value="">+{remainingCities.length} more...</option>
                        {remainingCities.map(([city, count]) => <option key={city} value={city}>{city} ({count})</option>)}
                      </select>
                    )}
                  </div>
                );
              })()}
              <div style={{ marginTop: 8, fontSize: 10, color: '#6b7280' }}>{filteredAssignees.length} reportee{filteredAssignees.length === 1 ? '' : 's'} · {filteredDoctors.length} doctor/hospital record{filteredDoctors.length === 1 ? '' : 's'} in this selection</div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(240px, 1.4fr) minmax(150px, .7fr)', gap: 10 }}>
            <SearchPicker
              title="Reportee / Representative"
              selected={selectedAssignee}
              search={assigneeSearch}
              onSearch={setAssigneeSearch}
              results={assigneeSearchResults}
              onSelect={reportee => { updateForm('assigned_to_id', String(reportee.id)); setForm(prev => ({ ...prev, doctor_id: '' })); setAssigneeSearch(''); setDoctorSearch(''); }}
              onClear={() => { updateForm('assigned_to_id', ''); setForm(prev => ({ ...prev, doctor_id: '' })); setAssigneeSearch(''); setDoctorSearch(''); }}
              placeholder="Type reportee name, role or city..."
              resultTitle={reportee => reportee.name}
              resultMeta={reportee => [reportee.display_role, reportee.city, toStateName(reportee.state)].filter(Boolean).join(' · ')}
              emptyText="No matching reportee in your reporting hierarchy"
            />
            <SearchPicker
              title="Doctor / Hospital"
              selected={selectedDoctor}
              search={doctorSearch}
              onSearch={setDoctorSearch}
              results={doctorSearchResults}
              onSelect={doctor => { updateForm('doctor_id', String(doctor.id)); setDoctorSearch(''); }}
              onClear={() => { updateForm('doctor_id', ''); setDoctorSearch(''); }}
              placeholder={form.assigned_to_id ? 'Type doctor, hospital, city or code...' : 'Select a reportee first, then type...'}
              disabled={!form.assigned_to_id}
              resultTitle={doctor => doctor.name}
              resultMeta={doctor => [doctor.hospital, normCity(doctor.city), doctor.client_code].filter(Boolean).join(' · ')}
              emptyText={form.assigned_to_id ? 'No matching doctor attached to this reportee' : 'Select a reportee before searching doctors'}
            />
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
