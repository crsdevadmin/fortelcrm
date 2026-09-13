# Fortel CRM — Design & Usability Review (iPad)

**Date:** 8 Aug 2026
**Scope:** React frontend — visual system, iPad experience, forms, accessibility
**Target device:** iPad (field reps)
**Files:** `styles.css`, `components/Layout.jsx`, `screens/*.jsx`, `public/index.html`, `public/sw.js`, `public/manifest.json`

> **Revised 8 Aug** — an earlier version of this review assumed reps were on phones. That was wrong and it changed several conclusions. Corrections are marked throughout. The headline finding survived the correction; two others did not.

---

## Short answer

**Landscape, genuinely good. Portrait, compromised — and one specific number is the reason.**

The design system in `styles.css` is properly built: a brand palette derived from the logo, semantic colour tokens with matched background and border variants, a four-step shadow scale, Inter throughout, role-based navigation grouped into labelled sections. The PWA shell shows real mobile knowledge — `viewport-fit=cover`, `env(safe-area-inset-bottom)`, `touch-action: manipulation`, a full iOS icon set, install banner with platform-specific instructions.

On iPad the news is much better than it would be on phones. Every iPad in landscape is 1080px or wider, which is comfortably a desktop layout — the app was built for that and it works.

The problem is **portrait**, and it comes down to a single breakpoint sitting in exactly the wrong place.

---

## The central issue: the breakpoint splits your fleet in half

`styles.css` has one meaningful breakpoint: `@media (max-width: 768px)`. Below it, the sidebar collapses off-canvas behind a hamburger. Above it, the sidebar is fixed at 252px.

Here is where iPads actually land in portrait:

| Device | Portrait width | Layout it gets |
|---|---|---|
| iPad mini | 744px | **Mobile** — off-canvas sidebar |
| iPad 10.2" (9th gen) | 810px | Desktop — fixed 252px sidebar |
| iPad 10.9" / Air 11" | 820px | Desktop — fixed 252px sidebar |
| iPad Pro 11" | 834px | Desktop — fixed 252px sidebar |
| iPad Pro 13" / Air 13" | 1024px | Desktop — fine |

Two consequences.

**1. iPad mini users are on a different app.** 744px falls below the breakpoint, so a rep on a mini gets the hamburger UI while a rep on a standard iPad gets the fixed sidebar. Same task, same orientation, different interface. If the fleet is mixed, support conversations and training will be confusing in a way nobody can name.

**2. Standard iPads in portrait get a desktop layout on a screen that cannot afford one.** With `.page-content { padding: 26px 28px }` (`styles.css:370`):

```
810px screen − 252px sidebar − 56px padding = 502px of usable content
```

The navigation takes 31% of the screen and the content gets 62%. A layout designed at 1400px is being rendered into 502px.

There is a collapse toggle that shrinks the sidebar to 62px, which would recover ~190px. But `Layout.jsx:171` is:

```jsx
const [collapsed, setCollapsed] = useState(false);   // desktop collapse
```

**The collapsed state is never persisted.** Every reload resets to the full 252px sidebar — and the app force-reloads on any 401 via `window.location.href = '/login'` (`api/client.js:22`), which happens whenever an 8-hour token expires mid-shift. A rep who collapses the sidebar every morning has to do it again after every session timeout.

**Fix — this is the highest-value change for iPad, and it is small:**

1. Add a tablet breakpoint. Nothing in the codebase addresses 768-1024px, which is exactly where iPad portrait lives:

```css
@media (min-width: 769px) and (max-width: 1024px) {
  .sidebar { width: var(--sidebar-collapsed-w); }   /* 62px, icons only */
  .main-content { margin-left: var(--sidebar-collapsed-w); }
  .page-content { padding: 20px 18px; }             /* recovers ~20px */
}
```

That takes iPad portrait from 502px to ~710px of content — a 41% increase — with the sidebar still visible as icons.

2. Persist the collapse state to `localStorage` so the choice survives reloads.

3. Consider moving the breakpoint to 745px so iPad mini joins the tablet tier rather than the phone tier. Verify against the actual devices in the field first.

---

## Still true on iPad, and still the top fix

### Every input zooms the page — iPadOS does this too

`styles.css:571-574`:

```css
.field input, .field select, .field textarea {
  padding: 9px 12px;
  font-size: 13px;
}
```

Safari on iPadOS auto-zooms the viewport when a focused input has a font-size under 16px, exactly as on iPhone. It affects every form in the app — login, sales entry, visit log, investment entry. Tap a field, the view lurches; the rep pinches out; taps the next field; it lurches again.

