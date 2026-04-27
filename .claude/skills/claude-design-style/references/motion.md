# Motion and Animation Reference

Transition presets, keyframe animations, and loading states for the Anthropic/Claude design style.

## Design Principles

- **Subtle and fast** — 150-300ms, no bouncy/spring physics
- **Purpose-driven** — animate only to communicate state change
- **Color transitions preferred** — simple color/opacity shifts over transforms
- **Minimal displacement** — max 1-2px translateY for hover, 8-10px for entrance
- **Respect user preferences** — honor `prefers-reduced-motion`

## Transition Presets

```css
:root {
  /* Speed tiers */
  --duration-fast: 150ms;
  --duration-base: 200ms;
  --duration-slow: 300ms;
  --duration-menu: 400ms;
  --duration-page: 600ms;

  /* Easing curves - Standard */
  --ease-default: ease;
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1); /* Material standard */
  --ease-out: cubic-bezier(0, 0, 0.2, 1); /* decelerate — exits */
  --ease-in: cubic-bezier(0.4, 0, 1, 1); /* accelerate — enters */

  /* Easing curves - Anthropic signature (from GSAP analysis) */
  --ease-anthropic: cubic-bezier(0.16, 1, 0.3, 1); /* Fast start, gentle settle */
  --ease-scale: cubic-bezier(0.4, 0, 0.2, 1); /* Hover card scale */

  /* Composite presets */
  --transition-fast: var(--duration-fast) var(--ease-default);
  --transition-base: var(--duration-base) var(--ease-default);
  --transition-slow: var(--duration-slow) var(--ease-in-out);
  --transition-menu: var(--duration-menu) var(--ease-default);
}
```

## Common Transition Patterns

```css
/* Color change (links, nav items, ghost buttons) */
.color-transition {
  transition: color var(--transition-fast);
}

/* Background change (list items, cards) */
.bg-transition {
  transition: background-color var(--transition-fast);
}

/* General interactive (buttons, inputs) */
.interactive {
  transition: all var(--transition-base);
}

/* Button hover lift */
.btn-hover:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.btn-hover:active {
  transform: translateY(0);
}

/* Sidebar slide */
.sidebar {
  transition: transform var(--transition-slow);
}
.sidebar.closed {
  transform: translateX(-100%);
}
.sidebar.open {
  transform: translateX(0);
}

/* Dropdown menu (grid-rows technique) */
.dropdown {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--transition-menu);
}
.dropdown.open {
  grid-template-rows: 1fr;
}
.dropdown > * {
  overflow: hidden;
}
```

## Keyframe Animations

### Skeleton Loading

```css
@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.skeleton {
  background: var(--bg-hover);
  border-radius: 4px;
  animation: skeleton-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* Skeleton variants */
.skeleton-text {
  height: 16px;
  width: 80%;
}
.skeleton-heading {
  height: 24px;
  width: 60%;
}
.skeleton-avatar {
  height: 32px;
  width: 32px;
  border-radius: 8px;
}
.skeleton-block {
  height: 120px;
  width: 100%;
  border-radius: 8px;
}
```

### Streaming Cursor (AI typing indicator)

```css
@keyframes cursor-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

.streaming-cursor {
  display: inline-block;
  width: 2px;
  height: 1.1em;
  background: var(--text-primary);
  border-radius: 1px;
  margin-left: 1px;
  vertical-align: text-bottom;
  animation: cursor-blink 1s ease-in-out infinite;
}
```

### Thinking Dots

```css
@keyframes thinking-bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.5;
  }
  30% {
    transform: translateY(-6px);
    opacity: 1;
  }
}

.thinking-dots {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 8px 0;
}

.thinking-dot {
  width: 6px;
  height: 6px;
  background: var(--text-tertiary);
  border-radius: 50%;
  animation: thinking-bounce 1.4s ease-in-out infinite;
}
.thinking-dot:nth-child(2) {
  animation-delay: 0.16s;
}
.thinking-dot:nth-child(3) {
  animation-delay: 0.32s;
}
```

### Fade In (message entrance)

```css
@keyframes fade-in-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fade-in {
  animation: fade-in-up 300ms var(--ease-out) forwards;
}
```

### Spinner

```css
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-default);
  border-top-color: var(--text-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
```

## GSAP Scroll-Triggered Animations

```css
/* GSAP ScrollTrigger Pattern (Anthropic.com) */
/* Elements start 24px below, fade in over 800ms */
```

