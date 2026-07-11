import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || '';
const MN  = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const NOW = new Date();
const CUR_YEAR = NOW.getFullYear();
const CUR_MONTH = NOW.getMonth() + 1;

const fmtV = v => {
  const n = parseFloat(v) || 0;
  return n >= 100000 ? `₹${(n/100000).toFixed(1)}L`
       : n >= 1000   ? `₹${(n/1000).toFixed(1)}K`
       : `₹${Math.round(n)}`;
};

const fmtLabel = (start, end) => {
  if (!start || !end) return '';
  const [sy, sm, sd] = start.split('-');
  const [,   em, ed] = end.split('-');
  if (sm === em) return `${+sd}–${+ed} ${MN[+sm]} ${sy}`;
  return `${+sd} ${MN[+sm]} – ${+ed} ${MN[+em]} ${sy}`;
};

export default function ProductSales() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const startDate = params.get('start') || '';
  const endDate   = params.get('end')   || '';
  const year      = parseInt(params.get('year')  || String(CUR_YEAR));
  const month     = parseInt(params.get('month') || String(CUR_MONTH));

  const [products,    setProducts]    = useState([]);   // [{product_id, product_name, total_sales, total_qty}]
  const [selProduct,  setSelProduct]  = useState(null); // selected product object
  const [doctors,     setDoctors]     = useState([]);   // doctors for selected product
  const [loadingP,    setLoadingP]    = useState(true);
  const [loadingD,    setLoadingD]    = useState(false);

  /* load product list */
  useEffect(() => {
    setLoadingP(true);
    const p = startDate && endDate
      ? { year, month, start_date: startDate, end_date: endDate }
      : { year, month };
    axios.get(`${API}/sales/by-product`, { params: p })
      .then(r => { setProducts(r.data || []); setLoadingP(false); })
      .catch(() => setLoadingP(false));
  }, [startDate, endDate, year, month]);

  /* load doctors when product selected */
  const selectProduct = (prod) => {
    if (selProduct?.product_id === prod.product_id) {
      setSelProduct(null); setDoctors([]); return;
    }
    setSelProduct(prod);
    setLoadingD(true);
    const p = startDate && endDate
      ? { year, month, start_date: startDate, end_date: endDate }
      : { year, month };
    axios.get(`${API}/sales/product/${prod.product_id}/doctors`, { params: p })
      .then(r => { setDoctors(r.data || []); setLoadingD(false); })
      .catch(() => setLoadingD(false));
  };

  const grandTotal = products.reduce((s, p) => s + p.total_sales, 0);
  const maxSale    = products.length > 0 ? products[0].total_sales : 1;
  const label      = startDate ? fmtLabel(startDate, endDate) : `${MN[month]} ${year}`;

  return (
    <div style={{ padding: '20px 24px', maxWidth: 900 }}>

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, fontSize: 13, flexWrap: 'wrap' }}>
        <span onClick={() => navigate('/')}
          style={{ color: '#3D8C40', cursor: 'pointer', fontWeight: 600 }}>Dashboard</span>
        <span style={{ color: '#ccc' }}>›</span>
        <span onClick={() => { setSelProduct(null); setDoctors([]); }}
          style={{ color: selProduct ? '#3D8C40' : '#555', cursor: selProduct ? 'pointer' : 'default', fontWeight: 600 }}>
          Products
        </span>
        {selProduct && <>
          <span style={{ color: '#ccc' }}>›</span>
          <span style={{ color: '#555', fontWeight: 600 }}>{selProduct.product_name}</span>
          <span style={{ color: '#ccc' }}>›</span>
          <span style={{ color: '#555' }}>Doctors</span>
        </>}
      </div>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Sales by Product</div>
        <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
          {label} · {products.length} products · <strong style={{ color: '#3D8C40' }}>{fmtV(grandTotal)}</strong> total
        </div>
      </div>

      {loadingP && (
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>Loading…</div>
      )}

      {!loadingP && products.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#bbb' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📦</div>
          <div>No sales data for this period</div>
        </div>
      )}

      {!loadingP && products.map((prod, idx) => {
        const isSelected = selProduct?.product_id === prod.product_id;
        const barPct     = Math.max(4, (prod.total_sales / maxSale) * 100);

        return (
          <div key={prod.product_id}>

            {/* Product row */}
            <div
              onClick={() => selectProduct(prod)}
              style={{
                background: isSelected ? '#1A1A1A' : '#fff',
                borderRadius: isSelected ? '14px 14px 0 0' : 14,
                border: `0.5px solid ${isSelected ? '#1A1A1A' : '#e5e7eb'}`,
                marginBottom: isSelected ? 0 : 8,
                padding: '14px 18px',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.borderColor = '#3D8C40'; }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = '#e5e7eb'; }}
            >
              {/* Rank + name + value */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: isSelected ? '#F5B800' : idx < 3 ? '#1A1A1A' : '#f3f4f6',
                  color:      isSelected ? '#1A1A1A' : idx < 3 ? '#F5B800'  : '#888',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800,
                }}>
                  {idx + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: isSelected ? '#fff' : '#1A1A1A' }}>
                    {prod.product_name}
                  </div>
                  {prod.total_qty > 0 && (
                    <div style={{ fontSize: 11, color: isSelected ? '#aaa' : '#999', marginTop: 1 }}>
                      {prod.total_qty} units
                    </div>
                  )}
                </div>
                <div style={{ fontWeight: 800, fontSize: 16, color: isSelected ? '#F5B800' : '#3D8C40' }}>
                  {fmtV(prod.total_sales)}
                </div>
              </div>

              {/* Bar */}
              <div style={{ height: 4, background: isSelected ? '#333' : '#f0f0f0', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${barPct}%`,
                  background: isSelected ? '#F5B800' : idx < 3 ? '#3D8C40' : '#aaa',
                  borderRadius: 2,
                }} />
              </div>
            </div>

            {/* Doctor list (expanded inline) */}
            {isSelected && (
              <div style={{
                background: '#fafff8',
                border: '0.5px solid #1A1A1A',
                borderTop: 'none',
                borderRadius: '0 0 14px 14px',
                marginBottom: 8,
                overflow: 'hidden',
              }}>
                {/* Sub-header */}
                <div style={{ padding: '10px 18px', background: '#f0faf0', borderBottom: '0.5px solid #d0e8d0' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#3D8C40' }}>
                    Doctors / Pharmacies who purchased {prod.product_name}
                  </span>
                </div>

                {loadingD && (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#aaa', fontSize: 13 }}>Loading…</div>
                )}

                {!loadingD && doctors.length === 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#bbb', fontSize: 13 }}>No records found</div>
                )}

                {!loadingD && doctors.map((doc, di) => {
                  const docPct = Math.max(4, (doc.total_value / doctors[0].total_value) * 100);
                  return (
                    <div key={doc.doctor_id} style={{
                      padding: '12px 18px',
                      borderBottom: di < doctors.length - 1 ? '0.5px solid #e8f5e8' : 'none',
                      background: di % 2 === 0 ? '#fff' : '#fafff8',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{doc.doctor_name}</div>
                          <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>
                            {[doc.specialty, doc.hospital, doc.city].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginLeft: 12 }}>
                          {doc.total_qty > 0 && (
                            <span style={{ fontSize: 11, color: '#aaa' }}>{doc.total_qty} qty</span>
                          )}
                          <span style={{ fontWeight: 700, fontSize: 14, color: '#1A1A1A' }}>
                            {fmtV(doc.total_value)}
                          </span>
                        </div>
                      </div>
                      {/* mini bar */}
                      <div style={{ height: 3, background: '#e8f5e8', borderRadius: 2 }}>
                        <div style={{ height: '100%', width: `${docPct}%`, background: '#3D8C40', borderRadius: 2 }} />
                      </div>
                    </div>
                  );
                })}

                {/* Total */}
                {!loadingD && doctors.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 18px', background: '#e8f5e8' }}>
                    <span style={{ fontSize: 12, color: '#3D8C40' }}>{doctors.length} customers</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#1D5C20' }}>{fmtV(prod.total_sales)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