The same rule gives inputs a total height of about 36px. Touch targets are a finger-size problem, not a screen-size problem — Apple's 44pt minimum applies identically on iPad.

**Fix.** Two lines, and it is still the single highest-value change in this document:

```css
.field input, .field select, .field textarea {
  font-size: 16px;      /* stops iPadOS zoom */
  padding: 12px 14px;   /* ~46px tall */
}
```

### Mobile keyboards are never optimised — and this matters more on iPad

Across the entire `src/` tree:

```
autoComplete : 0
inputMode    : 0
type="tel"   : 0
type="number": 17
```

On iPad the software keyboard occupies roughly 40-50% of the screen in portrait. Every unnecessary keystroke costs more here than on a phone, and every mistyped amount means dismissing the keyboard to check what is now hidden behind it. No field tells iPadOS what kind of data it wants, so amount fields open full QWERTY instead of a numeric pad, and the login form offers no autofill — every rep types their password by hand, every time.

**Fix:**

```jsx
<input type="email"    autoComplete="email" inputMode="email" />
<input type="password" autoComplete="current-password" />
<input inputMode="decimal" pattern="[0-9]*" />    {/* amounts */}
<input type="tel" inputMode="tel" autoComplete="tel" />
```

Prefer `inputMode="decimal"` over `type="number"` for money — `type="number"` silently changes values on scroll and strips leading zeros.

Worth pairing with this: check that focused inputs scroll clear of the keyboard. With a 502px-wide portrait layout, forms run long, and there is no `scrollIntoView` handling anywhere in the codebase.

### Labels are decorative

```
<label> elements : 43
htmlFor          : 0
aria-*           : 4
```

No label is linked to its input, so tapping a label does not focus its field. On a touch device that is a wasted tap target on every form, and screen readers announce the inputs unlabelled.

```jsx
<label htmlFor="doctor-name">Doctor Name</label>
<input id="doctor-name" ... />
```

### Destructive actions use native dialogs

6 `confirm()` and 2 `alert()` calls. Unstyled system dialogs that cannot show context — "Are you sure?" without naming the record is how people delete the wrong one. Replace with a styled modal naming the record and consequence: *"Delete Dr. Sharma's May sales entry (₹42,000)? This cannot be undone."*

---

## Corrections to the earlier phone-based review

Being explicit about what changed, since these were stated more strongly than the evidence now supports.

### Downgraded: text sizes

573 inline font sizes sit below 12px, including 20 at 8px and 79 at 9px. On a phone I called this illegible. On a 10-11" iPad held at desk distance, 10-11px is *poor but workable*, and 8-9px is still too small for anything that matters.

Still worth fixing — fourteen distinct sizes between 8 and 21px is not a type scale, it is a decision made fresh at every call site — but this drops from urgent to housekeeping. Set a floor of 11px, define `--text-xs` through `--text-xl` in `:root`, and clean up as you touch each screen.

### Substantially retracted: wide tables

I implied 89 hardcoded `minWidth` values were forcing horizontal scrolling. That was misleading. Checking the actual distribution, only **6 exceed 500px**:

| File | Line | minWidth |
|---|---|---|
| Dashboard.jsx | 510 | 1050 |
| Dashboard.jsx | 383 | 1040 |
| WeeklyReports.jsx | 173 | 920 |
| ROIDashboard.jsx | 3245 | 980 |
| WeeklyReports.jsx | 163 | 860 |
| ROIDashboard.jsx | 3310 | 760 |

The other 83 are 380px or below and fit fine. In landscape all six fit. In portrait at the current 502px they all scroll; after the tablet breakpoint fix (~710px) four of the six still scroll but far less.

Two of them are on `Dashboard.jsx`, which is the rep's landing screen — so reps do hit this daily.

**Revised fix.** The stacked-card mobile layout I suggested is unnecessary for iPad. Cheaper and sufficient: sticky first column so the row label stays visible while scrolling sideways, and hide 2-3 low-value columns below 1024px behind a "show all columns" toggle.

### Unchanged: inline styles

2,159 inline `style={{}}` objects, 654 in ROIDashboard and 505 in Dashboard. Inline styles cannot respond to media queries, so any breakpoint you add — including the tablet one above — can only reach what is in `styles.css`. This is what will make each future layout fix harder than it should be.

Not a rewrite. Move *layout* properties (width, padding, grid, flex-direction, font-size) into classes; leave genuinely dynamic values (a computed bar width, a status colour from data) inline where they belong. Do the two big screens first — they are 54% of the total.

