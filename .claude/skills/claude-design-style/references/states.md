# UI States Reference

Empty states, skeleton loading, toast notifications, and error pages for the Anthropic/Claude design style.

## Empty States

### Anatomy

Every empty state has three layers: illustration (optional) + heading + description + CTA (optional). Keep tone calm and helpful, not apologetic.

```css
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 64px 32px;
  gap: 12px;
}

.empty-state-icon {
  width: 48px;
  height: 48px;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}

.empty-state-title {
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.empty-state-desc {
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--text-secondary);
  max-width: 320px;
  line-height: 1.6;
  margin: 0;
}

.empty-state .btn-primary {
  margin-top: 8px;
}
```

### Three Empty State Types

```html
<!-- 1. Onboarding / First use -->
<div class="empty-state">
  <svg class="empty-state-icon"><!-- inbox icon --></svg>
  <h3 class="empty-state-title">No conversations yet</h3>
  <p class="empty-state-desc">Start a new conversation to begin exploring.</p>
  <button class="btn-primary">New Conversation</button>
</div>

<!-- 2. No results (after search/filter) -->
<div class="empty-state">
  <svg class="empty-state-icon"><!-- search icon --></svg>
  <h3 class="empty-state-title">No results found</h3>
  <p class="empty-state-desc">Try adjusting your search or filters.</p>
</div>

<!-- 3. Error / Failed to load -->
<div class="empty-state">
  <svg class="empty-state-icon"><!-- alert icon --></svg>
  <h3 class="empty-state-title">Something went wrong</h3>
  <p class="empty-state-desc">We couldn't load this content. Please try again.</p>
  <button class="btn-secondary">Retry</button>
</div>
```

---

## Skeleton Loading

### Design Principles

- Background: `var(--bg-hover)` — slightly darker than page
- Animation: gentle pulse (opacity 1 → 0.5 → 1), 2s duration
- Shimmer effect: subtle left-to-right gradient sweep (optional, more polished)
- Border-radius: match the actual content it represents

```css
@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

@keyframes skeleton-shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

/* Base skeleton */
.skeleton {
  background: var(--bg-hover);
  border-radius: 4px;
  animation: skeleton-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* Shimmer variant (more polished) */
.skeleton-shimmer {
  background: linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-muted) 50%, var(--bg-hover) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.8s linear infinite;
}
```

### Common Skeleton Variants

```css
.skeleton-text {
  height: 14px;
  border-radius: 3px;
}
.skeleton-text-lg {
  height: 18px;
  border-radius: 3px;
}
.skeleton-heading {
  height: 24px;
  border-radius: 4px;
  width: 60%;
}
.skeleton-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  flex-shrink: 0;
}
.skeleton-avatar-lg {
  width: 48px;
  height: 48px;
  border-radius: 12px;
}
.skeleton-badge {
  height: 20px;
  width: 60px;
  border-radius: 4px;
}
.skeleton-button {
  height: 36px;
  width: 100px;
  border-radius: 7.5px;
}
.skeleton-card {
  height: 120px;
  border-radius: 8px;
}
.skeleton-image {
  border-radius: 8px;
} /* set width/height inline */
```

### Card Skeleton Pattern

```html
<div class="card" aria-busy="true" aria-label="Loading...">
  <div style="display:flex; gap:12px; align-items:center; margin-bottom:16px;">
    <div class="skeleton skeleton-avatar"></div>
    <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
      <div class="skeleton skeleton-text" style="width:70%;"></div>
      <div class="skeleton skeleton-text" style="width:40%;"></div>
    </div>
  </div>
  <div style="display:flex; flex-direction:column; gap:8px;">
    <div class="skeleton skeleton-text" style="width:100%;"></div>
    <div class="skeleton skeleton-text" style="width:90%;"></div>
    <div class="skeleton skeleton-text" style="width:60%;"></div>
  </div>
</div>
```

### Dark Mode Skeletons

```css
.dark .skeleton {
  background: var(--bg-hover); /* #2a2a27 — already appropriate */
}
.dark .skeleton-shimmer {
  background: linear-gradient(90deg, var(--bg-hover) 25%, #333330 50%, var(--bg-hover) 75%);
  background-size: 200% 100%;
}
```

---

## Toast / Notifications

### Placement and Stack

- Default position: **bottom-center** (matches claude.ai) or bottom-right
- Max width: 380px
- Stack top-to-bottom, newest at bottom
- Auto-dismiss: 4000ms (success/info), 6000ms (error — user needs to read)

