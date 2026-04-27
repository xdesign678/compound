# shadcn/ui Theme Configuration

Complete setup for integrating the Anthropic/Claude design aesthetic into a shadcn/ui project.

## Overview

shadcn/ui uses **HSL format** CSS variables. This file provides the conversion from the Claude design HEX tokens to the HSL format shadcn expects.

---

## globals.css (Full Configuration)

Replace the default shadcn globals.css `:root` and `.dark` blocks with this:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* ── Page ── */
    --background: 48 33% 97%; /* #faf9f5 — warm cream */
    --foreground: 40 7% 8%; /* #141413 — near-black */

    /* ── Card / Panel ── */
    --card: 0 0% 100%; /* #fefdfb (warm near-white) */
    --card-foreground: 40 7% 8%;

    /* ── Popover ── */
    --popover: 0 0% 100%;
    --popover-foreground: 40 7% 8%;

    /* ── Primary (button) ── */
    --primary: 40 7% 6%; /* #0f0f0e */
    --primary-foreground: 48 33% 97%; /* #faf9f5 */

    /* ── Secondary (ghost/muted button) ── */
    --secondary: 48 14% 94%; /* #f0eee6 — maps to --bg-secondary */
    --secondary-foreground: 40 7% 8%;

    /* ── Muted (badges, code bg) ── */
    --muted: 48 14% 94%; /* #f0efe8 */
    --muted-foreground: 41 5% 36%; /* #5e5d59 */

    /* ── Accent (hover states) ── */
    --accent: 48 18% 95%; /* #f5f4f0 */
    --accent-foreground: 40 7% 8%;

    /* ── Destructive ── */
    --destructive: 13 39% 50%; /* #b85b44 — warm brick red, brand-aligned */
    --destructive-foreground: 48 33% 97%; /* #faf9f5 — warm cream on dark */

    /* ── Border ── */
    --border: 40 8% 91%; /* ~rgba(20,20,19,0.08) approx */
    --input: 40 8% 88%; /* ~rgba(20,20,19,0.12) approx */
    --ring: 41 5% 36%; /* #5e5d59 */

    /* ── Brand ── */
    --brand-clay: 18 62% 64%; /* #d97757 */

    /* ── Radius ── */
    --radius: 0.47rem; /* ~7.5px — Anthropic signature */
  }

  .dark {
    --background: 40 5% 10%; /* #1a1a18 */
    --foreground: 48 14% 92%; /* #ece9e1 */

    --card: 40 5% 13%; /* #232320 */
    --card-foreground: 48 14% 92%;

    --popover: 40 5% 13%;
    --popover-foreground: 48 14% 92%;

    --primary: 48 14% 92%; /* #ece9e1 — inverted */
    --primary-foreground: 40 5% 10%; /* #1a1a18 */

    --secondary: 40 5% 16%; /* #2a2a27 */
    --secondary-foreground: 48 14% 92%;

    --muted: 40 5% 16%;
    --muted-foreground: 41 2% 60%; /* #9b9b95 */

    --accent: 40 5% 16%;
    --accent-foreground: 48 14% 92%;

    --destructive: 16 55% 62%; /* #d4826a — lighter warm terracotta for dark bg */
    --destructive-foreground: 40 5% 10%; /* #1a1a18 — dark bg for contrast */

    --border: 48 14% 92% / 0.1;
    --input: 48 14% 92% / 0.12;
    --ring: 41 2% 60%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-feature-settings:
      'rlig' 1,
      'calt' 1;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
}
```

---

## components.json

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "app/globals.css",
    "baseColor": "stone",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

---

## tailwind.config.ts

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        brand: {
          clay: 'hsl(var(--brand-clay))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)' /* 7.5px */,
        md: 'calc(var(--radius) - 1px)',
        sm: 'calc(var(--radius) - 3px)',
        xl: '12px',
        '2xl': '16px',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'var(--font-serif-sc)', 'Georgia', 'serif'],
        mono: ['var(--font-geist-mono)', 'JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

---

## Overriding Default shadcn Component Styles

### Button

The default shadcn Button uses `rounded-md` (6px). Override to Anthropic's 7.5px:

```tsx
// components/ui/button.tsx — update the variants
const buttonVariants = cva(
  'inline-flex items-center justify-content gap-2 whitespace-nowrap text-sm font-normal transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-foreground text-background shadow hover:bg-foreground/90 hover:-translate-y-px hover:shadow-md active:translate-y-0',
        outline:
          'border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground/60 shadow-none',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
```

### Card

```tsx
// Ensure card uses the design system border radius
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border bg-card text-card-foreground shadow-none transition-shadow hover:shadow-md',
        className,
      )}
      {...props}
    />
  ),
);
```

### Input

```tsx
// Match the field-input spec: 9px vertical padding, warm focus ring
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm',
          'placeholder:text-muted-foreground/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:border-muted-foreground',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-colors duration-200',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
```

---

## HEX to HSL Conversion Reference

| Token                   | HEX                   | HSL              |
| ----------------------- | --------------------- | ---------------- |
| `--bg-primary`          | `#faf9f5`             | `48 33% 97%`     |
| `--bg-card`             | `#fefdfb`             | `0 0% 100%`      |
| `--bg-muted`            | `#f0efe8`             | `48 14% 94%`     |
| `--bg-hover`            | `#f5f4f0`             | `48 18% 95%`     |
| `--bg-button`           | `#0f0f0e`             | `40 7% 6%`       |
| `--text-primary`        | `#141413`             | `40 7% 8%`       |
| `--text-secondary`      | `#5e5d59`             | `41 5% 36%`      |
| `--text-tertiary`       | `#b0aea5`             | `42 5% 67%`      |
| `--border-light`        | `rgba(20,20,19,0.08)` | `40 7% 8% / 8%`  |
| `--border-default`      | `rgba(20,20,19,0.12)` | `40 7% 8% / 12%` |
| `--brand-clay`          | `#d97757`             | `18 62% 64%`     |
| `--state-error` (light) | `#b85b44`             | `13 39% 50%`     |
| `--state-error` (dark)  | `#d4826a`             | `16 55% 62%`     |
