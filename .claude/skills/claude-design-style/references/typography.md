# Typography Reference

Font loading, stacks, computed styles, and configuration for the Anthropic/Claude design style.

## Anthropic's Actual Font System

> **Important**: Anthropic uses a complete proprietary font system hosted on their own CDN (`/media/`). These fonts are **not available to external projects**. The table below shows the actual fonts used and their best open-source equivalents.

### Actual Fonts Used by Anthropic (as of 2025)

| Anthropic Font          | Role on Site                              | Best Open-Source Equivalent                    |
| ----------------------- | ----------------------------------------- | ---------------------------------------------- |
| `Anthropic Sans`        | Primary UI, headings, navigation, buttons | **Geist** (preferred), **Inter**               |
| `TiemposText`           | Article body, long-form reading content   | **Lora** (closest match), Source Serif Pro     |
| `Anthropic Serif`       | Brand/display serif                       | **Libre Caslon Text**, EB Garamond             |
| `StyreneA` / `StyreneB` | Display headlines, marketing hero         | **Barlow**, DM Sans (approximate)              |
| `Copernicus`            | Large brand headlines                     | **Playfair Display**, Cormorant Garamond       |
| `Anthropic Mono`        | Code (primary)                            | **Geist Mono** (preferred), JetBrains Mono     |
| `JetBrainsMono`         | Code (secondary, variable)                | **JetBrains Mono** (exact match — open source) |
| Noto Serif SC           | Chinese body text                         | **Noto Serif SC** (same font — Google Fonts)   |
| LXGW WenKai             | Chinese elegant option                    | **LXGW WenKai** (same font — open source)      |

### Recommended Stack for External Projects

For the most faithful recreation using freely available fonts:

```
UI / Headings:  Geist → Inter → system-ui
Body reading:   Lora → Source Serif Pro → Georgia
Code:           Geist Mono → JetBrains Mono → monospace
Chinese:        Noto Serif SC (serif) / Noto Sans SC (sans)
```

## Font Loading — Next.js

```tsx
import { Geist, Geist_Mono } from 'next/font/google';
import { Lora, Noto_Serif_SC } from 'next/font/google';

// Sans-serif for UI
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Serif for reading
const lora = Lora({
  variable: '--font-serif',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
});

// Chinese serif support
const notoSerifSC = Noto_Serif_SC({
  variable: '--font-serif-sc',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap', // CJK fonts are large, avoid blocking render
});

// Apply to <body>:
// className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} ${notoSerifSC.variable}`}
```

## Font Loading — Plain HTML

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

If Geist is not available via Google Fonts, **Inter** is the closest sans-serif fallback.

### `font-display: swap` — Latin Font Loading Guide

`font-display: swap` instructs the browser to show system fallback text immediately while the custom font loads, then swap to the custom font once ready. This prevents invisible text (FOIT) at the cost of a brief flash (FOUT).

**When to use swap:**

| Font type                              | Recommended `font-display` | Reason                                                |
| -------------------------------------- | -------------------------- | ----------------------------------------------------- |
| Latin UI / body (Geist, Inter, Lora)   | `swap`                     | Small file (30–80 KB), swap is barely noticeable      |
| CJK fonts (Noto Serif SC, LXGW WenKai) | `swap`                     | Files are large (2–4 MB); must never block render     |
| Icon / symbol fonts                    | `block` (short) or `swap`  | Depends on criticality; `block` prevents broken icons |

**Next.js** (recommended — automatic):

```tsx
// next/font applies font-display: swap by default for all Google Fonts
const geistSans = Geist({ subsets: ['latin'] }); // swap is implicit
```

**Plain `@font-face`:**

```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/Inter-Variable.woff2') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap; /* show fallback immediately, swap on load */
}

@font-face {
  font-family: 'Lora';
  src: url('/fonts/Lora-Variable.woff2') format('woff2');
  font-weight: 400 700;
  font-style: normal;
  font-display: swap;
}

/* CJK — always swap, file is too large to block */
@font-face {
  font-family: 'Noto Serif SC';
  font-display: swap;
  /* ... */
}
```

**Minimise FOUT impact:**

```css
/* Define a system-font fallback with matching metrics to reduce layout shift */
@font-face {
  font-family: 'Inter Fallback';
  src: local('Arial');
  ascent-override: 90%;
  descent-override: 22%;
  line-gap-override: 0%;
  size-adjust: 107%;
}

