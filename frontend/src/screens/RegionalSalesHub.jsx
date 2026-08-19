import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import PrimarySales from './PrimarySales';
import ROIDashboard from './ROIDashboard';


export default function RegionalSalesHub() {
  const { user } = useAuth();
  const backOfficeOnly = user?.role === 'back_office';
  const [tab, setTab] = useState('primary');

  if (backOfficeOnly) return <PrimarySales />;

  return (
    <div>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '10px 24px', display: 'flex', gap: 8, position: 'sticky', top: 0, zIndex: 20 }}>
        {[
          ['primary', 'Primary Sales', 'Company → stockist'],
          ['secondary', 'Secondary Sales', 'Stockist → market'],
        ].map(([key, label, hint]) => {
          const active = tab === key;
          return (
            <button key={key} onClick={() => setTab(key)} style={{ border: active ? '1px solid #0f766e' : '1px solid #e2e8f0', background: active ? '#ecfdf5' : '#fff', color: active ? '#0f766e' : '#475569', borderRadius: 10, padding: '7px 13px', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 900 }}>{label}</span>
              <span style={{ display: 'block', fontSize: 9, opacity: 0.72, marginTop: 1 }}>{hint}</span>
            </button>
          );
        })}
      </div>
      {tab === 'primary' ? <PrimarySales /> : <ROIDashboard defaultTab="regional_sales" />}
    </div>
  );
}
