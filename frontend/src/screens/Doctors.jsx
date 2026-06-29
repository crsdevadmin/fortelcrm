import React, { useState } from 'react';

const DOCTORS = [
  { id: 1, name: 'Dr. Anand, P.',    hospital: 'Apollo Hospitals',   state: 'TN', model: 'U1', grade: 'Gold',     ca: 95,  multiple: 5 },
  { id: 2, name: 'Dr. Rajanna',      hospital: 'SIMS Hospital',      state: 'TN', model: 'P1', grade: 'Silver',   ca: 82,  multiple: 5 },
  { id: 3, name: 'Dr. Mehta, R.',    hospital: 'MIOT International', state: 'TN', model: 'N1', grade: 'Platinum', ca: 110, multiple: 3 },
  { id: 4, name: 'Dr. Savitri',      hospital: 'Private Clinic',     state: 'TN', model: 'U2', grade: 'Bronze',   ca: 55,  multiple: 5 },
  { id: 5, name: 'Dr. Darwin',       hospital: 'Private Clinic',     state: 'AP', model: 'D1', grade: 'Silver',   ca: 78,  multiple: 5 },
  { id: 6, name: 'Dr. Priya Sharma', hospital: 'Yashoda Hospitals',  state: 'TS', model: 'P2', grade: 'Gold',     ca: 92,  multiple: 6 },
  { id: 7, name: 'Dr. Venkat Rao',   hospital: 'KIMS Hospital',      state: 'AP', model: 'R1', grade: 'Bronze',   ca: 45,  multiple: 5 },
  { id: 8, name: 'Dr. Lakshmi',      hospital: 'Amrita Institute',   state: 'KL', model: 'N1', grade: 'Silver',   ca: 88,  multiple: 4 },
  { id: 9, name: 'Dr. Srinivas',     hospital: 'Manipal Hospital',   state: 'KA', model: 'U1', grade: 'Gold',     ca: 103, multiple: 5 },
  { id: 10, name: 'Dr. Ramesh Kumar',hospital: 'Fortis Hospital',    state: 'KA', model: 'P1', grade: 'Silver',   ca: 76,  multiple: 5 },
];

export default function Doctors() {
  const [search, setSearch] = useState('');
  const [filterModel, setFilterModel] = useState('');

  const filtered = DOCTORS.filter(d => {
    const matchName = d.name.toLowerCase().includes(search.toLowerCase());
    const matchModel = !filterModel || d.model === filterModel;
    return matchName && matchModel;
  });

  return (
    <div>
      <div className="page-title">Doctor Master</div>
      <div className="page-sub">{DOCTORS.length} doctors · All regions</div>

      <div className="card" style={{ padding: '12px 16px', marginBottom: 14 }}>
        <div className="field-row">
          <div className="field" style={{ marginBottom: 0 }}>
            <input placeholder="🔍 Search doctor name…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <select value={filterModel} onChange={e => setFilterModel(e.target.value)}>
              <option value="">All Commercial Models</option>
              {['U1','U2','P1','P2','N1','D1','R1'].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th><th>Doctor</th><th>Hospital</th><th>State</th>
                <th>Model</th><th>Multiple</th><th>Grade</th><th>CA%</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => (
                <tr key={d.id}>
                  <td>{i + 1}</td>
                  <td><strong>{d.name}</strong></td>
                  <td>{d.hospital}</td>
                  <td><span className="badge blue">{d.state}</span></td>
                  <td><span className={`cm ${d.model}`}>{d.model}</span></td>
                  <td>{d.multiple}×</td>
                  <td><span className={`grade ${d.grade}`}>{d.grade}</span></td>
                  <td>
                    <span style={{ fontWeight: 700, color: d.ca >= 100 ? 'var(--green)' : d.ca >= 80 ? 'var(--yellow)' : 'var(--red)' }}>
                      {d.ca >= 100 ? '🟢' : d.ca >= 80 ? '🟡' : '🔴'} {d.ca}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
