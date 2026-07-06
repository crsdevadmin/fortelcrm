import React, { useState, useEffect } from 'react';

export default function InstallBanner() {
  const [show,        setShow]        = useState(false);
  const [isIOS,       setIsIOS]       = useState(false);
  const [deferredEvt, setDeferredEvt] = useState(null); // Chrome install prompt

  useEffect(() => {
    // Already installed as PWA — don't show
    const isStandalone =
      window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) return;

    // Dismissed before — respect for 7 days
    const dismissed = localStorage.getItem('pwa_banner_dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    setIsIOS(ios);

    if (ios) {
      setShow(true);
    } else {
      // Chrome / Android — listen for install prompt
      const handler = e => {
        e.preventDefault();
        setDeferredEvt(e);
        setShow(true);
      };
      window.addEventListener('beforeinstallprompt', handler);
      return () => window.removeEventListener('beforeinstallprompt', handler);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem('pwa_banner_dismissed', Date.now().toString());
    setShow(false);
  };

  const installChrome = async () => {
    if (!deferredEvt) return;
    deferredEvt.prompt();
    const { outcome } = await deferredEvt.userChoice;
    if (outcome === 'accepted') setShow(false);
  };

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'linear-gradient(90deg, #0f2027, #203a43)',
      color: '#fff',
      padding: '10px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 2px 16px rgba(0,0,0,0.4)',
    }}>
      {/* App icon */}
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0, overflow: 'hidden',
        background: '#3D8C40', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, fontWeight: 900, color: '#fff',
      }}>F</div>

      {/* Message */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Install Fortel CRM</div>
        {isIOS ? (
          <div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.4 }}>
            Tap <strong>⎙ Share</strong> then <strong>"Add to Home Screen"</strong> to install the app on your iPad
          </div>
        ) : (
          <div style={{ fontSize: 11, opacity: 0.8 }}>
            Add to your home screen for quick access — works offline too
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {!isIOS && deferredEvt && (
          <button onClick={installChrome}
            style={{
              padding: '7px 14px', borderRadius: 8, border: 'none',
              background: '#3D8C40', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>
            Install
          </button>
        )}
        <button onClick={dismiss}
          style={{
            padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)',
            background: 'transparent', color: '#fff', fontSize: 12, cursor: 'pointer',
          }}>
          ✕
        </button>
      </div>
    </div>
  );
}