```css
/* Toast container */
.toast-container {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

/* Toast base */
.toast {
  padding: 12px 16px;
  border-radius: 8px;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 280px;
  max-width: 380px;
  box-shadow: var(--shadow-md);
  pointer-events: all;
  animation: toast-in 300ms cubic-bezier(0, 0, 0.2, 1) forwards;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes toast-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(8px);
  }
}

/* Default — neutral dark */
.toast {
  background: var(--bg-button);
  color: var(--text-on-button);
}

/* Success — derived from --state-success */
.toast.success {
  background: color-mix(in srgb, var(--state-success, #5a856a) 30%, #0f0f0e);
  color: color-mix(in srgb, var(--state-success, #5a856a) 25%, #faf9f5);
}

/* Error — derived from --state-error */
.toast.error {
  background: color-mix(in srgb, var(--state-error, #b85b44) 25%, #0f0f0e);
  color: color-mix(in srgb, var(--state-error, #b85b44) 20%, #faf9f5);
}

/* Warning — derived from --state-warning */
.toast.warning {
  background: color-mix(in srgb, var(--state-warning, #c4923a) 25%, #0f0f0e);
  color: color-mix(in srgb, var(--state-warning, #c4923a) 20%, #faf9f5);
}

/*
 * Fallback for browsers without color-mix() support:
 * success:  background: #1a3d2b; color: #d1fae5;
 * error:    background: #3d1a1a; color: #fecaca;
 * warning:  background: #3d2e0a; color: #fef3c7;
 */

.toast .icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.toast-close {
  margin-left: auto;
  background: none;
  border: none;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  padding: 2px;
  line-height: 1;
  transition: opacity 150ms ease;
}
.toast-close:hover {
  opacity: 1;
}
```

### Accessibility

```html
<!-- Toast region — screen readers announce changes -->
<div
  role="status"
  aria-live="polite"
  aria-atomic="true"
  class="toast-container"
  id="toast-container"
>
  <!-- Toasts injected here -->
</div>

<!-- For errors (higher urgency): aria-live="assertive" -->
```

---

## Progress Bar

```css
/* Linear progress */
.progress-bar {
  height: 4px;
  background: var(--bg-hover);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--text-primary);
  border-radius: 2px;
  transition: width 300ms ease;
}

/* Indeterminate (unknown duration) */
@keyframes indeterminate {
  0% {
    transform: translateX(-100%) scaleX(0.5);
  }
  50% {
    transform: translateX(0%) scaleX(0.5);
  }
  100% {
    transform: translateX(200%) scaleX(0.5);
  }
}

.progress-bar.indeterminate .progress-fill {
  width: 50%;
  animation: indeterminate 1.5s ease-in-out infinite;
}

/* Page-level progress (NProgress-style top bar) */
.page-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--text-primary);
  z-index: 9999;
  transform-origin: left;
}
```

---

## Error Pages

### 404

```html
<div class="error-page">
  <p class="error-code">404</p>
  <h1 class="error-title">Page not found</h1>
  <p class="error-desc">The page you're looking for doesn't exist or has been moved.</p>
  <a href="/" class="btn-primary">Back to home</a>
</div>
```

```css
.error-page {
  min-height: calc(100vh - 68px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 64px 32px;
  gap: 12px;
}

.error-code {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin: 0 0 8px;
}

.error-title {
  font-family: var(--font-sans);
  font-size: clamp(1.75rem, 1.52rem + 0.98vw, 2.5rem);
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  margin: 0;
}

.error-desc {
  font-size: 16px;
  color: var(--text-secondary);
  max-width: 400px;
  line-height: 1.6;
  margin: 0 0 16px;
}
```

### Offline Banner

```css
.offline-banner {
  position: fixed;
  top: var(--nav-height, 68px); /* below nav — inherits from layout.md */
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  background: var(--bg-button);
  color: var(--text-on-button);
  border-radius: 0 0 8px 8px;
  font-size: 13px;
  z-index: 500;
  display: flex;
  align-items: center;
  gap: 8px;
}
```

### 500 / 503 Error Pages

Server-side error pages share the same layout as 404, with adjusted copy.

```html
<!-- 500: Internal Server Error -->
<div class="error-page">
  <p class="error-code">500</p>
  <h1 class="error-title">Something went wrong</h1>
  <p class="error-desc">We're working on it. Please try again in a moment.</p>
  <a href="/" class="btn-primary">Back to home</a>
</div>

<!-- 503: Maintenance / Service Unavailable -->
<div class="error-page">
  <p class="error-code">503</p>
  <h1 class="error-title">We'll be back soon</h1>
  <p class="error-desc">We're performing scheduled maintenance. Check back shortly.</p>
  <a href="/" class="btn-secondary">Back to home</a>
</div>
```

