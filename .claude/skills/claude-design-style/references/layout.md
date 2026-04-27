# Layout System Reference

Grid system, responsive design, and page structure for the Anthropic/Claude design style.

## Core Layout Values

```css
:root {
  /* Content widths */
  --width-reading: 640px; /* articles, blog posts */
  --width-chat: 768px; /* chat/app content area */
  --width-chat-wide: 840px; /* large screens */
  --width-page: 1200px; /* full page max */
  --width-full: 1440px; /* absolute max */

  /* Site margins (responsive) */
  --site-margin: clamp(2rem, 1.08rem + 3.92vw, 5rem); /* 32-80px */

  /* Navigation */
  --nav-height: 68px; /* 4.25rem — used at 768px+ */
  --nav-height-mobile: 56px; /* 3.5rem — used below 768px */

  /* Grid */
  --grid-columns: 12;
  --grid-gap: 16px;
}
```

## Reading Layout (Articles / Blog)

```css
.reading-column {
  max-width: var(--width-reading); /* 640px */
  margin: 0 auto;
  padding: 48px 32px; /* py-12 px-8 */
}

@media (min-width: 768px) {
  .reading-column {
    padding: 48px 64px; /* py-12 px-16 */
  }
}
```

## Page Structure

```
┌─────────────────────────────────────────────────────────┐
│ Nav (68px, border-bottom 1px)                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌─────────────────────────────────────────────────┐   │
│   │  Content (max-width: 640px, margin: 0 auto)     │   │
│   │                                                 │   │
│   │  H1 hero title                                  │   │
│   │  ────────────── 64px gap ──────────────         │   │
│   │  Section content                                │   │
│   │  ────────────── 64px gap ──────────────         │   │
│   │  Section content                                │   │
│   │                                                 │   │
│   └─────────────────────────────────────────────────┘   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Footer (text-only, small type, generous top margin)     │
└─────────────────────────────────────────────────────────┘
```

## Grid System (12 Column)

```css
.grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: var(--grid-gap);
  max-width: var(--width-page);
  margin: 0 auto;
  padding: 0 var(--site-margin);
}

/* Common column spans */
.col-full {
  grid-column: span 12;
}
.col-half {
  grid-column: span 6;
}
.col-third {
  grid-column: span 4;
}
.col-quarter {
  grid-column: span 3;
}
.col-two-thirds {
  grid-column: span 8;
}

/* Responsive: stack on mobile */
@media (max-width: 767px) {
  .col-half,
  .col-third,
  .col-quarter,
  .col-two-thirds {
    grid-column: span 12;
  }
}
```

## Navigation Bar

```css
.nav {
  height: var(--nav-height);
  padding: 0 var(--site-margin);
  border-bottom: 1px solid var(--border-section);
  background: var(--bg-primary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: sticky;
  top: 0;
  z-index: 200;
}

/* Mobile nav */
@media (max-width: 767px) {
  .nav {
    height: var(--nav-height-mobile);
  }
}

/* Dropdown animation */
.nav-dropdown {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 200ms ease;
}
.nav-dropdown.open {
  grid-template-rows: 1fr;
}
```

## Announcement Banner

```css
.announcement-banner {
  height: 44px; /* 2.75rem */
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-button); /* dark bg */
  color: var(--text-on-button); /* cream text */
  font-size: 14px;
  font-family: var(--font-sans);
  padding: 0 var(--site-margin);
  border-bottom: 1px solid var(--border-section);
}
.announcement-banner a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 0.15em;
}
```

## Section Spacing

```css
/* Between major sections */
.section {
  padding: 64px 0; /* py-16 */
}

/* With top border separator */
.section-bordered {
  padding: 64px 0;
  border-top: 1px solid var(--border-section);
}

/* Hero section (extra space) */
.section-hero {
  padding: 80px 0; /* py-20 */
  text-align: center;
}

/* Tight section (within same topic) */
.section-tight {
  padding: 32px 0; /* py-8 */
}
```

