import InstallBanner from './InstallBanner';
import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { salesAPI, targetsAPI } from '../api';

// ── Nav config ───────────────────────────────────
const NAV = {
  admin: [
    { label: 'Overview', items: [
      { to: '/', icon: '⊞', label: 'Dashboard' },
    ]},
    { label: 'Administration', items: [
      { to: '/users',         icon: '◎', label: 'User Management' },
      { to: '/admin-doctors', icon: '✦', label: 'Customer Master' },
    ]},
    { label: 'Performance', items: [
      { to: '/investment-roi',           icon: '◈', label: 'Investment & ROI' },
      { to: '/product-sales', icon: '◇', label: 'Product Sales' },
      { to: '/rep-activity',  icon: '📊', label: 'Rep Activity' },
    ]},
  ],
  md: [
    { label: 'Overview', items: [
      { to: '/',              icon: '⊞', label: 'MD Dashboard' },
    ]},
    { label: 'Administration', items: [
      { to: '/users',         icon: '◎', label: 'User Management' },
      { to: '/admin-doctors', icon: '✦', label: 'Customer Master' },
    ]},
    { label: 'Performance', items: [
      { to: '/investment-roi',             icon: '◈', label: 'Investment & ROI' },
      { to: '/regional-sales', icon: 'R', label: 'Regional Sales' },
      { to: '/product-sales',   icon: '◇', label: 'Product Sales' },
      { to: '/target-setting',  icon: 'T', label: 'Target Setting' },
      { to: '/rep-activity',    icon: '📊', label: 'Rep Activity' },
    ]},
    { label: 'Organisation', items: [
      { to: '/my-team',       icon: '⋮', label: 'My Hierarchy' },
    ]},
  ],
  director: [
    { label: 'Overview', items: [
      { to: '/',              icon: '⊞', label: 'Dashboard' },
    ]},
    { label: 'My Work', items: [
      { to: '/my-customers',  icon: '✦', label: 'My Customers' },
      { to: '/visit-log',     icon: '📍', label: 'Visit Log' },
      { to: '/investment-roi',           icon: '◈', label: 'Investment & ROI' },
      { to: '/regional-sales', icon: 'R', label: 'Regional Sales' },
      { to: '/rep-activity',  icon: '📊', label: 'Rep Activity' },
    ]},
    { label: 'Organisation', items: [
      { to: '/my-team',       icon: '⋮', label: 'My Hierarchy' },
    ]},
  ],
  senior_manager: [
    { label: 'Overview', items: [
      { to: '/',              icon: '⊞', label: 'Dashboard' },
    ]},
    { label: 'My Work', items: [
      { to: '/my-customers',  icon: '✦', label: 'My Customers' },
      { to: '/visit-log',     icon: '📍', label: 'Visit Log' },
      { to: '/investment-roi',           icon: '◈', label: 'Investment & ROI' },
      { to: '/regional-sales', icon: 'R', label: 'Regional Sales' },
      { to: '/rep-activity',  icon: '📊', label: 'Rep Activity' },
    ]},
    { label: 'Organisation', items: [
      { to: '/my-team',       icon: '⋮', label: 'My Hierarchy' },
    ]},
  ],
  manager: [
    { label: 'Overview', items: [
      { to: '/',              icon: '⊞', label: 'Dashboard' },
    ]},
    { label: 'My Work', items: [
      { to: '/my-customers',  icon: '✦', label: 'My Customers' },
      { to: '/visit-log',     icon: '📍', label: 'Visit Log' },
      { to: '/investment-roi',           icon: '◈', label: 'Investment & ROI' },
      { to: '/regional-sales', icon: 'R', label: 'Regional Sales' },
      { to: '/rep-activity',  icon: '📊', label: 'Rep Activity' },
    ]},
    { label: 'Organisation', items: [
      { to: '/my-team',       icon: '⋮', label: 'My Hierarchy' },
    ]},
  ],
  rep: [
    { label: 'Overview', items: [
      { to: '/',              icon: '⊞', label: 'Dashboard' },
    ]},
    { label: 'My Work', items: [
      { to: '/my-customers',  icon: '✦', label: 'My Customers' },
      { to: '/visit-log',     icon: '📍', label: 'Visit Log' },
      { to: '/investment-roi',           icon: '◈', label: 'Investment & ROI' },
      { to: '/regional-sales', icon: 'R', label: 'Regional Sales' },
    ]},
    { label: 'Organisation', items: [
      { to: '/my-team',       icon: '⋮', label: 'My Hierarchy' },
    ]},
  ],
  custom: [
    { label: 'Overview', items: [
      { to: '/',              icon: '⊞', label: 'Dashboard' },
    ]},
    { label: 'My Work', items: [
      { to: '/my-customers',  icon: '✦', label: 'My Customers' },
      { to: '/visit-log',     icon: '📍', label: 'Visit Log' },
      { to: '/investment-roi',           icon: '◈', label: 'Investment & ROI' },
      { to: '/regional-sales', icon: 'R', label: 'Regional Sales' },
    ]},
    { label: 'Organisation', items: [
      { to: '/my-team',       icon: '⋮', label: 'My Hierarchy' },
    ]},
  ],
};