:root {
  --font-sans: 'Geist', 'Inter', 'Inter Fallback', system-ui, sans-serif;
}
```

## CSS Custom Properties

```css
:root {
  /* Font families */
  --font-serif: 'Lora', Georgia, 'Times New Roman', serif;
  --font-serif-sc: 'Noto Serif SC', serif;
  --font-sans: 'Geist', 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'Geist Mono', 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;

  /* Combined serif stack with CJK fallback */
  --font-reading: var(--font-serif), var(--font-serif-sc), Georgia, 'Times New Roman', serif;

  /* Rendering */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
```

### Chinese Typography

For Chinese content, Anthropic's style extends to carefully chosen CJK fonts:

**Noto Serif SC** - Primary choice for formal and long-form Chinese reading content:

- Pairs well with Lora for mixed Latin/CJK text
- Comprehensive character coverage (Simplified Chinese)
- Professional, readable design suitable for articles and documentation

**LXGW WenKai (霞鹜文楷)** - Elegant alternative for stylized content:

- Handwritten calligraphic style with modern clarity
- Adds warmth and personality to Chinese text
- Best for headings, quotes, or creative content

**System fonts as fallback**:

- Ensures graceful degradation when custom fonts fail to load
- `serif` generic family provides acceptable Chinese rendering on all platforms

**Font loading considerations**:

```css
@font-face {
  font-family: 'Noto Serif SC';
  font-display: swap; /* Critical for CJK fonts - they're large (2-4MB) */
  /* ... */
}
```

## Font Stacks by Context

### Reading / Body Content

```css
.body-text {
  font-family: var(--font-reading);
  font-size: 17px; /* 1.0625rem */
  line-height: 1.6; /* 27.2px */
  font-weight: 400;
  color: var(--text-body); /* text-primary at 85% opacity */
  letter-spacing: normal;
}
```

### Headings (H1-H3)

```css
h1,
h2,
h3 {
  font-family: var(--font-sans);
  font-weight: 600; /* semibold, not bold */
  letter-spacing: -0.01em; /* tight tracking */
  color: var(--text-primary);
}

h1 {
  font-size: clamp(2.5rem, 2.04rem + 1.96vw, 4rem); /* 40-64px */
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

h2 {
  font-size: clamp(1.75rem, 1.52rem + 0.98vw, 2.5rem); /* 28-40px */
  line-height: 1.2;
  margin-top: 64px;
  margin-bottom: 32px;
}

h3 {
  font-size: clamp(1.25rem, 1.14rem + 0.49vw, 1.75rem); /* 20-28px */
  line-height: 1.3;
  letter-spacing: normal;
  margin-top: 40px;
  margin-bottom: 16px;
}
```

### UI Elements (Nav, Buttons, Labels)

```css
.ui-text {
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 400;
  letter-spacing: normal;
  line-height: 1.5;
}
```

### Small Labels / Category Tags

```css
.label-text {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}
```

### Code / Monospace

```css
code,
pre {
  font-family: var(--font-mono);
  font-size: 0.9em; /* relative to parent */
}

/* Inline code */
code:not(pre code) {
  background: var(--bg-muted);
  padding: 2px 6px;
  border-radius: 4px;
}
```

## Type Scale — Complete Reference

| Token       | Size                       | Weight | Line-height | Spacing | Use                 |
| ----------- | -------------------------- | ------ | ----------- | ------- | ------------------- |
| display-xxl | clamp(3rem,...,5rem)       | 700    | 1.05        | -0.03em | Hero splash         |
| display-xl  | clamp(2.5rem,...,4rem)     | 700    | 1.1         | -0.02em | H1 page title       |
| display-l   | clamp(2rem,...,3rem)       | 700    | 1.15        | -0.02em | Large section title |
| heading-l   | clamp(1.75rem,...,2.5rem)  | 600    | 1.2         | -0.01em | H2 section          |
| heading-m   | clamp(1.25rem,...,1.75rem) | 600    | 1.3         | normal  | H3 subsection       |
| heading-s   | 1.125rem (18px)            | 600    | 1.4         | normal  | H4                  |
| body-l      | 17px                       | 400    | 1.6         | normal  | Article body        |
| body-m      | 15px                       | 400    | 1.5         | normal  | UI body, buttons    |
| body-s      | 14px                       | 400    | 1.5         | normal  | Secondary body      |
| detail-m    | 13px                       | 400    | 1.4         | normal  | Captions            |
| detail-s    | 12px                       | 500    | 1.4         | 0.05em  | Labels (uppercase)  |
| detail-xs   | 10px                       | 500    | 1.3         | 0.05em  | Tiny labels         |
| mono        | 0.9em                      | 400    | 1.5         | normal  | Code                |

## Fluid Type Scale

The full fluid type system from anthropic.com, using `clamp()` for responsive scaling without breakpoints:

```css
:root {
  /* Display Scale (fluid, no breakpoints needed) */
  --font-size-display-xs: clamp(1.125rem, 1.087rem + 0.163vw, 1.25rem);
  --font-size-display-s: clamp(1.25rem, 1.173rem + 0.327vw, 1.5rem);
  --font-size-display-m: clamp(1.75rem, 1.673rem + 0.327vw, 2rem);
  --font-size-display-l: clamp(2rem, 1.694rem + 1.306vw, 3rem);
  --font-size-display-xl: clamp(2.5rem, 2.041rem + 1.959vw, 4rem);
  --font-size-display-xxl: clamp(3rem, 2.388rem + 2.612vw, 5rem);

  /* Paragraph Scale (fluid) */
  --font-size-paragraph-s: clamp(1rem, 0.962rem + 0.163vw, 1.125rem);
  --font-size-paragraph-m: clamp(1.125rem, 1.087rem + 0.163vw, 1.25rem);
  --font-size-paragraph-l: clamp(1.375rem, 1.337rem + 0.163vw, 1.5rem);

  /* Detail Scale */
  --font-size-detail-xs: clamp(0.6875rem, 0.668rem + 0.082vw, 0.75rem);
}
```

## Marketing vs App Typography

Anthropic uses different typographic approaches for marketing and application contexts:

### Marketing Pages (anthropic.com)

- **Display headlines**: Serif fonts (TiemposText/Copernicus equivalents like Lora) for dramatic, editorial impact
- **Body text**: Sans-serif (Geist/Inter) for clean, modern UI reading
- **Purpose**: Create visual hierarchy and brand presence, drawing attention to key messaging

### Application & Reading Pages (claude.ai, research articles)

- **Headings**: Sans-serif (Geist/Inter) for clean, scannable structure
- **Body text**: Serif fonts (Lora/TiemposText) for comfortable long-form reading
- **Purpose**: Optimize reading ergonomics and reduce eye strain during extended use

**Key distinction**: Marketing uses serif for display drama, while app/articles use serif for reading comfort.

## Tailwind CSS v4 Configuration

```css
@theme inline {
  --font-sans: var(--font-geist-sans), 'Inter', system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), 'JetBrains Mono', monospace;
  --font-serif: var(--font-serif), var(--font-serif-sc), Georgia, serif;
}
```

## Tailwind CSS v3 Configuration

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'var(--font-serif-sc)', 'Georgia', 'serif'],
        mono: ['var(--font-geist-mono)', 'JetBrains Mono', 'monospace'],
      },
      fontSize: {
        body: ['17px', { lineHeight: '1.6' }],
        ui: ['15px', { lineHeight: '1.5' }],
        label: ['12px', { lineHeight: '1.4', letterSpacing: '0.05em' }],
      },
    },
  },
};
```

## Computed Styles — Extracted from Anthropic Sites

### Research Article Body (anthropic.com/research/\*)

```
font-family: anthropicSerif → Lora equivalent
font-size: 17px
line-height: 1.55 (26.35px)
font-weight: 400
color: #141413
max-width: 640px
margin: 0 auto
padding: 0 32px (mobile) / 0 64px (desktop)
```

### Research Article H2

```
font-family: anthropicSans → Geist/Inter equivalent
font-size: 32px
font-weight: 600
line-height: 1.2
letter-spacing: -0.01em
margin-top: 64px
margin-bottom: 32px
```

### Research Article H3

```
font-size: 24px
font-weight: 600
line-height: 1.3
margin-top: 40px
margin-bottom: 16px
```

### Homepage H1 (anthropic.com)

```
font-size: 52px
font-weight: 700
line-height: 1.1
letter-spacing: -0.02em
text-align: center
```

### Navigation Link

```
font-family: anthropicSans
font-size: 15px
font-weight: 400
color: #5e5d59 (text-secondary)
transition: color 150ms ease
hover color: #141413 (text-primary)
```

### Button Text

```
font-family: anthropicSans
font-size: 15px
font-weight: 400
line-height: 1.5
color: #faf9f5 (on dark button)
```

### Blockquote

```
border-left: 1px solid var(--text-primary)   /* 1px full-opacity — measured 2026-04 */
padding-left: 16px                            /* 16px measured, not 24px */
font-style: normal (NOT italic)
color: var(--text-secondary)
```

### Link

```
text-underline-offset: 0.2em
text-decoration-color: rgba(20,20,19,0.3)
hover: text-decoration-color: rgba(20,20,19,0.6)
color: inherit (same as surrounding text)
```

## Display Typography (anthropic.com Hero)

The marketing site uses a larger display scale with fluid sizing:

```css
--font-size--display-xl: clamp(2.5rem, 2.04rem + 1.96vw, 4rem);
--font-size--display-xxl: clamp(3rem, 2.39rem + 2.61vw, 5rem);
```

These use `clamp()` for fluid scaling without explicit breakpoints, creating a smooth transition from mobile to desktop.