## Responsive Breakpoints

```css
:root {
  /* Anthropic.com actual breakpoints (from research) */
  --bp-mobile-sm: 479px; /* small mobile */
  --bp-tablet: 600px; /* tablets */
  --bp-desktop: 896px; /* desktop (56em) — marketing site wide layout */

  /* Claude.ai app breakpoints */
  --bp-sm: 640px;
  --bp-md: 768px;
  --bp-lg: 1024px;
  --bp-xl: 1280px;
}

/*
 * Note: CSS custom properties cannot be used directly in @media queries.
 * Use these values as a reference. For media queries, use the literal values:
 *   @media (min-width: 640px)  — sm
 *   @media (min-width: 768px)  — md
 *   @media (min-width: 1024px) — lg
 *   @media (min-width: 1280px) — xl
 * Or use @custom-media (CSS Level 5, requires PostCSS plugin):
 *   @custom-media --screen-sm (min-width: 640px);
 */
```

**Note:** Anthropic's marketing site uses fewer, wider breakpoints and relies heavily on fluid clamp() values, while the Claude app uses more granular breakpoints for the complex sidebar+chat+artifact layout.

### Breakpoint Behavior

| Breakpoint  | Nav                       | Sidebar         | Content Width | Layout                       |
| ----------- | ------------------------- | --------------- | ------------- | ---------------------------- |
| < 479px     | 56px, hamburger (< 768px) | Hidden          | 100%          | Single column, compressed    |
| 480-599px   | 56px, hamburger (< 768px) | Hidden (drawer) | 100%          | Single column                |
| 600-767px   | 56px, hamburger (< 768px) | Hidden (drawer) | 100%          | Single column                |
| 768-895px   | 68px                      | Collapsible     | max 640/768px | 1-2 columns                  |
| 896-1023px  | 68px                      | Collapsible     | max 640/768px | Sidebar + content            |
| 1024-1279px | 68px                      | Fixed 260-280px | max 640/768px | Sidebar + content            |
| >= 1280px   | 68px                      | Fixed 280-300px | max 640/840px | Sidebar + content + artifact |

### Content Width Contexts

- **640px**: Reading articles, blog posts, documentation (optimal reading line length)
- **768px**: Chat messages, general app content
- **840px**: Wide chat with artifacts visible
- **1200px**: Full page layouts (card grids, landing pages)
- **1440px**: Ultra-wide max (never wider)

## Footer

```css
.footer {
  margin-top: 80px;
  padding: 48px var(--site-margin) 32px;
  border-top: 1px solid var(--border-section);
}

.footer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 32px;
  margin-bottom: 48px;
}

.footer-heading {
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  margin-bottom: 16px;
}

.footer-link {
  font-size: 14px;
  color: var(--text-secondary);
  text-decoration: none;
  display: block;
  padding: 4px 0;
}
.footer-link:hover {
  color: var(--text-primary);
}

.footer-copyright {
  font-size: 12px;
  color: var(--text-tertiary);
  padding-top: 24px;
  border-top: 1px solid var(--border-section);
}
```

## Card Grid (Research/News Pages)

```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
  max-width: var(--width-page);
  margin: 0 auto;
  padding: 0 var(--site-margin);
}

/* Featured card (spans 2 columns) */
.card-featured {
  grid-column: span 2;
}

@media (max-width: 767px) {
  .card-grid {
    grid-template-columns: 1fr;
  }
  .card-featured {
    grid-column: span 1;
  }
}
```

## Mobile Drawer/Overlay

```css
.drawer {
  position: fixed;
  top: 0;
  left: 0;
  width: min(80vw, 280px);
  height: 100vh;
  background: var(--bg-primary);
  transform: translateX(-100%);
  transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 1000;
}
.drawer.open {
  transform: translateX(0);
}

.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 300ms ease,
    visibility 300ms ease;
  z-index: 999;
}
.drawer-overlay.active {
  opacity: 1;
  visibility: visible;
}
```

