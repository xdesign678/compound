# Color System Reference

Complete color token system for the Anthropic/Claude design style.

## Site-Specific Color Notes

> Anthropic operates two sites. Both now use the same background color:
>
> | Site                       | Background                 | Use Case                                   |
> | -------------------------- | -------------------------- | ------------------------------------------ |
> | `claude.com` / `claude.ai` | `#faf9f5` (warm off-white) | App and product pages                      |
> | `anthropic.com`            | `#faf9f5` (same)           | Corporate/research site — measured 2026-04 |
>
> **Note:** An earlier version of this document noted `#e8e6dc` for anthropic.com. As of 2026, both sites use `#faf9f5`. The `--bg-primary` token is correct for both contexts.

## Design Principles

- **No pure white or pure black** — always use warm-tinted neutrals
- **Brand clay (#d97757) is for logo/branding only** — not for interactive elements
- **Shadows use pure black alpha** — 8% to 16% in light mode, 24% to 40% in dark
- **Borders use pure black/white alpha** — 6% to 12%, barely perceptible
- **No gradients anywhere** — all backgrounds and fills are solid

## Light Mode — Complete Token Set

```css
:root {
  /* ── Brand ── */
  --brand-clay: #d97757;
  --brand-clay-hover: #c6613f; /* Darker clay for hover states — extracted from anthropic.com 2026-04 */
  --brand-clay-accent: #c6613f; /* Accent variant (alias of hover) */

  /* ── Backgrounds ── */
  --bg-primary: #faf9f5; /* page background */
  --bg-secondary: #f0eee6; /* alternate sections — extracted 2026-04 */
  --bg-secondary-hover: #e8e6dc; /* secondary section hover — extracted 2026-04 */
  --bg-hover: #f5f4f0; /* interactive hover */
  --bg-active: #efeee8; /* pressed/active state */
  --bg-card: #fefdfb; /* card/panel surface */
  --bg-muted: #f0efe8; /* code bg, muted sections */
  --bg-button: #0f0f0e; /* primary button */
  --bg-button-hover: #3d3d3a; /* primary button hover — extracted 2026-04 */
  --bg-input: #fefdfb; /* form inputs */
  --bg-overlay: rgba(0, 0, 0, 0.5); /* modal overlay */

  /* ── Text ── */
  --text-primary: #141413; /* headings, body text */
  --text-body: rgba(20, 20, 19, 0.85); /* body at 85% — softer reading */
  --text-secondary: #5e5d59; /* supporting text */
  --text-muted: #30302e; /* between primary and secondary — discovered on anthropic.com */
  --text-tertiary: #b0aea5; /* timestamps, captions */
  --text-disabled: #d4d3cd; /* disabled state */
  --text-on-button: #faf9f5; /* on dark buttons */
  --text-on-clay: #ffffff; /* on brand clay backgrounds */
  --text-link: inherit; /* links inherit text color */

  /* ── Borders (warm-tinted, using text-primary base #141413) ── */
  --border-light: rgba(20, 20, 19, 0.08);
  --border-default: rgba(20, 20, 19, 0.12);
  --border-section: rgba(20, 20, 19, 0.06);
  --border-focus: rgba(94, 93, 89, 0.3);

  /* ── Shadows ── */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.12);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.16);

  /* ── Focus Ring ── */
  --ring-color: rgba(94, 93, 89, 0.15);
  --ring-width: 2px;
}
```

## Dark Mode — Complete Token Set

```css
.dark,
[data-theme='dark'] {
  /* ── Backgrounds ── */
  --bg-primary: #1a1a18;
  --bg-secondary: #232320;
  --bg-hover: #2a2a27;
  --bg-active: rgba(236, 233, 225, 0.08);
  --bg-card: #232320;
  --bg-muted: #2a2a27;
  --bg-button: #ece9e1; /* inverted in dark mode */
  --bg-button-hover: #d4d1c9;
  --bg-input: #2a2a27;
  --bg-overlay: rgba(0, 0, 0, 0.7);

  /* ── Text ── */
  --text-primary: #ece9e1;
  --text-body: rgba(236, 233, 225, 0.85);
  --text-secondary: #9b9b95;
  --text-muted: #c0beb8; /* between primary and secondary in dark mode */
  --text-tertiary: #6b6b66;
  --text-disabled: #4a4a45;
  --text-on-button: #1a1a18;
  --text-on-clay: #ffffff;

  /* ── Borders ── */
  --border-light: rgba(236, 233, 225, 0.08);
  --border-default: rgba(236, 233, 225, 0.12);
  --border-section: rgba(236, 233, 225, 0.06);
  --border-focus: rgba(155, 155, 149, 0.3);

  /* ── Shadows ── */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.24);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.32);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.4);

  /* ── Focus Ring ── */
  --ring-color: rgba(155, 155, 149, 0.2);
}
```

## Semantic Color Usage

| Purpose           | Light Mode          | Dark Mode              | Notes                                   |
| ----------------- | ------------------- | ---------------------- | --------------------------------------- |
| Page background   | #faf9f5             | #1a1a18                | Warm tint, never pure                   |
| Card surface      | #fefdfb             | #232320                | One step lighter/darker                 |
| Primary text      | #141413             | #ece9e1                | High contrast, warm                     |
| Body text         | #141413 at 85%      | #ece9e1 at 85%         | Slightly softer for reading             |
| Secondary text    | #5e5d59             | #9b9b95                | Supporting info                         |
| Muted text        | #b0aea5             | #6b6b66                | Timestamps, labels                      |
| Primary button bg | #0f0f0e             | #ece9e1                | Inverts between modes                   |
| Secondary bg      | #f0eee6             | —                      | Alternate sections, warmer than primary |
| Hover bg          | #f5f4f0             | #2a2a27                | Subtle background shift                 |
| Border default    | rgba(20,20,19,0.12) | rgba(236,233,225,0.12) | Warm-tinted alpha                       |
| Divider           | rgba(20,20,19,0.06) | rgba(236,233,225,0.06) | Very subtle                             |

## Extended Brand Palette

Used for illustrations, section backgrounds, and visual variety. Apply sparingly to maintain the minimalist aesthetic.

```css
:root {
  /* Extended palette — extracted from anthropic.com swatch system 2026-04 */
  --color-sky: #6a9bcc; /* blue - research/tech sections */
  --color-olive: #788c5d; /* olive green - sustainability/growth */
  --color-cactus: #bcd1ca; /* sage green - safety/stability */
  --color-heather: #cbcadb; /* soft purple - innovation */
  --color-fig: #c46686; /* warm pink - premium/enterprise */
  --color-coral: #ebcece; /* light pink - community/people */
  --color-oat: #d4c9b8; /* neutral tan - neutral sections */
  --color-ivory: #f7f5f0; /* off-white - callout backgrounds */
}
```

## Semantic Status Colors

Use sparingly and only for system states. Anthropic avoids colored accents for interactive elements.

```css
:root {
  --state-error: #b85b44;
  --state-success: #5a856a;
  --state-warning: #c4923a;
  --state-info: #5a7d9b;
}

.dark,
[data-theme='dark'] {
  --state-error: #d4826a;
  --state-success: #7aab87;
  --state-warning: #d4a85a;
  --state-info: #7a9db5;
}
```

**When to use:**

- Success: Confirmation messages, completed states
- Warning: Non-critical alerts, cautions
- Error: Form validation errors, critical failures
- Info: Informational notices, tips

**When NOT to use:**

- Links (use inherit)
- Buttons (use neutrals)
- Icons (use text color)
- Decorative elements (use extended palette)

## Tailwind CSS v4 Configuration

```css
@theme inline {
  --color-bg-primary: var(--bg-primary);
  --color-bg-secondary: var(--bg-secondary);
  --color-bg-hover: var(--bg-hover);
  --color-bg-card: var(--bg-card);
  --color-bg-muted: var(--bg-muted);
  --color-bg-button: var(--bg-button);

  --color-text-primary: var(--text-primary);
  --color-text-body: var(--text-body);
  --color-text-secondary: var(--text-secondary);
  --color-text-tertiary: var(--text-tertiary);
  --color-text-on-button: var(--text-on-button);

  --color-border-light: var(--border-light);
  --color-border-default: var(--border-default);
  --color-border-section: var(--border-section);

  --color-brand-clay: var(--brand-clay);
}
```

## Tailwind CSS v3 Configuration

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
          hover: 'var(--bg-hover)',
          card: 'var(--bg-card)',
          muted: 'var(--bg-muted)',
          button: 'var(--bg-button)',
        },
        text: {
          primary: 'var(--text-primary)',
          body: 'var(--text-body)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          'on-button': 'var(--text-on-button)',
        },
        border: {
          light: 'var(--border-light)',
          DEFAULT: 'var(--border-default)',
          section: 'var(--border-section)',
        },
        brand: {
          clay: 'var(--brand-clay)',
        },
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
    },
  },
};
```

## Selection Highlighting

Use brand clay with alpha for text selection. Applies globally across the site.

```css
::selection {
  background: rgba(204, 120, 92, 0.5); /* Clay tint */
  color: inherit;
}

.dark ::selection {
  background: rgba(217, 119, 87, 0.4);
  color: inherit;
}
```

## Color Accessibility

WCAG 2.1 contrast ratios (light mode):

- `#141413` on `#faf9f5` → **15.8:1** (AAA pass)
- `#5e5d59` on `#faf9f5` → **5.7:1** (AA pass)
- `#b0aea5` on `#faf9f5` → **2.4:1** (decorative only)
- `#faf9f5` on `#0f0f0e` → **17.1:1** (AAA pass)
- `#d97757` on `#faf9f5` → **3.5:1** (large text only)

Rules:

- Never use `--text-tertiary` for essential information
- Brand clay (#d97757) may be used for decorative text only (24px+)
- Primary and secondary text meet AA on all backgrounds