---

## Offline — more important on iPad, not less

`manifest.json` declares `display: standalone`, five icon sizes and three shortcuts. `InstallBanner.jsx` detects iOS and shows the right instructions. `index.html` registers the service worker and handles updates.

But `sw.js` caches exactly one thing:

```js
const OFFLINE_URLS = ['/index.html'];

self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
  }
});
```

The JS and CSS bundles are not cached and API responses are neither cached nor queued. Offline, a navigation returns the shell, the shell requests a bundle that is not there, and the rep gets a blank screen.

**This gets worse on iPad, not better.** Most iPads are wifi-only — no cellular fallback. A phone in a clinic with no wifi still has 4G; a wifi-only iPad has nothing. And there is no local persistence anywhere in the app, so a rep who fills in a week of sales and taps submit on a dropped connection loses the entire form.

You are already sending SMS reminders chasing weekly submissions. Making submission survive a bad connection is the highest-leverage thing available for compliance.

**In order of value:**

1. **Never lose typed input.** Mirror form state to IndexedDB on change, restore on mount. Independent of connectivity, prevents the worst outcome.
2. **Precache the app shell** — bundles, CSS, fonts — so it boots offline. Workbox `InjectManifest`; `react-scripts` 5 supports it.
3. **Queue writes with Background Sync**, with a "3 entries pending sync" chip in the header.
4. **Cache reads stale-while-revalidate** for doctor and product master data, which barely change and are needed to fill in a form.

---

## Two iPad-specific things worth checking on device

**Split View and Slide Over.** iPadOS lets a user run the app at roughly half or a third of the screen — around 507px or 320px wide. At those widths the app drops below the 768px breakpoint into the phone layout, which at least degrades gracefully. But a rep with Mail open alongside is in the worst case: phone layout on a large screen. Worth deciding whether to support it or leave it.

**Orientation changes.** `manifest.json` sets `"orientation": "any"`, so a rep rotating between portrait and landscape crosses the 768px boundary and the layout switches wholesale mid-task. With the tablet breakpoint added this becomes a smoother two-step. Test that form state survives rotation — React will not remount, but any component keyed on width will.

---

## What is genuinely good

Worth stating plainly, since the list above is long:

- The colour system is disciplined — every semantic colour has matched `-bg` and `-border` variants, which is why the status chips read as a coherent family.
- Role-based navigation with grouped sections (Overview / My Work / Performance / Administration / Organisation) is real information architecture. A rep sees 7 relevant items, not 20 with 13 greyed out.
- `Login.jsx` handles loading, error and password-reveal states properly, with `autoFocus` and a semantic `<form>`.
- `.kpi-grid` uses `repeat(auto-fit, minmax(170px, 1fr))` — genuinely responsive, and it reflows correctly at every iPad width without help.
- The PWA shell shows real knowledge: safe-area insets, `touch-action: manipulation`, iOS install instructions, service-worker update handling via `controllerchange`.
- 19 of 23 screens have loading states; 71 `catch` blocks.

The gap is not skill or care. The polish went into the design system and the PWA shell, the screens were built fast and inline, and the one breakpoint that exists was chosen for phones on a product used on tablets.

---

## Suggested order

**An afternoon, disproportionate payoff:**

1. Input `font-size: 16px` + `padding: 12px 14px` — kills iPadOS zoom, fixes touch targets, every form.
2. Tablet breakpoint at 769-1024px with an icon-only sidebar — takes portrait content from 502px to ~710px.
3. Persist sidebar collapse state to `localStorage`.
4. `autoComplete` and `inputMode` on all inputs — restores autofill and numeric keypads.
5. `htmlFor`/`id` on all 43 labels.

**Next sprint:**

6. Offline form persistence to IndexedDB.
7. Precache the app shell.
8. Sticky first column on the six wide tables; hide low-value columns under 1024px.

**As you touch each screen:**

9. Move layout out of inline styles, starting with `Dashboard.jsx` and `ROIDashboard.jsx`.
10. Define a type scale; raise the floor to 11px.
11. Replace `confirm()`/`alert()` with styled modals.
12. Split `ROIDashboard.jsx` (3,514 lines, four nav entries, one file) and give each tab a real route.

Before any of it: install the PWA on the actual iPad model your reps carry, in portrait, and enter a full week of sales on a throttled connection. The 502px number above is arithmetic — ten minutes on the real device will tell you how it actually feels, and will surface things the source cannot show.
