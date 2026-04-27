# Brand Assets Reference

Logo SVGs, icon guidelines, and brand usage rules for the Claude/Anthropic design style.

## Claude Star Logo (Asterisk Icon)

The signature Claude mark — a warm, organic asterisk shape in clay orange.

### SVG — Icon Only

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 125 125" fill="none">
  <path d="M54.375 118.75L56.125 111L58.125 101L59.75 93L61.25 83.125L62.125 79.875L62 79.625L61.375 79.75L53.875 90L42.5 105.375L33.5 114.875L31.375 115.75L27.625 113.875L28 110.375L30.125 107.375L42.5 91.5L50 81.625L54.875 76L54.75 75.25H54.5L21.5 96.75L15.625 97.5L13 95.125L13.375 91.25L14.625 90L24.5 83.125L49.125 69.375L49.5 68.125L49.125 67.5H47.875L43.75 67.25L29.75 66.875L17.625 66.375L5.75 65.75L2.75 65.125L0 61.375L0.25 59.5L2.75 57.875L6.375 58.125L14.25 58.75L26.125 59.5L34.75 60L47.5 61.375H49.5L49.75 60.5L49.125 60L48.625 59.5L36.25 51.25L23 42.5L16 37.375L12.25 34.75L10.375 32.375L9.625 27.125L13 23.375L17.625 23.75L18.75 24L23.375 27.625L33.25 35.25L46.25 44.875L48.125 46.375L49 45.875V45.5L48.125 44.125L41.125 31.375L33.625 18.375L30.25 13L29.375 9.75C29.0417 8.625 28.875 7.375 28.875 6L32.75 0.750006L34.875 0L40.125 0.750006L42.25 2.625L45.5 10L50.625 21.625L58.75 37.375L61.125 42.125L62.375 46.375L62.875 47.75H63.75V47L64.375 38L65.625 27.125L66.875 13.125L67.25 9.125L69.25 4.375L73.125 1.87501L76.125 3.25L78.625 6.875L78.25 9.125L76.875 18.75L73.875 33.875L72 44.125H73.125L74.375 42.75L79.5 36L88.125 25.25L91.875 21L96.375 16.25L99.25 14H104.625L108.5 19.875L106.75 26L101.25 33L96.625 38.875L90 47.75L86 54.875L86.375 55.375H87.25L102.125 52.125L110.25 50.75L119.75 49.125L124.125 51.125L124.625 53.125L122.875 57.375L112.625 59.875L100.625 62.25L82.75 66.5L82.5 66.625L82.75 67L90.75 67.75L94.25 68H102.75L118.5 69.125L122.625 71.875L125 75.125L124.625 77.75L118.25 80.875L109.75 78.875L89.75 74.125L83 72.5H82V73L87.75 78.625L98.125 88L111.25 100.125L111.875 103.125L110.25 105.625L108.5 105.375L97 96.625L92.5 92.75L82.5 84.375H81.875V85.25L84.125 88.625L96.375 107L97 112.625L96.125 114.375L92.875 115.5L89.5 114.875L82.25 104.875L74.875 93.5L68.875 83.375L68.25 83.875L64.625 121.625L63 123.5L59.25 125L56.125 122.625L54.375 118.75Z"
    fill="#d97757"/>
</svg>
```

### Usage Rules

- **Color**: Must use `#d97757` (brand clay) or `currentColor` (monochrome)
- **Minimum size**: 20x20px
- **Clear space**: Minimum 8px padding around the icon
- **Never**: rotate, stretch, add effects, change proportions

### Sizes

| Context         | Size         | CSS Class  |
| --------------- | ------------ | ---------- |
| Favicon         | 16x16, 32x32 | —          |
| Nav logo        | 24-26px      | `.logo-sm` |
| Page header     | 32-40px      | `.logo-md` |
| Hero / splash   | 64-80px      | `.logo-lg` |
| Mobile app icon | 120x120      | —          |

## Dual Brand Architecture

Anthropic operates two distinct brand properties with shared visual DNA but different design emphasis:

### anthropic.com (Corporate/Research)

- **Audience**: Researchers, enterprise decision-makers, investors, policy makers
- **Headline style**: Mission-driven ("AI research and products that put safety at the frontier")
- **Typography emphasis**: Serif display headlines (TiemposText) for scholarly authority
- **Imagery**: Hand-based SVG illustrations, abstract geometric patterns
- **Navigation**: Research, Economic Futures, Commitments, Learn, News
- **Interaction**: GSAP scroll-triggered reveals, interactive globe visualization
- **Footer**: 5-column mega footer (Products, Models, Solutions, Resources, Company)

### claude.com / claude.ai (Product)

- **Audience**: Individual users, developers, teams
- **Headline style**: Productivity-focused ("Think fast, build faster")
- **Typography emphasis**: Sans headings for clarity, serif for reading content
- **Imagery**: Product screenshots, interface previews
- **Navigation**: Platform, Solutions, Pricing, Resources
- **Interaction**: Auto-growing textareas, prompt menus, Lottie animations
- **Footer**: Extended hierarchy with granular product/feature links

### Shared Elements

