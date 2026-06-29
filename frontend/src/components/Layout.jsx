import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
      { to: '/roi',           icon: '◈', label: 'Investment & ROI' },
      { to: '/roi-product',   icon: '◇', label: 'ROI by Product' },
      { to: '/control-tower', icon: '⊕', label: 'Control Tower' },
      { to: '/business',      icon: '▤', label: 'Business Tracker' },
    ]},
  ],
  md: [
    { label: 'Overview', items: [
      { to: '/',              icon: '⊞', label: 'MD Dashboard' },
      { to: '/whiteboard',    icon: '⊡', label: 'Whiteboard' },
    ]},
    { label: 'Administration', items: [
      { to: '/users',         icon: '◎', label: 'User Management' },
      { to: '/admin-doctors', icon: '✦', label: 'Customer Master' },
    ]},
    { label: 'Performance', items: [
      { to: '/roi',           icon: '◈', label: 'Investment & ROI' },
      { to: '/control-tower', icon: '⊕', label: 'Control Tower' },
      { to: '/business',      icon: '▤', label: 'Business Tracker' },
      { to: '/risk',          icon: '⚐', label: 'Risk Management' },
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
      { to: '/enter-sales',   icon: '📋', label: 'My Sales' },
      { to: '/roi',           icon: '◈', label: 'Investment & ROI' },
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
      { to: '/enter-sales',   icon: '📋', label: 'My Sales' },
      { to: '/roi',           icon: '◈', label: 'Investment & ROI' },
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
      { to: '/enter-sales',   icon: '📋', label: 'My Sales' },
      { to: '/roi',           icon: '◈', label: 'Investment & ROI' },
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
      { to: '/enter-sales',   icon: '📋', label: 'My Sales' },
      { to: '/roi',           icon: '◈', label: 'Investment & ROI' },
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
      { to: '/enter-sales',   icon: '📋', label: 'My Sales' },
      { to: '/roi',           icon: '◈', label: 'Investment & ROI' },
    ]},
    { label: 'Organisation', items: [
      { to: '/my-team',       icon: '⋮', label: 'My Hierarchy' },
    ]},
  ],
};

// Page title map for header breadcrumb
const PAGE_TITLES = {
  '/':              'Dashboard',
  '/roi':           'Investment & ROI',
  '/my-team':       'My Hierarchy',
  '/my-customers':  'My Customers',
  '/enter-sales':   'My Sales',
  '/product-sales': 'Sales by Product',
  '/users':         'User Management',
  '/admin-doctors': 'Customer Master',
  '/business':      'Business Tracker',
  '/risk':          'Risk Management',
  '/whiteboard':    'Whiteboard',
  '/control-tower': 'Control Tower',
};

function initials(name) {
  return (name || '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const role = user?.role || 'custom';
  const navSections = NAV[role] || NAV.custom;
  const pageTitle = PAGE_TITLES[location.pathname] || 'Fortel CRM';

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="app-layout">

      {/* ── SIDEBAR ─────────────────────────── */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>

        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, paddingTop: 4 }}>
              <span style={{ fontSize: 24, fontWeight: 900, color: '#1A1A1A', letterSpacing: '-0.5px', lineHeight: 1.2 }}>
                fort
              </span>
              <span style={{ position: 'relative', display: 'inline-block', lineHeight: 1.2 }}>
                <span style={{ fontSize: 24, fontWeight: 900, color: '#1A1A1A', letterSpacing: '-0.5px' }}>e</span>
                <svg style={{ position: 'absolute', top: -6, left: 0, pointerEvents: 'none' }}
                  width="12" height="8" viewBox="0 0 12 8">
                  <ellipse cx="6" cy="4" rx="5.5" ry="3" fill="#3D8C40" transform="rotate(-20 6 4)"/>
                </svg>
              </span>
              <span style={{ fontSize: 24, fontWeight: 900, color: '#1A1A1A', letterSpacing: '-0.5px', lineHeight: 1.2 }}>
                l
              </span>
            </div>
            <span style={{
              fontSize: 9, fontWeight: 800, background: '#1A1A1A',
              color: '#F5B800', padding: '2px 7px', borderRadius: 4,
              letterSpacing: '1.5px', marginLeft: 8, flexShrink: 0,
            }}>CRM</span>
          </div>
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
                  className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <span className="icon" style={{ fontSize: 11, opacity: 0.9 }}>{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div className="sidebar-bottom">
          <button className="logout-btn" onClick={handleLogout}>
            <span style={{ fontSize: 11 }}>→</span>
            Sign Out
          </button>
        </div>
      </div>

      {/* ── MAIN ────────────────────────────── */}
      <div className="main-content">

        {/* Top bar */}
        <div className="header">
          <button className="menu-toggle" onClick={() => setSidebarOpen(s => !s)}>☰</button>

          {/* Page breadcrumb */}
          <div className="logo">
            <span style={{ color: 'var(--text-3)', fontSize: 11 }}>Fortel</span>
            <span style={{ color: 'var(--border-2)', fontSize: 13 }}>›</span>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{pageTitle}</span>
          </div>

          <div className="header-right" style={{ position: 'relative' }}>
            <button
              onClick={() => setProfileOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 10 }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, flexShrink: 0,
              }}>
                {initials(user?.name)}
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.2 }}>{user?.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.2 }}>
                  {user?.custom_role_name || user?.display_role || role}
                </div>
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 2 }}>▾</span>
            </button>

            {profileOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 499 }} onClick={() => setProfileOpen(false)} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 500,
                  background: '#fff', borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                  border: '1px solid #e5e7eb', minWidth: 200, overflow: 'hidden',
                }}>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6', background: 'linear-gradient(135deg,#0f2027,#2c5364)', color: '#fff' }}>
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
  );
}
