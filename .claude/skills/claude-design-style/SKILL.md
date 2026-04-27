---
name: claude-design-style
description: >
  Use when building any web page or HTML with a warm, literary, or refined aesthetic.
  MUST trigger when the user mentions: Claude/Anthropic design style, warm/cream
  backgrounds (#faf9f5), 温暖简约, 文学感, 克制优雅, Lora/serif body text, or
  book-publisher quality. Also trigger for requests describing calm editorial
  typography, warm minimal web design, or premium reading experiences — even without
  naming Claude explicitly. Covers all page types: landing pages, articles, 404 pages,
  docs, newsletters, reading UIs. Do NOT trigger for: dashboards, data tables,
  e-commerce, terminal UIs, Python scripts, CI/CD, or vague requests like
  "make it pretty" without warmth/literary direction.
---

# Claude Design Style

Apply the Anthropic/Claude design system to any web project. Based on deep extraction and analysis of anthropic.com, claude.ai, and the Claude App interface.

This system emphasizes warm minimalism, typographic clarity, generous whitespace, and a literary reading experience.

## Execution Flow

1. **Understand the task** — Is this "create from scratch" or "restyle existing code"? Full redesign or targeted component?
2. **Identify the stack** — Tailwind/React → use Tailwind classes + CSS variables. Plain HTML/CSS → use CSS variables + native CSS. Unknown → default to CSS variables (most portable).
3. **Load reference files on demand** (do NOT load all 10 at once):
   - Color tokens → `references/colors.md`
   - Font loading + type scale → `references/typography.md`
   - Complex components (modal, code block, tabs) → `references/components.md`
   - Page structure, grid, breakpoints → `references/layout.md`
   - Animations, loading states → `references/motion.md`
   - Claude Logo SVG / brand rules → `references/brand.md`
   - AI chat interface (sidebar, messages, input) → `references/claude-app.md`
   - Form validation, field groups → `references/forms.md`
   - Empty states, Skeleton, Toast, error pages → `references/states.md`
   - shadcn/ui theme config → `references/shadcn.md`
4. **Apply styles** — Start with `:root` CSS variables, then components, then spacing.
5. **MANDATORY: Run 3-Pass Validation Scan** (see below) — scan your generated code, fix every violation found. Do NOT skip this step.

**Restyle mode** (existing code): Introduce `:root` variables first → scan for Anti-Pattern violations → replace colors → replace fonts → adjust spacing. Preserve all HTML structure and logic.

**Minimal-intervention mode** (single component): Output only the relevant component CSS/JSX. Do not dump the full variable system unless asked.

---

## Design Philosophy

Anthropic's design conveys **intellectual warmth** — scholarly yet approachable, minimal yet not cold. The aesthetic is closer to a premium book publisher than a typical SaaS product.

Core principles:

- **Content is king** — the design disappears so text shines
- **Warm, not sterile** — cream tones instead of pure white, near-black instead of #000
- **Typographic hierarchy** — serif for reading content, sans-serif for UI/navigation
- **Generous breathing room** — wide margins, tall line-heights, constrained content width
- **Restrained interaction** — subtle transitions (150-300ms), no flashy animations
- **Quiet confidence** — no gradients, no textures, no visual noise
- **Systematic design** — 8px grid, consistent 7.5/8px radii, unified shadow scale

### Dual Brand Context

Anthropic operates two distinct design contexts:

- **anthropic.com**: Corporate/marketing site — uses serif (TiemposText) for display headlines, **sans for body text**
- **claude.ai/claude.com**: Product/reading interface — uses sans for headings, **serif for body text**

**Choose the right pattern for your page type:**

- **Marketing / Landing pages** (hero, features, pricing): use **sans body text** + optional serif for large display headlines only
- **Reading / Article / App pages** (blog posts, research articles, documentation): use **serif body text** + sans headings

This skill defaults to the **claude.ai reading-focused pattern** (serif body, sans headings) because it is most commonly needed for building content-heavy apps. When building a pure marketing landing page, switch body text to sans and reserve serif only for hero display headlines if desired.

## Design Tokens (Quick Reference)

### CSS Custom Properties — Light Mode (Colors + Typography)

All design tokens in a single `:root` block. Font tokens (`--font-*`) do not change between light/dark mode.

```css
:root {
  /* Brand */
  --brand-clay: #d97757; /* Claude signature warm orange — logo only */

  /* Backgrounds */
  --bg-primary: #faf9f5; /* warm cream page background */
  --bg-secondary: #f0eee6; /* warm beige sections */
  --bg-hover: #f5f4f0; /* hover state */
  --bg-active: rgba(20, 20, 19, 0.06); /* pressed/active state */
  --bg-card: #fefdfb; /* card surface */
  --bg-button: #0f0f0e; /* primary button — near-black */
  --bg-button-hover: #3d3d3a; /* primary button hover */
  --bg-muted: #f0efe8; /* muted sections, code bg */

  /* Text */
  --text-primary: #141413; /* headings and body */
  --text-body: rgba(20, 20, 19, 0.85); /* body text at 85% — softer reading */
  --text-secondary: #5e5d59; /* supporting text */
  --text-tertiary: #b0aea5; /* captions, timestamps — decorative only, 2.4:1 contrast */
  --text-on-button: #faf9f5; /* text on dark buttons */

  /* Typography — same in light and dark mode */
  --font-sans: Geist, Inter, system-ui, -apple-system, sans-serif;
  --font-reading: Lora, 'Noto Serif SC', Georgia, 'Times New Roman', serif;
  --font-mono: 'Geist Mono', 'JetBrains Mono', 'SF Mono', monospace;

  /* Borders */
  --border-light: rgba(20, 20, 19, 0.08); /* card borders — warm-tinted */
  --border-default: rgba(20, 20, 19, 0.12); /* input borders — warm-tinted */
  --border-section: rgba(20, 20, 19, 0.06); /* section dividers — warm-tinted */

  /* Shadows (very subtle) */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.12);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.16);
}
```

### CSS Custom Properties — Dark Mode Overrides

```css
.dark {
  --bg-primary: #1a1a18; /* warm charcoal */
  --bg-secondary: #232320;
  --bg-hover: #2a2a27;
  --bg-active: rgba(236, 233, 225, 0.08); /* pressed/active state */
  --bg-card: #232320;
  --bg-button: #ece9e1; /* inverted — light button */
  --bg-button-hover: #d4d1c9; /* inverted button hover */
  --bg-muted: #2a2a27;

  --text-primary: #ece9e1; /* warm off-white */
  --text-body: rgba(236, 233, 225, 0.85); /* body text at 85% */
  --text-secondary: #9b9b95;
  --text-tertiary: #6b6b66;
  --text-on-button: #1a1a18;

  --border-light: rgba(236, 233, 225, 0.08);
  --border-default: rgba(236, 233, 225, 0.12);
  --border-section: rgba(236, 233, 225, 0.06);

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.24);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.32);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.4);
}
```

### Dark Mode Edge Cases

**Featured pricing card** — In light mode, featured cards invert to dark background (`--bg-button: #0f0f0e`). In dark mode `--bg-button` flips to `#ece9e1` (cream), which creates a jarring light card on a dark page. Add an explicit dark-mode override:

```css
.dark .pricing-card.featured {
  background: #2e2e2b; /* mid-dark — stands out without glaring */
  border-color: rgba(236, 233, 225, 0.15);
}
.dark .pricing-card.featured .btn-primary {
  background: var(--text-primary); /* #ece9e1 warm white */
  color: var(--bg-primary); /* #1a1a18 dark bg */
}
```

**Navigation border in dark mode** — `--border-section` is `rgba(236,233,225,0.06)` which is intentionally ultra-subtle (nearly invisible). This is the correct Anthropic pattern — the nav blends into the page. If you need a more visible separator (e.g. when nav background contrasts less with content), increase opacity to `0.10`:

```css
.dark nav {
  border-bottom-color: rgba(236, 233, 225, 0.1); /* slightly more visible if needed */
}
```

See [references/colors.md](references/colors.md) for full token list and Tailwind config.

### Typography

| Element         | Font  | Size                       | Weight | Line-height | Letter-spacing     |
| --------------- | ----- | -------------------------- | ------ | ----------- | ------------------ | ------------------------------------------- |
| Body text       | Serif | 17px (1.0625rem)           | 400    | 1.6         | normal             |
| H1 (hero)       | Sans  | clamp(2.5rem,...,4rem)     | 700    | 1.1         | -0.02em            |
| H2 (section)    | Sans  | clamp(1.75rem,...,2.5rem)  | 600    | 1.2         | -0.01em            |
| H3 (subsection) | Sans  | clamp(1.25rem,...,1.75rem) | 600    | 1.3         | normal             | ← must be ≥3px larger than body (20px+ min) |
| Nav/UI          | Sans  | 15px                       | 400    | 1.5         | normal             |
| Button          | Sans  | 15px                       | 400    | 1.5         | normal             |
| Small/label     | Sans  | 12px                       | 500    | 1.4         | 0.05em (uppercase) |
| Code            | Mono  | 0.9em                      | 400    | 1.5         | normal             |

**Font stacks**:

- **Reading**: `Lora, "Noto Serif SC", Georgia, "Times New Roman", serif`
- **UI/Headings**: `Geist, Inter, system-ui, -apple-system, sans-serif`
- **Code**: `"Geist Mono", "JetBrains Mono", "SF Mono", monospace`

### Fluid Typography

Use `clamp()` for responsive type scaling without breakpoints. Key values from anthropic.com:

```css
/* Fluid Display Scale (from anthropic.com) */
--font-size-display-xs: clamp(1.125rem, 1.087rem + 0.163vw, 1.25rem); /* 18→20px */
--font-size-display-s: clamp(1.25rem, 1.173rem + 0.327vw, 1.5rem); /* 20→24px */
--font-size-display-m: clamp(1.75rem, 1.673rem + 0.327vw, 2rem); /* 28→32px */
--font-size-display-l: clamp(2rem, 1.694rem + 1.306vw, 3rem); /* 32→48px */
--font-size-display-xl: clamp(2.5rem, 2.041rem + 1.959vw, 4rem); /* 40→64px */
--font-size-display-xxl: clamp(3rem, 2.388rem + 2.612vw, 5rem); /* 48→80px */

/* Fluid Paragraph Scale */
--font-size-paragraph-s: clamp(1rem, 0.962rem + 0.163vw, 1.125rem); /* 16→18px */
--font-size-paragraph-m: clamp(1.125rem, 1.087rem + 0.163vw, 1.25rem); /* 18→20px */
```

See [references/typography.md](references/typography.md) for font loading, CSS, and Tailwind config.

### Spacing (8px grid)

```
4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 80px
```

Key spacings:

- Section gap: 64-80px (py-16 to py-20)
- H2 top margin: 64px, bottom: 32px
- H3 top margin: 40px, bottom: 16px
- Paragraph gap: 16-20px
- Content column: **640px** max-width (reading), **768-840px** (app chat)
- Site margin: `clamp(2rem, 1.08rem + 3.92vw, 5rem)`
- Nav height: **68px** (4.25rem)

### Border Radius

```
4px    — small: tags, badges, inline code
7.5px  — medium: buttons, inputs ← Anthropic signature radius
8px    — large: cards, containers
12px   — extra-large: modals, images, panels
```

**IMPORTANT**: Buttons use `border-radius: 7.5px`, NOT pill shape (rounded-full).

### Transitions

```css
--transition-fast: 150ms ease;
--transition-base: 200ms ease;
--transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-menu: 400ms ease;
```

**Always include reduced-motion support** (Checklist item 28):

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

See [references/motion.md](references/motion.md) for keyframes and animation patterns.

## Components

### Buttons

```css
/* Primary — dark bg, cream text, 7.5px radius */
.btn-primary {
  background: var(--bg-button); /* #0f0f0e */
  color: var(--text-on-button); /* #faf9f5 */
  border: none;
  border-radius: 7.5px;
  padding: 8px 16px;
  font-size: 15px;
  font-weight: 400;
  font-family: var(--font-sans);
  transition: all 0.2s ease;
  cursor: pointer;
}
.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.btn-primary:active {
  transform: translateY(0);
}

/* Secondary — outlined */
.btn-secondary {
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: 7.5px;
  padding: 8px 16px;
  font-size: 15px;
  transition: all 0.2s ease;
}
.btn-secondary:hover {
  background: var(--bg-hover);
}

/* Ghost — text only */
.btn-ghost {
  background: none;
  border: none;
  color: var(--text-secondary);
  padding: 8px 16px;
  font-size: 15px;
  transition: color 0.15s ease;
}
.btn-ghost:hover {
  color: var(--text-primary);
}
```

### Cards

```css
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-light); /* rgba(20,20,19,0.08) */
  border-radius: 8px;
  padding: 24px;
  box-shadow: none; /* flat by default */
  transition: box-shadow 0.2s ease;
}
.card:hover {
  box-shadow: var(--shadow-md); /* subtle lift on hover */
}
```

**Equal-height card grids** (pricing, features): Use `display: grid` with equal columns and `align-items: stretch` (not `start`). Place the CTA button at the bottom with `margin-top: auto` inside a flex column, so buttons align even when content lengths differ.

**Card Hover Dimming** (sibling awareness):

```css
/* Sibling dimming — hovered card stays, others fade */
.card-grid:has(.card:hover) .card:not(:hover) {
  opacity: 0.6;
  transition: opacity 300ms ease;
}
```

### Selection Highlighting

```css
::selection {
  background: rgba(204, 120, 92, 0.5);
  color: inherit;
}
```

### Links

```css
a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 0.2em;
  text-decoration-color: rgba(20, 20, 19, 0.3);
  transition: text-decoration-color 0.15s ease;
}
a:hover {
  text-decoration-color: rgba(20, 20, 19, 0.6);
}

/* Dark mode override — required, otherwise underline is invisible on dark bg */
.dark a {
  text-decoration-color: rgba(236, 233, 225, 0.3);
}
.dark a:hover {
  text-decoration-color: rgba(236, 233, 225, 0.6);
}
```

### Inputs

```css
input,
textarea {
  border: 1px solid var(--border-default);
  border-radius: 7.5px;
  padding: 8px 16px;
  font-size: 16px; /* 16px required — prevents iOS auto-zoom on focus */
  font-family: var(--font-sans);
  background: var(--bg-card);
  color: var(--text-primary);
  transition: border-color 0.2s ease;
}
input:focus,
textarea:focus {
  outline: none;
  border-color: var(--text-secondary);
  box-shadow: 0 0 0 2px rgba(94, 93, 89, 0.15);
}
```

**Form semantics**: Always wrap form inputs in a `<form>` element with `action` and `method`. Use `<button type="submit">` (not `type="button"`) for the primary submit action — this enables native Enter-key submission and password manager autofill. Add `autocomplete` attributes on login/register inputs (`username`, `current-password`, `new-password`).

### Navigation

```css
nav {
  height: 68px;
  padding: 0 clamp(2rem, 1.08rem + 3.92vw, 5rem);
  border-bottom: 1px solid var(--border-section);
  background: var(--bg-primary);
  display: flex;
  align-items: center;
}
nav a {
  font-size: 15px;
  color: var(--text-secondary);
  text-decoration: none;
  transition: color 0.15s ease;
}
nav a:hover {
  color: var(--text-primary);
}
```

### Icons

- Size: **16x16px** standard, 20x20px large
- Style: `fill="currentColor"` (filled paths, NOT stroked outlines)
- Color: inherits from text via currentColor
- Library: Lucide Icons or similar minimal set
- Gap from text: 4-8px

See [references/components.md](references/components.md) for code blocks, dropdowns, modals, badges, and more.

## Prose / Rich Content (Tailwind Typography)

```
prose dark:prose-invert max-w-none
prose-headings:font-sans prose-headings:font-semibold prose-headings:tracking-tight
prose-h2:mt-16 prose-h2:mb-8
prose-h3:mt-10 prose-h3:mb-4
prose-p:mb-4 prose-p:leading-relaxed
prose-a:text-inherit prose-a:underline prose-a:underline-offset-2
prose-a:decoration-foreground/30 hover:prose-a:decoration-foreground/60
prose-blockquote:border-foreground prose-blockquote:border-l prose-blockquote:not-italic
prose-blockquote:text-[var(--text-secondary)] prose-blockquote:pl-4
prose-code:bg-[var(--bg-muted)] prose-code:px-1.5 prose-code:py-0.5
prose-code:rounded prose-code:text-[0.9em]
prose-code:before:content-none prose-code:after:content-none
prose-pre:bg-[var(--bg-muted)] prose-pre:border prose-pre:border-[var(--border-light)]
prose-pre:rounded-lg
prose-li:mb-1
prose-hr:border-[var(--border-section)]
```

## Anti-Patterns (Never Do)

- Gradients on backgrounds, buttons, or any element
- Pill-shaped buttons (rounded-full) — use `border-radius: 7.5px`
- Drop shadows heavier than `--shadow-md`
- `brand-clay` (#d97757) on any UI element except the Claude Logo — not buttons, links, badges, or focus rings
- Pure white (#fff) or pure black (#000) anywhere
- Cool-toned grays — always use warm grays (the `--bg-*` and `--text-*` tokens have warm undertones)
- Thick borders (>1px) or colored borders
- Stroked/outline icons — use filled with currentColor
- Heavy animations, bounces, spring physics
- `display:none → display:block/grid` for animated menus — `display` is not animatable, transitions on height/opacity/grid-template-rows won't fire. Keep `display:grid` always and animate `grid-template-rows: 0fr → 1fr`, or use `max-height`/`opacity` instead
- Dense layouts — minimum 32px between content blocks, minimum 16px between paragraphs
- Colored links (blue, green, purple, etc.) — links use `color: inherit` and are distinguished only by underline opacity
- Saturated validation colors — never `#dc2626`, `#f87171` (error) or `#16a34a`, `#4ade80` (success); use warm tones: error = `#b85b44` (light) / `#d4826a` (dark), success = `#5a856a` (light) / `#7aab87` (dark), warning = `#c4834a` (light) / `#d4a06a` (dark). Define CSS variables `--state-error`, `--state-success`, `--state-warning` so dark mode overrides work automatically.
- `.dark {}` CSS block before `:root {}` — same specificity (0,1,0), `:root` wins if it comes last; always put `.dark` AFTER `:root`
- Emojis in UI text (casual/playful aesthetic conflicts with literary tone)
- Cool-toned `::selection` highlight — use `rgba(204,120,92,0.5)` (warm clay)
- Using `--text-tertiary` for essential information — its 2.4:1 contrast is decorative-only

## 3-Pass Validation Scan (MANDATORY)

After generating or modifying code, you MUST scan it in 3 passes. For each item, **search your generated code** for the specific pattern described. If missing or wrong, **fix it before outputting**. Do NOT skip any pass.

### Pass 1 — Dark Mode & Color Integrity (most commonly missed)

Scan your CSS/style output and verify:

1. **`.dark {}` block exists** — search for `.dark` or `[data-theme="dark"]`. If missing and the page has any interactive/display content, add the full dark mode variable block.
2. **CSS ordering: `.dark {}` AFTER `:root {}`** — same specificity (0,1,0), later wins. If `.dark` appears before `:root`, dark mode is silently broken. Move it after.
3. **Dark backgrounds are warm** — `--bg-primary` in `.dark` must be `#1a1a18` (warm charcoal), NOT `#1a1a1a`, `#111`, `#000`, or any cool gray.
4. **Dark text is warm off-white** — `--text-primary` in `.dark` must be `#ece9e1`, NOT `#fff`, `#f5f5f5`, or cool white.
5. **Buttons invert in dark mode** — `--bg-button` in `.dark` = `#ece9e1`, `--text-on-button` = `#1a1a18`.
6. **No `#fff` or `#000` anywhere** — search for `#fff`, `#ffffff`, `#000`, `#000000`. Replace with nearest warm token.
7. **No cool grays** — search for `#f5f5f5`, `#e5e5e5`, `#333`, `#666`, `#999`, `#ccc`. Replace with `var(--bg-*)` / `var(--text-*)` tokens.
8. **No saturated validation colors** — search for `#dc2626`, `#ef4444`, `#f87171`, `#16a34a`, `#4ade80`, literal `red`, `green`. Replace: error = `#b85b44` (light) / `#d4826a` (dark), success = `#5a856a` (light) / `#7aab87` (dark).
9. **`::selection` warm clay** — search for `::selection`. Must use `rgba(204,120,92,0.5)`. If missing, add it.
10. **Dark link underlines** — if `<a>` tags exist, search for `.dark a`. Underline color must be `rgba(236,233,225,0.3)`, not the light-mode value (invisible on dark bg).

### Pass 2 — Typography & Spacing (second most missed)

11. **Body font is serif** — search for `font-family` on `body`/`p`. Must include `Lora` or serif stack. Exception: pure marketing landing pages may use sans body.
12. **Headings are sans-serif** — search for `font-family` on `h1`–`h6`. Must include `Geist`/`Inter`/sans stack.
13. **H1 uses `clamp()`** — search for `h1` font-size. Must use `clamp(2.5rem, ..., 4rem)` or similar fluid value, NOT a fixed `px`/`rem`.
14. **H2 has `letter-spacing: -0.01em`** — search for `h2`. Add if missing.
15. **Body line-height is 1.6** — search for body/paragraph `line-height`. Must be `1.6`, not `1.5` or `1.75`.
16. **Content max-width constrained** — search for `max-width` on main content. ~`640px` (reading) or `768–840px` (app), NOT full-width or `1200px`.
17. **Section gaps >= 64px** — search for `<section>` padding/margin. Top/bottom >= 64px (`py-16`+), not 32px or 40px.
18. **Paragraph gap 16–20px** — search for `p` margin-bottom. Not 8px or 24px+.
19. **Nav height 68px** — search for `nav` height. Must be `68px` / `4.25rem`.
20. **Button radius 7.5px** — search for button `border-radius`. Must be `7.5px`, NOT `rounded-full`/`9999px`, NOT `8px` (cards only).

### Pass 3 — Components, Mobile & Accessibility (polish layer)

21. **Links: `color: inherit` + underline only** — search for `a` styles. NO `color: blue`/`color: var(--brand-*)`. Distinguished only by `text-decoration` with `text-underline-offset: 0.2em`.
22. **Card sibling dimming** — if card grid exists, search for `:has(.card:hover)`. Missing? Add `.card-grid:has(.card:hover) .card:not(:hover) { opacity: 0.6; }`.
23. **Borders warm-tinted** — search for `border-color`/`border:`. Must use `rgba(20,20,19, 0.06–0.12)` or `var(--border-*)`, NOT `#e5e7eb`, `#d1d5db`, or Tailwind default grays.
24. **Input font-size 16px** — search for `input`/`textarea` font-size. Must be `16px` (prevents iOS zoom). NOT `14px`/`15px`.
25. **Touch targets >= 44px** — search for button/checkbox/link sizing. Interactive elements need 44px minimum tap area.
26. **Viewport meta** — search for `<meta name="viewport"`. Must include `width=device-width, initial-scale=1.0`. Add `viewport-fit=cover` for fixed-bottom elements.
27. **Responsive nav** — if nav exists, must collapse to hamburger/mobile menu below `768px`. Search for nav-related `@media`.
28. **`prefers-reduced-motion`** — search for `prefers-reduced-motion`. If missing and page has transitions/animations, add the media query.
29. **No gradients** — search for `linear-gradient`, `radial-gradient`. Remove from backgrounds/buttons.
30. **Shadows subtle** — search for `box-shadow`. Max opacity 16% (`rgba(0,0,0,0.08–0.16)`). No `0.3+`.

**If any item fails: fix it in your code, then re-check that item. Do not output until all 30 items pass.**

## Reference Files

Load these **on demand** based on your task. Do not load all at once.

| File                                                 | Contents                                                  | When to Load                                              |
| ---------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| [references/typography.md](references/typography.md) | Font loading, stacks, computed styles, Tailwind config    | When setting up fonts or adjusting type scale             |
| [references/colors.md](references/colors.md)         | Full color tokens, semantic system, Tailwind/CSS config   | When you need complete token list or Tailwind config      |
| [references/components.md](references/components.md) | Code blocks, modals, dropdowns, badges, tables, accordion | When building complex components not in SKILL.md          |
| [references/layout.md](references/layout.md)         | Grid system, responsive breakpoints, page templates       | When designing page structure or responsive behavior      |
| [references/motion.md](references/motion.md)         | Keyframes, transitions, loading states, scroll behavior   | When adding animations or transitions                     |
| [references/brand.md](references/brand.md)           | Logo SVGs, icon guidelines, brand usage rules             | **Only** when you need the Claude Logo SVG or brand rules |
| [references/claude-app.md](references/claude-app.md) | Chat UI: message bubbles, input, sidebar, artifacts       | When building an AI chat interface                        |
| [references/forms.md](references/forms.md)           | Form validation states, field groups, special inputs      | When building forms with validation                       |
| [references/states.md](references/states.md)         | Empty states, Skeleton, Toast, error pages                | When building loading/empty/error UI patterns             |
| [references/shadcn.md](references/shadcn.md)         | shadcn/ui theme config, HSL variables, globals.css        | When integrating with shadcn/ui                           |

### Examples

完整的标准答案页面位于 `examples/` 目录：

- `blog-article.html` — 文章/阅读页（原生 CSS）
- `landing-page.html` — 产品首页（原生 CSS）
- `auth-page.html` — 登录/注册页（原生 CSS）
- `tailwind-landing.html` — 产品首页，**Tailwind CDN 版本**；含 `tailwind.config` token 映射、`darkMode: 'class'`、响应式导航、card grid sibling dimming、定价卡片 dark mode 边缘处理
- `shadcn-globals.css` — **shadcn/ui 项目 drop-in globals.css**；所有 token 用 HSL 格式，含亮色 + 暗色，配套 `tailwind.config.ts` 见 `references/shadcn.md`

生成页面时可参考这些标准实现。**React + Tailwind 栈**优先参考 `tailwind-landing.html` 和 `shadcn-globals.css`。