- Warm cream backgrounds (#faf9f5 / #f5f4ed)
- Near-black text (#141413)
- Clay accent (#d97757)
- 8px grid system
- Generous whitespace
- 68px nav height
- Restrained animations (150-400ms)

## Claude Logo + Wordmark

Star icon + "Claude" text side by side.

```html
<div style="display:flex; align-items:center; gap:8px;">
  <svg viewBox="0 0 125 125" width="26" height="26" fill="none">
    <path d="M54.375 118.75L56.125 111..." fill="#d97757" />
  </svg>
  <span
    style="font-family:'Geist',Inter,sans-serif; font-size:19px; font-weight:400; color:#141413;"
  >
    Claude
  </span>
</div>
```

**Rules**:

- Star: `#d97757` (clay)
- Text: `currentColor` or `var(--text-primary)`
- Gap between star and text: 8px
- Text weight: 400 (regular)
- Overall aspect ratio: ~4.6:1

## Anthropic Wordmark

"ANTHROPIC" in custom geometric sans-serif, all uppercase.

```css
.anthropic-wordmark {
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-primary);
}
```

**Rules**:

- Always uppercase
- Letter-spacing: 0.08em
- Color: `var(--text-primary)` or monochrome
- Minimum height: 12px

## Brand Color: Clay (#d97757)

### When to Use

- Claude star logo
- Brand badge / watermark
- Decorative large text (24px+ only)
- Loading animation accent (optional)

### When NOT to Use

- Button backgrounds (use `--bg-button` = #0f0f0e instead)
- Interactive element highlights
- Links or text emphasis
- Status indicators (success/error/warning)
- Form focus states

### Color Variants

```css
--brand-clay: #d97757;
--brand-clay-light: #e8a48b; /* 30% lighter, for subtle bg tints */
--brand-clay-dark: #c6613f; /* darker variant — matches --brand-clay-hover in colors.md */
--brand-clay-10: rgba(217, 119, 87, 0.1); /* very subtle bg wash */
--brand-clay-20: rgba(217, 119, 87, 0.2); /* light highlight */
```

## Icon System Guidelines

### Specifications

| Property      | Value                     |
| ------------- | ------------------------- |
| Default size  | 16x16px                   |
| Large size    | 20x20px                   |
| ViewBox       | `0 0 20 20` (uniform)     |
| Fill method   | `fill="currentColor"`     |
| Stroke        | None (filled paths only)  |
| Color         | Inherits from parent text |
| Gap from text | 4-8px                     |

### Icon Style

- **Filled paths** (NOT stroked outlines)
- **Monochrome** — single color via currentColor
- **Geometric** — clean, minimal shapes
- **No decorative detail** — functional clarity only
- **Consistent optical weight** across all icons

### Recommended Libraries

1. **Lucide Icons** — preferred, with `strokeWidth={0}` or custom filled variants
2. **Heroicons** (solid variant) — Tailwind ecosystem
3. **Custom SVGs** — follow 20x20 viewBox convention

### Common Icons

| Purpose       | Icon                    | Notes                     |
| ------------- | ----------------------- | ------------------------- |
| Menu          | Three horizontal lines  | 16px                      |
| Close         | X                       | 16px                      |
| Search        | Magnifying glass        | 16px                      |
| Chevron       | Down/right arrow        | 16px, dropdown indicators |
| Copy          | Two overlapping squares | 16px, code blocks         |
| External link | Arrow pointing out      | 14px                      |
| Settings      | Gear                    | 16px                      |

## Typography — Brand Fonts

Anthropic uses custom proprietary fonts on their sites:

| Anthropic Font                 | Public Equivalent          | Use                   |
| ------------------------------ | -------------------------- | --------------------- |
| Anthropic Sans                 | Geist, Inter               | UI, headings, buttons |
| Anthropic Serif / TiemposText  | Lora, Source Serif Pro     | Body text, articles   |
| StyreneA                       | —                          | Display text (rare)   |
| Anthropic Mono / JetBrainsMono | Geist Mono, JetBrains Mono | Code                  |

When building projects, use the public equivalents. They closely match Anthropic's custom typefaces in weight, proportion, and character.

## Imagery Style

When using photos or illustrations alongside Anthropic's design:

- **No stock-photo aesthetic** — prefer abstract, geometric, or documentary style
- **Warm color grading** — muted warm tones, never oversaturated
- **Minimal subjects** — single focus point, generous negative space
- **Rounded corners**: 8-12px on images in cards
- **No overlaid text on images** — keep text separate from imagery

## Hand-Based Illustration Motif

Anthropic uses a distinctive hand-based illustration system across both sites:

- SVG format for crisp rendering at all sizes
- Warm, muted color palette matching brand tones
- Semantic naming: "Hand NodeLine", "Hand Build", "Hand Safety"
- Used for: research topic icons, career page values, feature illustrations
- Style: geometric, minimal line work, single focus point
- Never photographic — always stylized illustration

## Customer Logo Display

```css
.logo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 32px;
  align-items: center;
}

.logo-item {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.logo-item img {
  max-height: 32px;
  width: auto;
  opacity: 0.6;
  filter: grayscale(100%);
  transition:
    opacity 200ms ease,
    filter 200ms ease;
}

.logo-item:hover img {
  opacity: 1;
  filter: grayscale(0%);
}
```

## Values / Principles Display

```css
/* Numbered principle card (careers/about pages) */
.principle-card {
  display: flex;
  gap: 20px;
  padding: 24px 0;
  border-bottom: 1px solid var(--border-section);
}

.principle-number {
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-tertiary);
  flex-shrink: 0;
  width: 32px;
}

.principle-title {
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.principle-desc {
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.6;
}
```

## Brand Voice in Design

The visual language reflects:

- **Understated authority** — no flashy CTAs, no urgency design patterns
- **Academic precision** — everything is measured, systematic, intentional
- **Human warmth** — the clay orange, the cream backgrounds, the serif reading font
- **No decoration for decoration's sake** — every element serves a function
