import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const API = 'http://localhost:8000';

const PURPOSES = [
  'Sales call',
  'Sample drop',
  'Follow-up',
  'CME / Event',
  'Introduction',
  'Relationship visit',
  'Complaint resolution',
  'Other',
];

function fmtTime(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtCoords(lat, lng) {
  if (!lat || !lng) return null;
  return `${parseFloat(lat).toFixed(5)}, ${parseFloat(lng).toFixed(5)}`;
}

function MapPin({ lat, lng, size = 16 }) {
  if (!lat || !lng) return null;
  const url = `https://www.google.com/maps?q=${lat},${lng}`;
  return (
    <a href={url} target="_blank" rel="noreferrer"
      style={{ fontSize: size, textDecoration: 'none' }} title="Open in Google Maps">
      📍
    </a>
  );
}

export default function VisitLog() {
  const { user: me } = useAuth();

  // ── Check-in form state ───────────────────────────────────────
  const [tab,       setTab]       = useState('checkin'); // 'checkin' | 'history'
  const [doctors,   setDoctors]   = useState([]);
  const [docSearch, setDocSearch] = useState('');
  const [selDoc,    setSelDoc]    = useState(null);
  const [purpose,   setPurpose]   = useState('Sales call');
  const [notes,     setNotes]     = useState('');
  const [gps,       setGps]       = useState(null);       // { lat, lng, address }
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError,   setGpsError]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);

  // ── History state ──────────────────────────────────────────────
  const [visits,       setVisits]       = useState([]);
  const [histLoading,  setHistLoading]  = useState(false);
  const [filterRep,    setFilterRep]    = useState('');
  const [allUsers,     setAllUsers]     = useState([]);

  const isManager = me?.role && !['rep', 'custom'].includes(me.role);

  // Load doctors for search
  useEffect(() => {
    if (!me?.id) return;
    axios.get(`${API}/doctors/`, { params: { manager_id: isManager ? undefined : me.id, include_inactive: false } })
      .then(r => setDoctors(r.data || []));
    if (isManager) {
      axios.get(`${API}/users/`, { params: { viewer_id: me.id } })
        .then(r => setAllUsers(r.data || []));
    }
  }, [me?.id]);

  // Load history
  const loadHistory = useCallback(() => {
    if (!me?.id) return;
    setHistLoading(true);
    const params = { viewer_id: me.id, limit: 200 };
    if (filterRep) params.associate_id = filterRep;
    axios.get(`${API}/visits/`, { params })
      .then(r => setVisits(r.data || []))
      .finally(() => setHistLoading(false));
  }, [me?.id, filterRep]);

  useEffect(() => { if (tab === 'history') loadHistory(); }, [tab, loadHistory]);

  // GPS
  const getLocation = () => {
    setGpsError('');
    if (!navigator.geolocation) { setGpsError('Geolocation not supported on this device'); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setGps({ lat, lng, address: null });
        setGpsLoading(false);
        // Try reverse geocode via open API
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`)
          .then(r => r.json())
          .then(data => setGps(g => ({ ...g, address: data.display_name || null })))
          .catch(() => {});
      },
      err => {
        setGpsError('Could not get location — please allow location access in your browser');
        setGpsLoading(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  // Submit check-in
  const handleSubmit = async () => {
    if (!selDoc) return;
    setSubmitting(true);
    try {
      await axios.post(`${API}/visits/`, {
        associate_id: me.id,
        doctor_id:    selDoc.id || selDoc.doctor_id,
        latitude:     gps?.lat  || null,
        longitude:    gps?.lng  || null,
        address:      gps?.address || null,
        visit_time:   new Date().toISOString(),
        purpose,
        notes: notes || null,
      });
      setSubmitted(true);
      setSelDoc(null); setDocSearch(''); setNotes(''); setGps(null); setGpsError('');
      setTimeout(() => setSubmitted(false), 3000);
    } catch {
      alert('Failed to log visit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredDocs = doctors.filter(d =>
    !docSearch ||
    (d.name || d.doctor_name || '').toLowerCase().includes(docSearch.toLowerCase()) ||
    (d.hospital || '').toLowerCase().includes(docSearch.toLowerCase()) ||
    (d.city || '').toLowerCase().includes(docSearch.toLowerCase())
  ).slice(0, 30);

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', padding: '0 0 40px' }}>

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)',
        padding: '22px 24px 20px', color: '#fff',
        borderRadius: '0 0 24px 24px', marginBottom: 20,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>Field Activity</div>
        <div style={{ fontSize: 22, fontWeight: 900 }}>📍 Visit Log</div>
        <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>Tag your location when meeting a doctor or pharma contact</div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {['checkin', 'history'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                padding: '7px 20px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                background: tab === t ? '#fff' : 'rgba(255,255,255,0.12)',
                color: tab === t ? '#0f2027' : 'rgba(255,255,255,0.75)',
              }}>
              {t === 'checkin' ? '✚ Check In' : '📋 History'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 20px' }}>

        {/* ── CHECK-IN TAB ── */}
        {tab === 'checkin' && (
          <div style={{ maxWidth: 520, margin: '0 auto' }}>

            {submitted && (
              <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 12, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>✅</span>
                <div>
                  <div style={{ fontWeight: 700, color: '#065f46', fontSize: 14 }}>Visit logged successfully!</div>
                  <div style={{ fontSize: 12, color: '#059669' }}>Check history to view your visits</div>
                </div>
              </div>
            )}

            {/* Step 1 — Select Doctor */}
            <div style={{ background: '#fff', borderRadius: 14, padding: '16px 18px', marginBottom: 14, border: '0.5px solid #e5e7eb' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                1 · Select Doctor / Contact
              </div>
              {selDoc ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f0fdf4', borderRadius: 10, padding: '10px 14px', border: '1.5px solid #86efac' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#065f46' }}>{selDoc.name || selDoc.doctor_name}</div>
                    <div style={{ fontSize: 11, color: '#059669' }}>{selDoc.specialty}{selDoc.city ? ` · ${selDoc.city}` : ''}</div>
                    {selDoc.hospital && <div style={{ fontSize: 11, color: '#aaa' }}>{selDoc.hospital}</div>}
                  </div>
                  <button onClick={() => { setSelDoc(null); setDocSearch(''); }}
                    style={{ background: 'none', border: 'none', fontSize: 18, color: '#aaa', cursor: 'pointer' }}>✕</button>
                </div>
              ) : (
                <div>
                  <input
                    value={docSearch}
                    onChange={e => setDocSearch(e.target.value)}
                    placeholder="Search by name, hospital, city..."
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', marginBottom: 8 }}
                    autoFocus
                  />
                  {docSearch && (
                    <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
                      {filteredDocs.length === 0 ? (
                        <div style={{ padding: '12px 14px', color: '#aaa', fontSize: 13 }}>No matches</div>
                      ) : filteredDocs.map(d => (
                        <div key={d.id || d.doctor_id} onClick={() => { setSelDoc(d); setDocSearch(''); }}
                          style={{ padding: '10px 14px', borderBottom: '0.5px solid #f3f4f6', cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{d.name || d.doctor_name}</div>
                          <div style={{ fontSize: 11, color: '#888' }}>{d.specialty}{d.city ? ` · ${d.city}` : ''}{d.hospital ? ` · ${d.hospital}` : ''}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step 2 — GPS Location */}
            <div style={{ background: '#fff', borderRadius: 14, padding: '16px 18px', marginBottom: 14, border: '0.5px solid #e5e7eb' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                2 · Your Location
              </div>
              {gps ? (
                <div style={{ background: '#eff6ff', borderRadius: 10, padding: '10px 14px', border: '1.5px solid #bfdbfe' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 16 }}>📍</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8' }}>Location captured</span>
                    <a href={`https://www.google.com/maps?q=${gps.lat},${gps.lng}`} target="_blank" rel="noreferrer"
                      style={{ fontSize: 11, color: '#3b82f6', marginLeft: 'auto' }}>Open map →</a>
                  </div>
                  {gps.address && <div style={{ fontSize: 11, color: '#374151', marginBottom: 4 }}>{gps.address}</div>}
                  <div style={{ fontSize: 10, color: '#6b7280' }}>{fmtCoords(gps.lat, gps.lng)}</div>
                  <button onClick={() => setGps(null)}
                    style={{ marginTop: 8, fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                    Re-capture
                  </button>
                </div>
              ) : (
                <div>
                  <button onClick={getLocation} disabled={gpsLoading}
                    style={{
                      width: '100%', padding: '12px', borderRadius: 10, border: '1.5px dashed #93c5fd',
                      background: gpsLoading ? '#f9fafb' : '#eff6ff', color: '#1d4ed8',
                      fontSize: 13, fontWeight: 700, cursor: gpsLoading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}>
                    {gpsLoading ? (
                      <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span> Getting location...</>
                    ) : (
                      <><span>📍</span> Tap to capture my location</>
                    )}
                  </button>
                  {gpsError && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 6 }}>⚠ {gpsError}</div>}
                  <div style={{ fontSize: 10, color: '#aaa', marginTop: 6 }}>Your browser will ask for permission — allow it to tag this visit</div>
                </div>
              )}
            </div>

            {/* Step 3 — Purpose & Notes */}
            <div style={{ background: '#fff', borderRadius: 14, padding: '16px 18px', marginBottom: 20, border: '0.5px solid #e5e7eb' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                3 · Purpose & Notes
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {PURPOSES.map(p => (
                  <button key={p} onClick={() => setPurpose(p)}
                    style={{
                      padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      border: purpose === p ? '2px solid #3D8C40' : '1px solid #e5e7eb',
                      background: purpose === p ? '#3D8C40' : '#f9fafb',
                      color: purpose === p ? '#fff' : '#374151',
                    }}>
                    {p}
                  </button>
                ))}
              </div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional notes — what was discussed, next steps..."
                rows={3}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>

            {/* Submit */}
            <button onClick={handleSubmit} disabled={!selDoc || submitting}
              style={{
                width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                background: selDoc ? 'linear-gradient(135deg,#3D8C40,#065438)' : '#e5e7eb',
                color: selDoc ? '#fff' : '#aaa',
                fontSize: 15, fontWeight: 800, cursor: selDoc ? 'pointer' : 'not-allowed',
                boxShadow: selDoc ? '0 4px 20px rgba(61,140,64,0.4)' : 'none',
              }}>
              {submitting ? '⏳ Logging visit...' : '✅ Log this visit'}
            </button>
            {!selDoc && <div style={{ textAlign: 'center', fontSize: 11, color: '#aaa', marginTop: 6 }}>Select a doctor first</div>}
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {tab === 'history' && (
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>{visits.length} visits</div>
              {isManager && allUsers.length > 0 && (
                <select value={filterRep} onChange={e => setFilterRep(e.target.value)}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, color: '#374151', background: '#fff' }}>
                  <option value="">All reps</option>
                  {allUsers.filter(u => u.id !== me?.id).map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              )}
              <button onClick={loadHistory} style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151' }}>
                ↻ Refresh
              </button>
            </div>

            {histLoading ? (
              <div style={{ textAlign: 'center', padding: 48, color: '#aaa' }}>Loading...</div>
            ) : visits.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48, color: '#aaa' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📍</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>No visits logged yet</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Check in from the "Check In" tab when you visit a doctor</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {visits.map(v => (
                  <div key={v.id} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '0.5px solid #e5e7eb', borderLeft: '3px solid #3D8C40' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>
                            {v.doctor_name || 'Unknown Doctor'}
                          </span>
                          {v.purpose && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#f0fdf4', color: '#059669', border: '1px solid #86efac' }}>
                              {v.purpose}
                            </span>
                          )}
                        </div>
                        {v.doctor_specialty && <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{v.doctor_specialty}</div>}
                        {isManager && v.associate_name && (
                          <div style={{ fontSize: 11, color: '#3b82f6', marginBottom: 4 }}>👤 {v.associate_name}</div>
                        )}
                        <div style={{ fontSize: 11, color: '#aaa' }}>🕐 {fmtTime(v.visit_time)}</div>
                        {v.notes && <div style={{ fontSize: 12, color: '#555', marginTop: 6, fontStyle: 'italic' }}>"{v.notes}"</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        {v.latitude && v.longitude ? (
                          <a href={`https://www.google.com/maps?q=${v.latitude},${v.longitude}`} target="_blank" rel="noreferrer"
                            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, textDecoration: 'none', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '6px 10px' }}>
                            <span style={{ fontSize: 18 }}>📍</span>
                            <span style={{ fontSize: 9, color: '#3b82f6', fontWeight: 700 }}>View map</span>
                          </a>
                        ) : (
                          <div style={{ fontSize: 10, color: '#d1d5db', padding: '6px 10px', background: '#f9fafb', borderRadius: 8, border: '1px solid #f0f0f0' }}>
                            No GPS
                          </div>
                        )}
                      </div>
                    </div>
                    {v.address && (
                      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6, borderTop: '0.5px solid #f3f4f6', paddingTop: 6 }}>
                        📍 {v.address}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