```javascript
// Standard scroll reveal
gsap.registerPlugin(ScrollTrigger);

gsap.utils.toArray('.fade-in').forEach((el) => {
  gsap.from(el, {
    y: 24,
    opacity: 0,
    duration: 0.8,
    ease: 'power2.out',
    scrollTrigger: {
      trigger: el,
      start: 'top 80%',
      toggleActions: 'play none none reverse',
    },
  });
});

// Word-by-word fade-in (headline effect)
gsap.utils.toArray('.word-fade').forEach((el) => {
  const words = el.textContent.split(' ');
  el.innerHTML = words.map((w) => `<span class="word">${w}</span>`).join(' ');
  gsap.from(el.querySelectorAll('.word'), {
    y: 24,
    opacity: 0,
    duration: 0.8,
    stagger: 0.05,
    ease: 'power2.out',
    scrollTrigger: { trigger: el, start: 'top 80%' },
  });
});
```

## Staggered Entrance

```css
@keyframes stagger-fade-in {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.stagger-item {
  opacity: 0;
  animation: stagger-fade-in 400ms ease-out forwards;
}
.stagger-item:nth-child(1) {
  animation-delay: 0ms;
}
.stagger-item:nth-child(2) {
  animation-delay: 80ms;
}
.stagger-item:nth-child(3) {
  animation-delay: 160ms;
}
.stagger-item:nth-child(4) {
  animation-delay: 240ms;
}
/* Pattern: 80ms increments */
```

## Mobile Menu Clip-Path

```css
/* Full-screen mobile menu (anthropic.com pattern) */
.mobile-menu {
  position: fixed;
  inset: 0;
  background: var(--bg-primary);
  clip-path: circle(0% at top right);
  transition: clip-path 400ms ease;
  z-index: 1000;
}
.mobile-menu.open {
  clip-path: circle(150% at top right);
}
```

## Lottie Animation Integration

```javascript
import lottie from 'lottie-web';

/**
 * Lottie with theme awareness (claude.com pattern)
 * - SVG animations that swap colors based on CSS theme
 * - Scroll-triggered with segmented playback
 * - Lazy loading via IntersectionObserver
 * - Requires: lottie-web (npm install lottie-web)
 */
function initLottie(
  container,
  {
    path, // URL to .json animation file
    introFrames = [0, 60], // [start, end] for intro segment
    loopFrames = [60, 120], // [start, end] for loop segment
    lazyLoad = true,
  } = {},
) {
  let anim = null;

  function load() {
    anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      path,
    });

    anim.addEventListener('DOMLoaded', () => {
      // Apply theme colors to SVG paths
      applyThemeColors(container);

      // 1. Play intro segment on first view
      anim.playSegments(introFrames, true);

      // 2. Auto-loop after intro completes
      anim.addEventListener('complete', () => {
        anim.playSegments(loopFrames, true);
        anim.loop = true;
      });
    });
  }

  function applyThemeColors(el) {
    const isDark =
      document.documentElement.classList.contains('dark') ||
      document.documentElement.dataset.theme === 'dark';
    const fills = el.querySelectorAll('path[fill], circle[fill]');
    fills.forEach((path) => {
      const fill = path.getAttribute('fill');
      // Swap black/white fills based on theme
      if (fill === '#141413' || fill === '#000000') {
        path.setAttribute('fill', isDark ? '#ece9e1' : '#141413');
      }
    });
  }

  // Lazy load: only initialize when element enters viewport
  if (lazyLoad && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          load();
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }, // Preload 200px before visible
    );
    observer.observe(container);
  } else {
    load();
  }

  return {
    destroy: () => anim?.destroy(),
    replay: () => {
      anim?.goToAndPlay(introFrames[0], true);
    },
  };
}

// Usage:
// initLottie(document.querySelector('.hero-animation'), {
//   path: '/animations/hero.json',
//   introFrames: [0, 90],
//   loopFrames: [90, 180],
// });
```

## Duration Standards

**Micro-interactions:** 150ms (color, opacity)

**Standard transitions:** 200-300ms (hover, toggle)

**Menu/accordion:** 400ms (open/close)

**Scroll reveals:** 600-800ms (GSAP)

**Page transitions:** 400-600ms

## Scroll Behavior

```css
/* Smooth scroll for anchor links */
html {
  scroll-behavior: smooth;
}

/* Custom scrollbar */
.scrollable::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.scrollable::-webkit-scrollbar-track {
  background: transparent;
}
.scrollable::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: 3px;
}
.scrollable::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}
```

## Focus States

```css
:focus-visible {
  outline: 2px solid var(--text-secondary);
  outline-offset: 2px;
}

/* Custom focus ring */
.focus-ring:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--ring-width) var(--ring-color);
}
```

## Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```