The `.error-page`, `.error-code`, `.error-title`, and `.error-desc` classes are shared with the 404 page above — no additional CSS required.

---

## Full-Page Loading (Route Transitions)

### Top Progress Bar (NProgress-style)

A thin line across the top of the viewport signals route transitions. The `.page-progress` base style is already defined in the **Progress Bar** section above. Use JavaScript to animate width from 0% → 85% during load, then to 100% on complete.

```css
/* Extend .page-progress with animated fill */
.page-progress-bar {
  position: fixed;
  top: 0;
  left: 0;
  height: 2px;
  background: var(--text-primary);
  z-index: 9999;
  transform-origin: left;
  transition: width 300ms ease;
  /* Start hidden */
  width: 0%;
}

/* Animate to ~85% during load */
.page-progress-bar.loading {
  width: 85%;
  transition: width 10s cubic-bezier(0.1, 0.05, 0, 1); /* decelerate near end */
}

/* Snap to 100% on complete */
.page-progress-bar.done {
  width: 100%;
  transition: width 150ms ease;
}

/* Fade out after complete */
.page-progress-bar.fade-out {
  opacity: 0;
  transition: opacity 300ms ease 150ms;
}
```

### Full-Page Overlay + Spinner (Optional)

For heavier transitions where a skeleton is not available:

```css
.page-loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(250, 249, 245, 0.7); /* --bg-primary at 70% */
  backdrop-filter: blur(2px);
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fade-in 200ms ease;
}

.dark .page-loading-overlay {
  background: rgba(26, 26, 24, 0.7); /* --bg-primary dark at 70% */
}

/* Spinner — reuses existing spinner keyframe if defined */
.page-spinner {
  width: 32px;
  height: 32px;
  border: 2px solid var(--border-default);
  border-top-color: var(--text-primary);
  border-radius: 50%;
  animation: spin 600ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
```

---

## Pagination

### Accessible HTML Structure

```html
<nav aria-label="pagination">
  <div class="pagination">
    <button class="page-btn page-prev" aria-label="Previous page">‹</button>
    <button class="page-btn" aria-label="Page 1">1</button>
    <button class="page-btn active" aria-current="page" aria-label="Page 2, current">2</button>
    <button class="page-btn" aria-label="Page 3">3</button>
    <span class="page-ellipsis" aria-hidden="true">…</span>
    <button class="page-btn" aria-label="Page 10">10</button>
    <button class="page-btn page-next" aria-label="Next page">›</button>
  </div>
</nav>
```

```css
.pagination {
  display: flex;
  align-items: center;
  gap: 4px;
}

.page-btn {
  min-width: 32px;
  height: 32px;
  border-radius: 7.5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms ease;
}

.page-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.page-btn.active {
  background: var(--bg-button);
  color: var(--text-on-button);
  border-color: var(--bg-button);
}

.page-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.page-ellipsis {
  color: var(--text-tertiary);
  font-size: 14px;
  padding: 0 4px;
  line-height: 32px;
}

/* Page info label */
.pagination-info {
  font-size: 13px;
  color: var(--text-secondary);
  margin-left: 8px;
}
```

---

## Mobile Adaptations

### Toast on Mobile

```css
@media (max-width: 767px) {
  .toast-container {
    bottom: calc(16px + env(safe-area-inset-bottom));
    left: 16px;
    right: 16px;
    transform: none;
  }

  .toast {
    min-width: auto;
    max-width: none;
    width: 100%;
  }
}
```

### Pagination on Mobile

```css
@media (max-width: 479px) {
  .page-btn {
    min-width: 44px;
    height: 44px;
    font-size: 15px;
  }

  /* Hide ellipsis and middle pages — show only prev/next + current */
  .page-ellipsis {
    display: none;
  }
  .page-btn:not(.active):not(.page-prev):not(.page-next) {
    display: none;
  }

  .pagination-info {
    display: none;
  }
}
```

### Empty State on Mobile

```css
@media (max-width: 479px) {
  .empty-state {
    padding: 48px 24px;
  }

  .empty-state-icon {
    width: 40px;
    height: 40px;
  }
}
```

### Error Page on Mobile

```css
@media (max-width: 479px) {
  .error-page {
    padding: 48px 24px;
    min-height: calc(100vh - var(--nav-height-mobile, 56px));
  }
}
```