const PAGE_TITLES = {
  '/':              'Dashboard',
  '/investment-roi':           'Investment & ROI',
  '/regional-sales': 'Regional Sales',
  '/my-sales': 'My Sales',
  '/my-team':       'My Hierarchy',
  '/my-customers':  'My Customers',
  '/enter-sales':   'My Sales',
  '/visit-log':     'Visit Log',
  '/product-sales':  'Sales by Product',
  '/target-setting': 'Target Setting',
  '/rep-activity':   'Rep Activity',
  '/users':         'User Management',
  '/admin-doctors': 'Customer Master',
};

function initials(name) {
  return (name || '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function fmtCompactInr(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function isoToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shouldCheckSalesReminder(now = new Date()) {
  const day = now.getDay();
  if (day === 1) return now.getHours() >= 10;
  return day === 0 || day >= 2;
}

function fmtDateLabel(value) {
  if (!value) return '';
  const d = new Date(`${value}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen]       = useState(false);   // mobile drawer
  const [collapsed, setCollapsed]           = useState(false);   // desktop collapse
  const [profileOpen, setProfileOpen]       = useState(false);
  const [targetOpen, setTargetOpen]         = useState(false);
  const [targetSummary, setTargetSummary]   = useState(null);
  const [salesReminder, setSalesReminder]   = useState(null);
  const [salesReminderHiddenUntil, setSalesReminderHiddenUntil] = useState(0);

  const role = user?.role || 'custom';
  const navSections = (NAV[role] || NAV.custom)
    .map(section => ({
      ...section,
      items: [
        ...section.items,
      ].filter(item => item.to !== '/my-team'),
    }))
    .filter(section => section.items.length > 0);
  const pageTitle = PAGE_TITLES[location.pathname] || 'Fortel CRM';
  const showTargetSummary = user?.id && !['admin', 'md'].includes(role);
  const showSalesReminderForRole = user?.id && !['admin', 'md'].includes(role);
  const targetPct = Math.min(Number(targetSummary?.achievement_pct) || 0, 100);
  const rawTargetPct = Number(targetSummary?.achievement_pct) || 0;
  const targetStatusText = !targetSummary?.has_target
    ? 'Not set'
    : rawTargetPct >= 100
      ? '100%+'
      : `${rawTargetPct}%`;
  const targetBalanceText = !targetSummary?.has_target
    ? 'Target not set'
    : Number(targetSummary?.remaining_value) <= 0
      ? 'Target achieved'
      : `${fmtCompactInr(targetSummary?.remaining_value)} to go`;
  const showSalesReminderBanner = salesReminder && !salesReminder.completed && Date.now() >= salesReminderHiddenUntil;
  const currentPathWithSearch = `${location.pathname}${location.search}`;

  const handleLogout = () => { logout(); navigate('/login'); };

  useEffect(() => {
    if (!showTargetSummary) {
      setTargetSummary(null);
      setTargetOpen(false);
      return;
    }
    const now = new Date();
    targetsAPI.summary(user.id, now.getFullYear(), now.getMonth() + 1)
      .then(res => setTargetSummary(res.data))
      .catch(() => setTargetSummary(null));
    setTargetOpen(false);
  }, [showTargetSummary, user?.id, location.pathname]);

  useEffect(() => {
    if (!showSalesReminderForRole) {
      setSalesReminder(null);
      return undefined;
    }

    const checkReminder = async () => {
      if (!shouldCheckSalesReminder()) {
        setSalesReminder(null);
        return;
      }
      try {
        const res = await salesAPI.weeklyReminderStatus(user.id, isoToday());
        const status = res.data;
        if (status?.completed) {
          setSalesReminder(null);
          return;
        }
        setSalesReminder(status);

        const notificationKey = `fortel_sales_notice_${user.id}_${status.week_start}`;
        const lastSent = Number(localStorage.getItem(notificationKey) || 0);
        if (Date.now() - lastSent >= 30 * 60 * 1000 && window.Notification?.permission === 'granted') {
          new Notification('Fortel CRM sales update pending', {
            body: `Please update sales for ${fmtDateLabel(status.week_start)}-${fmtDateLabel(status.week_end)}.`,
            tag: notificationKey,
          });
          localStorage.setItem(notificationKey, String(Date.now()));
        }
      } catch (_) {
        setSalesReminder(null);
      }
    };

    checkReminder();
    const timer = setInterval(checkReminder, 30 * 60 * 1000);
    return () => clearInterval(timer);
  }, [showSalesReminderForRole, user?.id, location.pathname]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <>
    <InstallBanner />
    <div className="app-layout">

      {/* ── SIDEBAR ─────────────────────────── */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>

        {/* Brand */}
        <div className="sidebar-brand" style={{ position: 'relative' }}>
          <div className="sidebar-brand-inner">
            {/* Full logo */}
            <div className="sidebar-brand-logo-full" style={{ display: 'flex', alignItems: 'center', gap: 0, paddingTop: 4 }}>
              <span style={{ fontSize: 24, fontWeight: 900, color: '#1A1A1A', letterSpacing: '-0.5px', lineHeight: 1.2 }}>fort</span>
              <span style={{ position: 'relative', display: 'inline-block', lineHeight: 1.2 }}>
                <span style={{ fontSize: 24, fontWeight: 900, color: '#1A1A1A', letterSpacing: '-0.5px' }}>e</span>
                <svg style={{ position: 'absolute', top: -6, left: 0, pointerEvents: 'none' }} width="12" height="8" viewBox="0 0 12 8">
                  <ellipse cx="6" cy="4" rx="5.5" ry="3" fill="#3D8C40" transform="rotate(-20 6 4)"/>
                </svg>
              </span>
              <span style={{ fontSize: 24, fontWeight: 900, color: '#1A1A1A', letterSpacing: '-0.5px', lineHeight: 1.2 }}>l</span>
              <span style={{
                fontSize: 9, fontWeight: 800, background: '#1A1A1A',
                color: '#F5B800', padding: '2px 7px', borderRadius: 4,
                letterSpacing: '1.5px', marginLeft: 8, flexShrink: 0,
              }}>CRM</span>
            </div>
            {/* Mini logo (collapsed) */}
            <div className="sidebar-brand-logo-mini" style={{ display: 'none', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 20, fontWeight: 900, color: '#1A1A1A' }}>F</span>
              <svg style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-4px)', pointerEvents: 'none' }} width="10" height="7" viewBox="0 0 12 8">
                <ellipse cx="6" cy="4" rx="5.5" ry="3" fill="#3D8C40" transform="rotate(-20 6 4)"/>
              </svg>
            </div>
          </div>

          {/* Collapse toggle — desktop only */}
          <button
            className="sidebar-collapse-btn"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{ display: 'none' }}
            id="collapse-btn"
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        {/* User */}
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">{initials(user?.name || 'U')}</div>
          <div className="sidebar-user-info">
            <div className="name">{user?.name || 'User'}</div>
            <div className="role">{user?.display_role || user?.custom_role_name || role}</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {navSections.map(section => (
            <div key={section.label} className="sidebar-section">
              <div className="sidebar-section-label">{section.label}</div>
              {section.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  data-label={item.label}
                  className={({ isActive }) => {
                    const hasQuery = item.to.includes('?');
                    const active = hasQuery
                      ? currentPathWithSearch === item.to
                      : isActive && !location.search;
                    return `sidebar-link${active ? ' active' : ''}`;
                  }}
                  onClick={() => setSidebarOpen(false)}
                >
                  <span className="icon" style={{ fontSize: 13, opacity: 0.9, flexShrink: 0 }}>{item.icon}</span>
                  <span className="link-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div className="sidebar-bottom" style={{ display: 'none' }}>
          <button className="logout-btn" onClick={handleLogout}>
            <span style={{ fontSize: 13, flexShrink: 0 }}>→</span>
            <span className="link-label">Sign Out</span>
          </button>
        </div>
      </div>

      {/* ── MAIN ────────────────────────────── */}
      <div className={`main-content ${collapsed ? 'sidebar-collapsed' : ''}`}>

        {/* Top bar */}
        <div className="header">
          {/* Mobile hamburger */}
          <button className="menu-toggle" onClick={() => setSidebarOpen(s => !s)}>☰</button>

          {/* Desktop collapse toggle (shown inside header on desktop) */}
          <button
            onClick={() => setCollapsed(c => !c)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)', fontSize: 18, padding: '4px 6px',
              borderRadius: 6, display: 'flex', alignItems: 'center',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.9)'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="desktop-collapse-toggle"
          >
            {collapsed ? '›' : '‹'}
          </button>

          {/* Page breadcrumb */}
          <div className="logo">
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>Fortel</span>
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>›</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>{pageTitle}</span>
          </div>

          <div className="header-right" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
            {showTargetSummary && (
              <div
                className="target-summary-card"
                title={targetSummary?.has_target
                  ? `Monthly target ${fmtCompactInr(targetSummary.target_value)} · Sales done ${fmtCompactInr(targetSummary.actual_value)} · ${targetBalanceText}`
                  : 'No target set for this month'}
                onClick={() => setTargetOpen(o => !o)}
                style={{
                  minWidth: 210,
                  maxWidth: 260,
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 12,
                  padding: '7px 10px',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 800, textTransform: 'uppercase' }}>Monthly Target</span>
                  <span style={{ fontSize: 11, color: targetSummary?.has_target ? '#F5B800' : 'rgba(255,255,255,0.45)', fontWeight: 900 }}>
                    {targetStatusText}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2, whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 900 }}>{fmtCompactInr(targetSummary?.actual_value)}</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>of {fmtCompactInr(targetSummary?.target_value)}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.62)' }}>{targetBalanceText}</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.14)', borderRadius: 999, overflow: 'hidden', marginTop: 6 }}>
                  <div style={{ width: `${targetPct}%`, height: '100%', background: targetPct >= 100 ? '#22c55e' : '#F5B800', borderRadius: 999 }} />
                </div>
              </div>
            )}
            {targetOpen && showTargetSummary && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 498 }} onClick={() => setTargetOpen(false)} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 8px)', right: 132, zIndex: 500,
                  width: 420, maxWidth: 'calc(100vw - 24px)', maxHeight: '70vh', overflowY: 'auto',
                  background: '#fff', borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                  border: '1px solid #e5e7eb',
                }}>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 900, color: '#111827' }}>Product Targets</div>
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>This month target vs sales done</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: rawTargetPct >= 100 ? '#15803d' : '#92400e' }}>{targetStatusText}</div>
                        <div style={{ fontSize: 10, color: '#6b7280' }}>{targetBalanceText}</div>
                      </div>
                    </div>
                  </div>

                  {!targetSummary?.has_target ? (
                    <div style={{ padding: 22, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
                      No target has been set for this month yet.
                    </div>
                  ) : (
                    <div>
                      {(targetSummary.products || []).slice(0, 12).map(product => {
                        const pct = Math.min(Number(product.achievement_pct) || 0, 100);
                        const done = Number(product.remaining_value) <= 0;
                        return (
                          <div key={product.product_id} style={{ padding: '11px 14px', borderBottom: '1px solid #f3f4f6' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.product_name}</div>
                                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                                  Sales {fmtCompactInr(product.actual_value)} of {fmtCompactInr(product.target_value)}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{ fontSize: 11, fontWeight: 900, color: done ? '#15803d' : '#b45309' }}>
                                  {done ? 'Achieved' : `${fmtCompactInr(product.remaining_value)} to go`}
                                </div>
                                <div style={{ fontSize: 10, color: '#9ca3af' }}>{Number(product.achievement_pct) >= 100 ? '100%+' : `${product.achievement_pct}%`}</div>
                              </div>
                            </div>
                            <div style={{ height: 5, background: '#f3f4f6', borderRadius: 999, overflow: 'hidden', marginTop: 8 }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: done ? '#22c55e' : '#F5B800', borderRadius: 999 }} />
                            </div>
                          </div>
                        );
                      })}
                      {(targetSummary.products || []).length > 12 && (
                        <div style={{ padding: 10, textAlign: 'center', color: '#6b7280', fontSize: 11 }}>
                          Showing top 12 products with pending target first.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
            <button
              onClick={() => setProfileOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 10 }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'linear-gradient(135deg, #F5B800, #D4A017)',
                color: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, flexShrink: 0,
                boxShadow: '0 0 0 2px rgba(245,184,0,0.3)',
              }}>
                {initials(user?.name)}
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.9)', lineHeight: 1.2 }}>{user?.name}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', lineHeight: 1.2 }}>
                  {user?.custom_role_name || user?.display_role || role}
                </div>
              </div>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginLeft: 2 }}>▾</span>
            </button>

            {profileOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 499 }} onClick={() => setProfileOpen(false)} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 500,
                  background: '#fff', borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                  border: '1px solid #e5e7eb', minWidth: 200, overflow: 'hidden',
                }}>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6', background: 'linear-gradient(135deg,#0B1E10,#1a3a20)', color: '#fff' }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{user?.name}</div>
                    <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{user?.email}</div>
                    <div style={{ fontSize: 10, opacity: 0.5, marginTop: 1 }}>{user?.custom_role_name || user?.display_role || role}</div>
                  </div>
                  <div style={{ padding: '6px' }}>
                    <button
                      onClick={() => { navigate('/my-team'); setProfileOpen(false); }}
                      style={{ width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600 }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <span>⋮</span> My Hierarchy
                    </button>
                    <button
                      onClick={() => { navigate('/change-password'); setProfileOpen(false); }}
                      style={{ width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600 }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <span>🔑</span> Change Password
                    </button>
                    <div style={{ height: 1, background: '#f3f4f6', margin: '4px 0' }} />
                    <button
                      onClick={() => { logout(); navigate('/login'); }}
                      style={{ width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}
                      onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <span>→</span> Sign Out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Page content */}
        {showSalesReminderBanner && (
          <div style={{
            margin: '14px 24px 0',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 12,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            color: '#78350f',
          }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 13, fontWeight: 900 }}>Sales update pending</div>
              <div style={{ fontSize: 12, marginTop: 2, color: '#92400e' }}>
                Please update last week sales for {fmtDateLabel(salesReminder.week_start)}-{fmtDateLabel(salesReminder.week_end)}. This reminder repeats every 30 minutes until sales are entered.
              </div>
            </div>
            {window.Notification && Notification.permission === 'default' && (
              <button
                onClick={() => Notification.requestPermission()}
                style={{ border: '1px solid #f59e0b', background: '#fff7ed', color: '#92400e', borderRadius: 8, padding: '8px 10px', fontWeight: 800, cursor: 'pointer' }}
              >
                Enable Alerts
              </button>
            )}
            <button
              onClick={() => { navigate('/my-sales'); setSalesReminderHiddenUntil(Date.now() + 30 * 60 * 1000); }}
              style={{ border: 'none', background: '#0F6E56', color: '#fff', borderRadius: 8, padding: '8px 12px', fontWeight: 900, cursor: 'pointer' }}
            >
              Update Sales
            </button>
            <button
              onClick={() => setSalesReminderHiddenUntil(Date.now() + 30 * 60 * 1000)}
              style={{ border: '1px solid #fcd34d', background: '#fff', color: '#92400e', borderRadius: 8, padding: '8px 10px', fontWeight: 800, cursor: 'pointer' }}
            >
              Remind Later
            </button>
          </div>
        )}
        <div className="page-content">
          {children}
        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 299,
            backdropFilter: 'blur(2px)',
          }}
        />
      )}
    </div>
    </>
  );
}
