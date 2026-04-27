# Examples — Standard Reference Implementations

This directory contains fully-verified, production-ready HTML pages that serve as **canonical reference implementations** of the Claude/Anthropic design system.

## Files

| File                    | Page Type             | Key Patterns                                                                                                                                                             |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blog-article.html`     | 文章/阅读页           | Serif body text, 640px reading column, blockquotes, related card grid with sibling dimming                                                                               |
| `landing-page.html`     | 产品首页              | Marketing layout, hero + features + pricing with featured card inversion, dark mode pricing edge case                                                                    |
| `auth-page.html`        | 登录/注册页           | Form validation, password strength, warm error/success colors, tab switcher                                                                                              |
| `tailwind-landing.html` | Tailwind 产品首页     | Tailwind CDN + theme config, all design tokens mapped, `darkMode: 'class'`, dark mode toggle, responsive nav, card grid sibling dimming, pricing featured card edge case |
| `shadcn-globals.css`    | shadcn/ui globals.css | Drop-in replacement for shadcn/ui projects; all tokens in HSL format, alight + dark mode, font variables, base typography, reduced-motion support                        |

## How to Use

When generating a new page with the Claude design style, reference these files for:

- Correct CSS variable structure (`:root` before `.dark`)
- Font loading via Google Fonts (Inter as Geist fallback)
- Dark mode token values
- Mobile-first responsive patterns
- `prefers-reduced-motion` support
- Touch target sizing (44px minimum)

## Tailwind / shadcn Notes

`tailwind-landing.html` demonstrates how to map all design tokens into `tailwind.config` via the CDN `<script>` block:

- Colors: direct HEX values for both light and dark variants
- `fontFamily`: `sans` (Inter), `serif` (Lora), `mono` (Geist Mono)
- `borderRadius`: `btn` (7.5px), `card` (8px), `xl` (12px)
- `darkMode: 'class'` — toggled via JS + `localStorage`
- Card grid sibling dimming requires CSS `:has()` — included as a `<style>` block

`shadcn-globals.css` maps the same tokens to HSL as shadcn/ui expects. The companion `tailwind.config.ts` is in `references/shadcn.md`.

## Compliance Checklist

All files satisfy SKILL.md Quick Checklist (28 items):

- Background: warm cream `#faf9f5` (light), `#1a1a18` (dark)
- Text: `#141413` (light), `#ece9e1` (dark)
- Buttons: `border-radius: 7.5px`, dark bg, cream text
- Validation: warm brick `#b85b44` / sage `#5a856a` (never saturated red/green)
- Selection: `rgba(204,120,92,0.5)` warm clay
- Reduced motion: `animation-iteration-count: 1` included
- Mobile: viewport meta, 44px touch targets, 16px input font-size
- Dark mode: `.dark` block comes after `:root`

## Font Loading

These files use **Inter** via Google Fonts as the sans-serif (Geist equivalent). Geist is not available on Google Fonts. For projects using npm/CDN Geist, replace `'Inter'` with `'Geist'` in the `--font-sans` variable. See `references/typography.md` for all font loading patterns.