## Mobile-First Essentials

Every page generated with this design system MUST include these mobile foundations.

### Viewport Meta

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

### Safe Areas (Notch / Dynamic Island / Home Indicator)

```css
:root {
  --safe-top: env(safe-area-inset-top);
  --safe-bottom: env(safe-area-inset-bottom);
  --safe-left: env(safe-area-inset-left);
  --safe-right: env(safe-area-inset-right);
}

/* Fixed bottom elements must respect home indicator */
.fixed-bottom {
  padding-bottom: calc(16px + var(--safe-bottom));
}

/* Full-bleed layouts must respect notch */
.full-bleed {
  padding-left: max(var(--site-margin), var(--safe-left));
  padding-right: max(var(--site-margin), var(--safe-right));
}
```

### Touch Targets

```css
/* Minimum 44x44px touch targets (Apple HIG / WCAG) */
button,
a,
[role='button'],
input[type='checkbox'],
input[type='radio'] {
  min-height: 44px;
  min-width: 44px;
}

/* Small icon buttons need padding to reach 44px */
.icon-btn {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Increase tap area without changing visual size */
.tap-area-extend {
  position: relative;
}
.tap-area-extend::after {
  content: '';
  position: absolute;
  inset: -8px;
}
```

### iOS Input Zoom Prevention

```css
/* iOS zooms on focus if font-size < 16px */
@media (max-width: 767px) {
  input,
  textarea,
  select {
    font-size: 16px !important;
  }
}
```

### Scroll Behavior

```css
/* Smooth scroll with reduced-motion respect */
html {
  scroll-behavior: smooth;
}
@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
}

/* Prevent overscroll bounce on body (optional) */
body {
  overscroll-behavior-y: none;
}

/* Scroll snap for carousels on mobile */
.mobile-carousel {
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
}
.mobile-carousel > * {
  scroll-snap-align: start;
}
```

### Mobile Typography Adjustments

```css
@media (max-width: 479px) {
  /* Tighten spacing on very small screens */
  :root {
    --site-margin: 16px;
  }

  /* Prevent long words from breaking layout */
  body {
    overflow-wrap: break-word;
    word-break: break-word;
    hyphens: auto;
  }

  /* Slightly reduce body font for very small screens */
  body {
    font-size: 16px; /* 17px → 16px on xs screens */
  }
}
```

### Absolute-Positioned Badge Overflow Protection

```css
/* Badges positioned above cards need parent margin-top to prevent clipping */
.card-with-badge {
  position: relative;
  margin-top: 16px;
}

@media (max-width: 479px) {
  .badge-floating {
    font-size: 10px;
    padding: 2px 8px;
  }
}
```

### Mobile Navigation Pattern

```css
/* Hamburger button */
.nav-hamburger {
  display: none;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
}

@media (max-width: 767px) {
  .nav-hamburger {
    display: flex;
  }
  .nav-links {
    display: none;
  }

  /* Mobile nav menu */
  .nav-mobile-menu {
    position: fixed;
    inset: 0;
    top: var(--nav-height-mobile);
    background: var(--bg-primary);
    padding: 16px var(--site-margin);
    z-index: 199;
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 300ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .nav-mobile-menu.open {
    grid-template-rows: 1fr;
  }
  .nav-mobile-menu > * {
    overflow: hidden;
  }

  .nav-mobile-menu a {
    display: block;
    padding: 12px 0;
    font-size: 17px;
    border-bottom: 1px solid var(--border-section);
  }
}
```

## Z-Index Scale

```css
--z-base: 1;
--z-dropdown: 100;
--z-sticky: 200; /* nav, sticky headers */
--z-drawer: 900;
--z-overlay: 999;
--z-modal: 1000;
--z-toast: 2000;
```
