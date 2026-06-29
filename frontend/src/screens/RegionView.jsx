import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API = 'http://localhost:8000';

const CUSTOMER_TYPES = {
  doctor:   { icon: '👨‍⚕️', color: '#1d4ed8' },
  pharmacy: { icon: '🏪',   color: '#7c3aed' },
};

export default function RegionView({ embedded = false }) {
  const [doctors, setDoctors] = useState([]);
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeRegion, setActiveRegion] = useState(null);
  const [activeRep, setActiveRep]       = useState(null);

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/doctors/`),
      axios.get(`${API}/users/`),
    ]).then(([d, u]) => {
      setDoctors(d.data);
      setUsers(u.data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="loading">Loading...</div>;

  // ── Build region → reps → customers tree ──────────────────────

  // Get all unique regions (zone or state_code)
  const regions = {};
  doctors.forEach(doc => {
    const region = doc.zone || doc.state_code || 'Unassigned';
    if (!regions[region]) regions[region] = { doctors: [] };
    regions[region].doctors.push(doc);
  });

  // For each region, group doctors by their assigned reps
  const regionList = Object.entries(regions).sort((a, b) => a[0].localeCompare(b[0]));

  const getRepsForDocs = (docs) => {
    const repMap = {};
    docs.forEach(doc => {
      if (doc.reps && doc.reps.length > 0) {
        doc.reps.forEach(rep => {
          if (!repMap[rep.id]) repMap[rep.id] = { ...rep, docs: [] };
          repMap[rep.id].docs.push(doc);
        });
      } else {
        if (!repMap['unassigned']) repMap['unassigned'] = { id: 'unassigned', name: 'Unassigned', docs: [] };
        repMap['unassigned'].docs.push(doc);
      }
    });
    return Object.values(repMap);
  };

  const selectedDocs = activeRegion ? regions[activeRegion]?.doctors || [] : [];
  const repGroups    = getRepsForDocs(selectedDocs);
  const displayDocs  = activeRep
    ? repGroups.find(r => String(r.id) === String(activeRep))?.docs || []
    : selectedDocs;

  return (
    <div>
      {!embedded && <div className="page-title">Region View</div>}
      {!embedded && <div className="page-sub">Territory → KAM / Manager → Customers</div>}

      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>

        {/* ── Region list ────────────────────────── */}
        <div style={{ width: 200, flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Regions / Zones
          </div>
          {regionList.map(([region, data]) => (
            <div
              key={region}
              onClick={() => { setActiveRegion(region); setActiveRep(null); }}
              style={{
                padding: '10px 14px', borderRadius: 10, cursor: 'pointer', marginBottom: 4,
                background: activeRegion === region ? '#eff6ff' : 'white',
                border: `1px solid ${activeRegion === region ? '#bfdbfe' : '#f3f4f6'}`,
                color: activeRegion === region ? '#1d4ed8' : '#374151',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>📍 {region}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{data.doctors.length} customers</div>
            </div>
          ))}
        </div>

        {/* ── Rep/KAM filter ─────────────────────── */}
        {activeRegion && (
          <div style={{ width: 200, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              KAM / Rep
            </div>
            <div
              onClick={() => setActiveRep(null)}
              style={{
                padding: '10px 14px', borderRadius: 10, cursor: 'pointer', marginBottom: 4,
                background: activeRep === null ? '#f0fdf4' : 'white',
                border: `1px solid ${activeRep === null ? '#a5d6a7' : '#f3f4f6'}`,
                color: activeRep === null ? '#15803d' : '#374151',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>All</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>{selectedDocs.length} customers</div>
            </div>
            {repGroups.map(rep => (
              <div
                key={rep.id}
                onClick={() => setActiveRep(String(rep.id))}
                style={{
                  padding: '10px 14px', borderRadius: 10, cursor: 'pointer', marginBottom: 4,
                  background: String(activeRep) === String(rep.id) ? '#faf5ff' : 'white',
                  border: `1px solid ${String(activeRep) === String(rep.id) ? '#d8b4fe' : '#f3f4f6'}`,
                  color: String(activeRep) === String(rep.id) ? '#7c3aed' : '#374151',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {rep.id === 'unassigned' ? '— Unassigned —' : `👤 ${rep.name}`}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{rep.docs.length} customers</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Customer list ──────────────────────── */}
        <div style={{ flex: 1 }}>
          {!activeRegion ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {regionList.map(([region, data]) => {
                const reps = getRepsForDocs(data.doctors);
                return (
                  <div key={region}
                    onClick={() => { setActiveRegion(region); setActiveRep(null); }}
                    className="card"
                    style={{ cursor: 'pointer', padding: 16 }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>📍 {region}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#1d4ed8' }}>{data.doctors.length}</div>
                    <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>customers</div>
                    {reps.filter(r => r.id !== 'unassigned').map(r => (
                      <div key={r.id} style={{ fontSize: 11, color: '#6b7280', background: '#f9fafb', padding: '3px 8px', borderRadius: 6, marginBottom: 3 }}>
                        👤 {r.name} ({r.docs.length})
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card">
              <div className="card-title">
                {activeRegion}
                {activeRep && repGroups.find(r => String(r.id) === activeRep) && (
                  <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 8 }}>
                    → {repGroups.find(r => String(r.id) === activeRep)?.name}
                  </span>
                )}
                <span style={{ float: 'right', fontWeight: 400, fontSize: 12, color: '#9ca3af' }}>{displayDocs.length} records</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Name</th>
                      <th>Hospital / Firm</th>
                      <th>Specialty</th>
                      <th>Cat</th>
                      <th>City</th>
                      <th>KAM / Rep</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayDocs.length === 0 && (
                      <tr><td colSpan={8} style={{ textAlign: 'center', color: '#9ca3af', padding: 24 }}>No customers</td></tr>
                    )}
                    {displayDocs.map(doc => {
                      const ct = CUSTOMER_TYPES[doc.customer_type || 'doctor'] || CUSTOMER_TYPES.doctor;
                      return (
                        <tr key={doc.id}>
                          <td>
                            <span style={{ background: ct.color + '15', color: ct.color, border: `1px solid ${ct.color}40`, borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                              {ct.icon}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{doc.name}</div>
                            {doc.client_code && <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>{doc.client_code}</div>}
                          </td>
                          <td style={{ fontSize: 12 }}>{doc.hospital || doc.firm_name || '—'}</td>
                          <td style={{ fontSize: 12 }}>{doc.specialty || doc.qualification || '—'}</td>
                          <td style={{ textAlign: 'center' }}>
                            {doc.category
                              ? <span style={{ background: '#ede9fe', color: '#6d28d9', padding: '1px 7px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{doc.category}</span>
                              : '—'}
                          </td>
                          <td style={{ fontSize: 12 }}>{doc.city || '—'}</td>
                          <td style={{ fontSize: 12 }}>
                            {doc.reps?.length
                              ? doc.reps.map(r => (
                                <span key={r.id} style={{ background: '#faf5ff', color: '#7c3aed', padding: '1px 7px', borderRadius: 20, fontSize: 11, display: 'inline-block', marginRight: 3 }}>
                                  {r.name}
                                </span>
                              ))
                              : <span style={{ color: '#d1d5db', fontSize: 11 }}>Unassigned</span>}
                          </td>
                          <td>
                            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                              background: doc.status === 'Active' ? '#dcfce7' : '#fee2e2',
                              color: doc.status === 'Active' ? '#15803d' : '#dc2626' }}>
                              {doc.status || 'Active'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
