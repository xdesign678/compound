#!/usr/bin/env python3
"""
Claude Design Style -- Fixed Evaluator (run_eval.py)
Based on Karpathy's AutoResearch: this script is the IMMUTABLE evaluation harness.
It must NEVER be modified during optimization cycles.

Usage:
    python run_eval.py <html_file> [--test-id T01] [--json] [--verbose]
    python run_eval.py --batch <dir> [--json]
"""

import re
import sys
import json
import os
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional

# ═══════════════════════════════════════════════════════════════
# REFERENCE TOKENS -- Ground truth from colors.md / SKILL.md
# ═══════════════════════════════════════════════════════════════

LIGHT_TOKENS = {
    "--bg-primary": "#faf9f5",
    "--bg-secondary": "#f0eee6",
    "--bg-card": "#fefdfb",
    "--bg-hover": "#f5f4f0",
    "--bg-muted": "#f0efe8",
    "--bg-button": "#0f0f0e",
    "--bg-button-hover": "#3d3d3a",
    "--text-primary": "#141413",
    "--text-secondary": "#5e5d59",
    "--text-tertiary": "#b0aea5",
    "--text-on-button": "#faf9f5",
    "--brand-clay": "#d97757",
}

DARK_TOKENS = {
    "--bg-primary": "#1a1a18",
    "--bg-secondary": "#232320",
    "--bg-hover": "#2a2a27",
    "--bg-card": "#232320",
    "--bg-button": "#ece9e1",
    "--bg-button-hover": "#d4d1c9",
    "--text-primary": "#ece9e1",
    "--text-secondary": "#9b9b95",
    "--text-tertiary": "#6b6b66",
    "--text-on-button": "#1a1a18",
}

BORDER_TOKENS_LIGHT = {
    "--border-light": "rgba(20,20,19,0.08)",
    "--border-default": "rgba(20,20,19,0.12)",
    "--border-section": "rgba(20,20,19,0.06)",
}

BORDER_TOKENS_DARK = {
    "--border-light": "rgba(236,233,225,0.08)",
    "--border-default": "rgba(236,233,225,0.12)",
    "--border-section": "rgba(236,233,225,0.06)",
}

SHADOW_TOKENS = {
    "--shadow-sm": "0 1px 3px rgba(0,0,0,0.08)",
    "--shadow-md": "0 4px 12px rgba(0,0,0,0.12)",
    "--shadow-lg": "0 8px 24px rgba(0,0,0,0.16)",
}


# ═══════════════════════════════════════════════════════════════
# ANTI-PATTERN RULES
# ═══════════════════════════════════════════════════════════════

ANTI_PATTERNS = [
    ("gradient", r"linear-gradient|radial-gradient", "Forbidden: gradient backgrounds"),
    ("pill_button", r"border-radius:\s*(?:999|9999|50%)|rounded-full", "Forbidden: pill-shaped buttons"),
    ("pure_black_text", r"(?:^|\s|;)color:\s*#000(?:000)?(?:\s|;|$)", "Forbidden: pure black text"),
    ("pure_black_bg", r"background(?:-color)?:\s*#000(?:000)?(?:\s|;|$)", "Forbidden: pure black background"),
    ("pure_white_bg_page", r"(?:body|:root|html)\s*\{[^}]*background(?:-color)?:\s*#fff(?:fff)?", "Forbidden: pure white page background"),
    ("clay_on_button", r"(?:background|background-color):\s*(?:#d97757|var\(--brand-clay\))", "Forbidden: clay on button/interactive bg"),
    ("heavy_shadow", r"rgba\(0,\s*0,\s*0,\s*0\.[5-9]\)|rgba\(0,\s*0,\s*0,\s*[1-9](?:\.\d+)?\)", "Forbidden: shadow opacity > 0.4"),
    ("thick_border", r"border(?:-width)?:\s*[2-9]px\s+solid", "Forbidden: border > 1px"),
    ("colored_link", r"a\s*\{[^}]*color:\s*(?:#0000ff|#0066cc|blue|dodgerblue)", "Forbidden: colored links"),
    ("bounce_animation", r"animation[^;]*(?:bounce|spring|elastic)", "Forbidden: bouncy animations"),
    ("cool_gray_class", r"(?:slate|zinc|neutral|gray)-(?:[1-9]00)", "Forbidden: cool gray Tailwind classes"),
    ("stroke_icon_attr", r"stroke-width:\s*[1-9]|stroke-linecap|stroke-linejoin", "Forbidden: stroked icons (use filled)"),
    ("pure_color_error_red", r"(?:color|background(?:-color)?):\s*(?:#dc2626|#f87171)\b", "Forbidden: pure error/red colors (#dc2626, #f87171)"),
    ("pure_color_success_green", r"(?:color|background(?:-color)?):\s*(?:#16a34a|#4ade80)\b", "Forbidden: pure success/green colors (#16a34a, #4ade80)"),
]


# ═══════════════════════════════════════════════════════════════
# TYPOGRAPHY RULES
# ═══════════════════════════════════════════════════════════════

SERIF_FONTS = ["lora", "noto serif", "georgia", "times", "serif", "source serif"]
SANS_FONTS = ["geist", "inter", "system-ui", "apple-system", "sans-serif", "helvetica", "arial"]
MONO_FONTS = ["geist mono", "jetbrains", "sf mono", "monospace", "fira code", "source code"]


# ═══════════════════════════════════════════════════════════════
# EXPECTED COMPONENTS PER TEST
# ═══════════════════════════════════════════════════════════════

EXPECTED_COMPONENTS = {
    "T01": ["nav", "h1", "card", "button", "footer"],
    "T02": ["nav", "article", "h1", "blockquote", "code", "footer"],
    "T03": ["card", "button", "accordion", "h2"],
    "T04": ["form", "input", "button", "label"],
    "T05": ["sidebar", "message", "input", "button"],
    "T06": ["nav", "form", "toggle", "select", "button"],
    "T07": ["skeleton", "empty", "spinner", "button"],
    "T08": ["code", "modal", "dropdown", "tab", "table"],
    "T09": ["nav", "form", "input", "button", "meta"],
    "T10": [".dark", "card", "button", "input", "code"],
}


# ═══════════════════════════════════════════════════════════════
# SCORING ENGINE
# ═══════════════════════════════════════════════════════════════

@dataclass
class DimensionScore:
    name: str
    score: float
    max_score: float = 100.0
    checks_passed: int = 0
    checks_total: int = 0
    failures: list = field(default_factory=list)

    @property
    def pct(self) -> float:
        return round(self.score / self.max_score * 100, 1) if self.max_score else 0


@dataclass
class EvalResult:
    test_id: str
    file_path: str
    d1_token: DimensionScore = None
    d2_antipattern: DimensionScore = None
    d3_typography: DimensionScore = None
    d4_layout: DimensionScore = None
    d5_responsive: DimensionScore = None
    d6_components: DimensionScore = None

    @property
    def composite(self) -> float:
        weights = {"d1_token": 0.25, "d2_antipattern": 0.20, "d3_typography": 0.15,
                   "d4_layout": 0.15, "d5_responsive": 0.15, "d6_components": 0.10}
        total = 0.0
        for attr, w in weights.items():
            dim = getattr(self, attr)
            if dim:
                total += dim.pct * w
        return round(total, 1)


def normalize_css_value(val: str) -> str:
    """Normalize CSS value for comparison: lowercase, strip spaces around commas/colons."""
    v = val.strip().lower()
    v = re.sub(r"\s*,\s*", ",", v)
    v = re.sub(r"\s*:\s*", ":", v)
    v = re.sub(r"\s+", " ", v)
    return v


def extract_css_vars(html: str) -> dict:
    """Extract all CSS custom property declarations from HTML."""
    found = {}
    # Match --var-name: value patterns in <style> blocks
    style_blocks = re.findall(r"<style[^>]*>(.*?)</style>", html, re.DOTALL | re.IGNORECASE)
    all_css = "\n".join(style_blocks)

    for match in re.finditer(r"(--[\w-]+)\s*:\s*([^;}\n]+)", all_css):
        name = match.group(1).strip()
        value = match.group(2).strip().rstrip(";")
        found[name] = value
    return found


def extract_scoped_css_vars(html: str):
    """Extract CSS vars separately from :root and .dark scopes. (Bug 1 fix)"""
    style_blocks = re.findall(r"<style[^>]*>(.*?)</style>", html, re.DOTALL | re.IGNORECASE)
    all_css = "\n".join(style_blocks)

    root_vars = {}
    dark_vars = {}

    # Extract :root block(s) vars
    root_blocks = re.findall(r":root\s*\{([^}]+)\}", all_css, re.DOTALL)
    for block in root_blocks:
        for m in re.finditer(r"(--[\w-]+)\s*:\s*([^;}\n]+)", block):
            root_vars[m.group(1).strip()] = m.group(2).strip().rstrip(";")

    # Extract .dark block(s) vars
    dark_blocks = re.findall(r"\.dark\s*\{([^}]+)\}", all_css, re.DOTALL)
    for block in dark_blocks:
        for m in re.finditer(r"(--[\w-]+)\s*:\s*([^;}\n]+)", block):
            dark_vars[m.group(1).strip()] = m.group(2).strip().rstrip(";")

    return root_vars, dark_vars


def check_token_accuracy(html: str, test_id: str) -> DimensionScore:
    """D1: Compare extracted CSS vars against reference tokens."""
    # Bug 1 fix: use scope-aware extraction to avoid dark tokens overwriting light tokens
    root_vars, dark_vars = extract_scoped_css_vars(html)
    checks = 0
    passed = 0
    failures = []

    # Check light mode tokens using :root scope only
    for token, expected in {**LIGHT_TOKENS, **BORDER_TOKENS_LIGHT, **SHADOW_TOKENS}.items():
        checks += 1
        actual = root_vars.get(token)
        if actual is None:
            failures.append(f"MISSING: {token} (expected: {expected})")
            continue
        if normalize_css_value(actual) == normalize_css_value(expected):
            passed += 1
        else:
            # Allow close matches (e.g., rgba spacing differences)
            a_clean = re.sub(r"\s", "", normalize_css_value(actual))
            e_clean = re.sub(r"\s", "", normalize_css_value(expected))
            if a_clean == e_clean:
                passed += 1
            else:
                failures.append(f"MISMATCH: {token} = '{actual}' (expected: '{expected}')")

    # Check dark mode tokens if test requires it
    dark_tests = {"T01", "T03", "T04", "T06", "T07", "T10"}
    if test_id in dark_tests:
        # Look for dark mode section in CSS
        has_dark = bool(re.search(r"\.dark\s*\{|\.dark\s+|data-theme.*dark|\[class.*dark\]", html))
        if has_dark:
            # Use scoped dark_vars extracted above
            for token, expected in {**DARK_TOKENS, **BORDER_TOKENS_DARK}.items():
                checks += 1
                actual = dark_vars.get(token)
                if actual is None:
                    failures.append(f"DARK MISSING: {token}")
                    continue
                a_clean = re.sub(r"\s", "", normalize_css_value(actual))
                e_clean = re.sub(r"\s", "", normalize_css_value(expected))
                if a_clean == e_clean:
                    passed += 1
                else:
                    failures.append(f"DARK MISMATCH: {token} = '{actual}' (expected: '{expected}')")
        else:
            # Dark mode expected but not found
            for token in DARK_TOKENS:
                checks += 1
                failures.append(f"DARK MISSING: no .dark block (expected {token})")

    score = (passed / checks * 100) if checks > 0 else 0
    return DimensionScore("D1: Token Accuracy", score, 100, passed, checks, failures)


def check_anti_patterns(html: str) -> DimensionScore:
    """D2: Check for forbidden design patterns."""
    checks = len(ANTI_PATTERNS)
    violations = []

    for name, pattern, msg in ANTI_PATTERNS:
        matches = re.findall(pattern, html, re.IGNORECASE | re.MULTILINE)
        if matches:
            # Filter false positives
            if name == "clay_on_button":
                # Allow clay in logo/brand contexts
                filtered = [m for m in matches if not re.search(r"logo|brand|star|icon", html[max(0, html.find(m)-100):html.find(m)+100], re.I)]
                if not filtered:
                    continue
            if name == "pure_white_bg_page":
                # --bg-card uses warm near-white #fefdfb
                if all("card" in html[max(0, html.find(m)-80):html.find(m)+80].lower() for m in matches):
                    continue
            if name == "stroke_icon_attr":
                # Allow if only in SVG logo (brand.md allows it)
                svg_context = re.findall(r"<svg[^>]*>.*?</svg>", html, re.DOTALL | re.IGNORECASE)
                has_non_logo_stroke = False
                for svg in svg_context:
                    if re.search(pattern, svg, re.IGNORECASE) and "logo" not in svg.lower() and "brand" not in svg.lower():
                        has_non_logo_stroke = True
                if not has_non_logo_stroke:
                    continue
            violations.append(f"{msg} (found: {matches[0][:60]})")

    passed = checks - len(violations)
    score = (passed / checks * 100) if checks > 0 else 0
    return DimensionScore("D2: Anti-Patterns", score, 100, passed, checks, violations)


def check_typography(html: str) -> DimensionScore:
    """D3: Validate typography system."""
    checks = 0
    passed = 0
    failures = []

    # Bug 2 fix: pre-resolve CSS font variables from :root
    root_vars, _ = extract_scoped_css_vars(html)
    font_vars = {
        "--font-serif": root_vars.get("--font-serif", ""),
        "--font-sans": root_vars.get("--font-sans", ""),
        "--font-mono": root_vars.get("--font-mono", ""),
    }

    def resolve_font(val: str) -> str:
        """Replace var(--font-xxx) with actual value."""
        for var_name, var_val in font_vars.items():
            val = val.replace(f"var({var_name})", var_val)
        return val

    # 1. Body uses serif font
    checks += 1
    body_font = re.findall(r"(?:body|\.prose|p)\s*\{[^}]*font-family:\s*([^;]+)", html, re.IGNORECASE | re.DOTALL)
    if body_font:
        font_val = resolve_font(body_font[0]).lower()  # Bug 2 fix: resolve var() before checking
        if any(s in font_val for s in SERIF_FONTS):
            passed += 1
        else:
            failures.append(f"Body font not serif: {body_font[0][:60]}")
    else:
        # Check CSS vars
        if re.search(r"--font-serif|font-family:.*(?:Lora|serif|Noto Serif)", html, re.I):
            passed += 1
        elif font_vars["--font-serif"] and any(s in font_vars["--font-serif"].lower() for s in SERIF_FONTS):
            passed += 1
        else:
            failures.append("Body font-family not found or not serif")

    # 2. Headings use sans font
    checks += 1
    heading_font = re.findall(r"(?:h[1-3])[^{]*\{[^}]*font-family:\s*([^;]+)", html, re.IGNORECASE | re.DOTALL)
    if heading_font:
        font_val = resolve_font(heading_font[0]).lower()  # Bug 2 fix: resolve var() before checking
        if any(s in font_val for s in SANS_FONTS):
            passed += 1
        else:
            failures.append(f"Heading font not sans: {heading_font[0][:60]}")
    else:
        if re.search(r"--font-sans|h[1-3][^{]*font-family:.*(?:Geist|Inter|sans)", html, re.I):
            passed += 1
        elif font_vars["--font-sans"] and any(s in font_vars["--font-sans"].lower() for s in SANS_FONTS):
            passed += 1
        else:
            failures.append("Heading font-family not found or not sans")

    # 3. Body font-size ~17px / 1.0625rem
    checks += 1
    body_size = re.findall(r"(?:body|\.prose|p)\s*\{[^}]*font-size:\s*([^;]+)", html, re.IGNORECASE | re.DOTALL)
    if body_size:
        sz = body_size[0].strip()
        if any(v in sz for v in ["17px", "1.0625rem", "1.0625em"]):
            passed += 1
        else:
            failures.append(f"Body font-size not 17px: {sz}")
    else:
        failures.append("Body font-size not specified")

    # 4. Body line-height 1.6
    checks += 1
    body_lh = re.findall(r"(?:body|\.prose|p)\s*\{[^}]*line-height:\s*([^;]+)", html, re.IGNORECASE | re.DOTALL)
    if body_lh:
        lh = body_lh[0].strip()
        if "1.6" in lh:
            passed += 1
        else:
            failures.append(f"Body line-height not 1.6: {lh}")
    else:
        failures.append("Body line-height not specified")

    # 5. H1 uses clamp()
    checks += 1
    h1_size = re.findall(r"h1\s*\{[^}]*font-size:\s*([^;]+)", html, re.IGNORECASE | re.DOTALL)
    if h1_size and "clamp" in h1_size[0].lower():
        passed += 1
    else:
        failures.append("H1 font-size doesn't use clamp()")

    # 6. H1 weight 600-700
    checks += 1
    h1_weight = re.findall(r"h1\s*\{[^}]*font-weight:\s*(\d+)", html, re.IGNORECASE | re.DOTALL)
    if h1_weight and int(h1_weight[0]) >= 600:
        passed += 1
    else:
        failures.append(f"H1 font-weight not 600-700: {h1_weight[0] if h1_weight else 'not set'}")

    # 7. H1 letter-spacing negative
    checks += 1
    h1_ls = re.findall(r"h1\s*\{[^}]*letter-spacing:\s*([^;]+)", html, re.IGNORECASE | re.DOTALL)
    if h1_ls and "-" in h1_ls[0]:
        passed += 1
    else:
        failures.append("H1 letter-spacing not negative (tight)")

    # 8. Code uses mono font
    checks += 1
    # Bug 3a fix: use precise selector-based regex to avoid matching .code-block etc.
    code_font = re.findall(
        r"(?:^|[\s{;,])(?:code|pre)\s*(?:\{|,)[^}]*font-family:\s*([^;]+)",
        html, re.IGNORECASE | re.DOTALL | re.MULTILINE
    )
    if code_font:
        resolved = resolve_font(code_font[0]).lower()  # Bug 2 fix: also resolve vars here
        if any(s in resolved for s in MONO_FONTS):
            passed += 1
        else:
            failures.append(f"Code font not mono: {code_font[0][:60]}")
    else:
        if re.search(r"--font-mono", html):
            passed += 1
        elif font_vars["--font-mono"] and any(s in font_vars["--font-mono"].lower() for s in MONO_FONTS):
            passed += 1
        else:
            failures.append("Code font-family not specified")

    # 9. Button font-size 15px
    checks += 1
    # Bug 3b fix: ensure we match selector start, not "button" inside a CSS value
    btn_size = re.findall(
        r"(?:^|[\s{;,])button\s*(?:\{|,)[^}]*font-size:\s*([^;]+)",
        html, re.IGNORECASE | re.DOTALL | re.MULTILINE
    )
    if not btn_size:
        btn_size = re.findall(
            r"\.btn\s*(?:\{|,)[^}]*font-size:\s*([^;]+)",
            html, re.IGNORECASE | re.DOTALL | re.MULTILINE
        )
    if btn_size and ("15px" in btn_size[0] or "0.9375rem" in btn_size[0]):
        passed += 1
    else:
        failures.append(f"Button font-size not 15px: {btn_size[0] if btn_size else 'not set'}")

    # 10. Selection uses warm color
    checks += 1
    if re.search(r"::selection\s*\{[^}]*(?:rgba\(204|rgba\(217|#cc785c|clay)", html, re.I):
        passed += 1
    else:
        failures.append("::selection not using warm clay color")

    score = (passed / checks * 100) if checks > 0 else 0
    return DimensionScore("D3: Typography", score, 100, passed, checks, failures)


def check_layout(html: str, test_id: str = "T01") -> DimensionScore:
    """D4: Validate layout and spacing."""
    checks = 0
    passed = 0
    failures = []

    # Page type classifications (Bug 5 fix)
    NO_NAV_TESTS = {"T03", "T04", "T08"}   # pricing, auth, components — no nav needed
    AUTH_TESTS = {"T04"}                    # auth form — allow narrower max-width

    # 1. Content max-width ~640px (reading) or ~768-840px (app)
    checks += 1
    max_w = re.findall(r"max-width:\s*(\d+)px", html)
    if max_w:
        widths = [int(w) for w in max_w]
        if test_id in AUTH_TESTS:
            # Auth form allows narrower max-width (360-500px)
            if any(360 <= w <= 500 for w in widths):
                passed += 1
            else:
                failures.append(f"Auth max-width not 360-500px: found {widths}")
        elif any(600 <= w <= 660 for w in widths) or any(740 <= w <= 860 for w in widths):
            passed += 1
        else:
            failures.append(f"Content max-width not 640/768-840px: found {widths}")
    else:
        if re.search(r"max-w-2xl|max-w-3xl|max-w-prose|--width-reading|--width-chat", html, re.I):
            passed += 1
        else:
            failures.append("Content max-width not found")

    # 2. Nav height ~68px — skip for pages that don't have nav (Bug 5 fix)
    if test_id not in NO_NAV_TESTS:
        checks += 1
        nav_h = re.findall(r"(?:nav|header|\.nav)\s*\{[^}]*height:\s*(\d+)px", html, re.I | re.DOTALL)
        if nav_h and any(60 <= int(h) <= 72 for h in nav_h):
            passed += 1
        elif re.search(r"--nav-height|h-\[68px\]|h-17|4\.25rem", html, re.I):
            passed += 1
        else:
            failures.append(f"Nav height not ~68px: {nav_h if nav_h else 'not found'}")

    # 3. Button border-radius 7.5px (or ~8px)
    checks += 1
    btn_radius = re.findall(r"(?:button|\.btn)[^{]*\{[^}]*border-radius:\s*([^;]+)", html, re.I | re.DOTALL)
    if btn_radius:
        r_val = btn_radius[0].strip()
        if any(v in r_val for v in ["7.5px", "0.47rem", "7px", "8px", "var(--radius)"]):
            passed += 1
        elif "rounded-full" in r_val or "50%" in r_val or "999" in r_val:
            failures.append(f"Button radius is pill-shaped: {r_val}")
        else:
            failures.append(f"Button border-radius not 7.5px: {r_val}")
    else:
        failures.append("Button border-radius not found")

    # 4. Card border-radius 8px
    checks += 1
    card_radius = re.findall(r"(?:\.card|\.pricing)[^{]*\{[^}]*border-radius:\s*([^;]+)", html, re.I | re.DOTALL)
    if card_radius:
        if any(v in card_radius[0] for v in ["8px", "0.5rem", "12px", "var(--radius)"]):
            passed += 1
        else:
            failures.append(f"Card border-radius not 8px: {card_radius[0]}")
    else:
        # Check if any element has 8px radius
        if re.search(r"border-radius:\s*(?:8px|0\.5rem|12px)", html):
            passed += 1
        else:
            failures.append("Card border-radius not found")

    # 5. Section spacing >= 48px
    checks += 1
    section_padding = re.findall(r"section\s*\{[^}]*padding(?:-top|-bottom)?:\s*(\d+)px", html, re.I | re.DOTALL)
    if section_padding and any(int(p) >= 48 for p in section_padding):
        passed += 1
    elif re.search(r"py-(?:1[2-9]|2[0-9])|py-\[(?:4[8-9]|[5-9]\d|[1-9]\d{2})px\]|padding:\s*(?:4[8-9]|[5-9]\d|[1-9]\d{2})px", html):
        passed += 1
    elif re.search(r"gap:\s*(?:4[8-9]|[5-9]\d|[1-9]\d{2})px", html):
        passed += 1
    else:
        failures.append("Section spacing < 48px or not found")

    # 6. 8px grid alignment (spot check common spacings)
    checks += 1
    all_spacings = re.findall(r"(?:padding|margin|gap):\s*(\d+)px", html)
    if all_spacings:
        spacings = [int(s) for s in all_spacings]
        # Allow 4,6,8,12,16,20,24,32,40,48,64,80 (8px grid with 4px sub-grid)
        valid = [s for s in spacings if s % 4 == 0 or s in [6, 10, 14, 15, 17]]
        ratio = len(valid) / len(spacings)
        if ratio >= 0.8:
            passed += 1
        else:
            off_grid = [s for s in spacings if s % 4 != 0 and s not in [6, 10, 14, 15, 17]]
            failures.append(f"8px grid: {ratio*100:.0f}% aligned (off-grid: {off_grid[:5]})")
    else:
        passed += 1  # No explicit px spacings = probably using CSS vars or Tailwind

    score = (passed / checks * 100) if checks > 0 else 0
    return DimensionScore("D4: Layout & Spacing", score, 100, passed, checks, failures)


def check_responsive(html: str, test_id: str) -> DimensionScore:
    """D5: Responsive design and accessibility."""
    checks = 0
    passed = 0
    failures = []

    # 1. Viewport meta tag
    checks += 1
    if re.search(r'<meta[^>]*name=["\']viewport["\'][^>]*width=device-width', html, re.I):
        passed += 1
    else:
        failures.append("Missing viewport meta tag")

    # 2. prefers-reduced-motion
    checks += 1
    if re.search(r"prefers-reduced-motion", html, re.I):
        passed += 1
    else:
        failures.append("Missing prefers-reduced-motion media query")

    # 3. :focus-visible
    checks += 1
    if re.search(r":focus-visible|focus-visible:", html, re.I):
        passed += 1
    else:
        failures.append("Missing :focus-visible styles")

    # 4. Responsive breakpoint
    checks += 1
    if re.search(r"@media\s*\([^)]*(?:max-width|min-width)\s*:\s*\d+px", html, re.I):
        passed += 1
    else:
        failures.append("No responsive media queries found")

    # 5. Dark mode support (for tests that need it)
    dark_tests = {"T01", "T03", "T04", "T06", "T07", "T10"}
    if test_id in dark_tests:
        checks += 1
        if re.search(r"\.dark\s*\{|prefers-color-scheme:\s*dark|data-theme", html, re.I):
            passed += 1
        else:
            failures.append("Dark mode not implemented (required for this test)")

    # 6. ::selection highlight
    checks += 1
    if re.search(r"::selection", html, re.I):
        passed += 1
    else:
        failures.append("Missing ::selection highlight")

    # 7. Smooth scroll
    checks += 1
    if re.search(r"scroll-behavior:\s*smooth", html, re.I):
        passed += 1
    else:
        failures.append("Missing scroll-behavior: smooth")

    # 8. CSS order: .dark block must appear AFTER :root block
    checks += 1
    root_pos = html.find(':root')
    dark_pos = html.find('.dark')
    if root_pos >= 0 and dark_pos >= 0:
        if dark_pos > root_pos:
            passed += 1
        else:
            failures.append("CSS order: .dark block appears before :root block (should be after)")
    else:
        # If either block is absent, skip this check (mark pass to avoid penalising pages without dark mode)
        passed += 1

    # Mobile-specific checks for T09
    if test_id == "T09":
        # 8. Touch targets >= 44px
        checks += 1
        if re.search(r"min-(?:height|width):\s*44px|padding:\s*(?:1[2-9]|2\d)px|h-11|w-11|min-h-\[44px\]", html, re.I):
            passed += 1
        else:
            failures.append("Touch targets may be < 44px")

        # 9. Input font-size 16px (prevent iOS zoom)
        checks += 1
        input_size = re.findall(r"input[^{]*\{[^}]*font-size:\s*([^;]+)", html, re.I | re.DOTALL)
        if input_size and ("16px" in input_size[0] or "1rem" in input_size[0]):
            passed += 1
        else:
            failures.append("Input font-size not 16px (iOS zoom prevention)")

        # 10. safe-area-inset
        checks += 1
        if re.search(r"safe-area-inset|env\(safe-area", html, re.I):
            passed += 1
        else:
            failures.append("Missing safe-area-inset for notch devices")

        # 11. Hamburger / mobile menu
        checks += 1
        if re.search(r"hamburger|mobile-menu|clip-path", html, re.I):
            passed += 1
        else:
            failures.append("No hamburger/mobile menu pattern found")

    score = (passed / checks * 100) if checks > 0 else 0
    return DimensionScore("D5: Responsive & A11y", score, 100, passed, checks, failures)


def check_components(html: str, test_id: str) -> DimensionScore:
    """D6: Check that expected components are present."""
    expected = EXPECTED_COMPONENTS.get(test_id, [])
    if not expected:
        return DimensionScore("D6: Components", 100, 100, 0, 0, [])

    checks = len(expected)
    passed = 0
    failures = []

    html_lower = html.lower()

    for comp in expected:
        found = False
        # Check various ways a component might be present
        patterns = [
            comp.lower(),                          # exact class/tag
            f"class=\"{comp.lower()}",             # class attribute
            f"class=\"[^\"]*{comp.lower()}",       # class contains
            f"<{comp.lower()}",                    # HTML tag
            f"id=\"{comp.lower()}",                # id attribute
            f"data-{comp.lower()}",                # data attribute
        ]

        for pat in patterns:
            if re.search(pat, html_lower):
                found = True
                break

        if found:
            passed += 1
        else:
            failures.append(f"Component not found: {comp}")

    score = (passed / checks * 100) if checks > 0 else 0
    return DimensionScore("D6: Components", score, 100, passed, checks, failures)


# ═══════════════════════════════════════════════════════════════
# MAIN EVALUATOR
# ═══════════════════════════════════════════════════════════════

def evaluate(html_path: str, test_id: str = "T01") -> EvalResult:
    """Run all 6 dimension checks on an HTML file."""
    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    result = EvalResult(
        test_id=test_id,
        file_path=html_path,
        d1_token=check_token_accuracy(html, test_id),
        d2_antipattern=check_anti_patterns(html),
        d3_typography=check_typography(html),
        d4_layout=check_layout(html, test_id),
        d5_responsive=check_responsive(html, test_id),
        d6_components=check_components(html, test_id),
    )
    return result


def print_report(result: EvalResult, verbose: bool = False):
    """Print human-readable evaluation report."""
    print(f"\n{'='*60}")
    print(f"  Claude Design Style Evaluation: {result.test_id}")
    print(f"  File: {result.file_path}")
    print(f"{'='*60}\n")

    dims = [
        ("D1: Token Accuracy   (25%)", result.d1_token),
        ("D2: Anti-Patterns    (20%)", result.d2_antipattern),
        ("D3: Typography       (15%)", result.d3_typography),
        ("D4: Layout & Spacing (15%)", result.d4_layout),
        ("D5: Responsive/A11y  (15%)", result.d5_responsive),
        ("D6: Components       (10%)", result.d6_components),
    ]

    for label, dim in dims:
        bar_len = int(dim.pct / 5)
        bar = "█" * bar_len + "░" * (20 - bar_len)
        status = "PASS" if dim.pct >= 90 else ("WARN" if dim.pct >= 70 else "FAIL")
        print(f"  {label}  {bar}  {dim.pct:5.1f}  [{status}]  ({dim.checks_passed}/{dim.checks_total})")

        if verbose and dim.failures:
            for f in dim.failures:
                print(f"    - {f}")

    print(f"\n  {'─'*50}")
    composite = result.composite
    grade = "A+" if composite >= 97 else ("A" if composite >= 93 else ("A-" if composite >= 90 else ("B+" if composite >= 87 else ("B" if composite >= 83 else ("B-" if composite >= 80 else "C")))))
    print(f"  COMPOSITE SCORE:  {composite}/100  (Grade: {grade})")
    print(f"{'='*60}\n")


def print_json(result: EvalResult):
    """Print JSON evaluation result."""
    data = {
        "test_id": result.test_id,
        "file": result.file_path,
        "composite": result.composite,
        "dimensions": {}
    }
    for attr in ["d1_token", "d2_antipattern", "d3_typography", "d4_layout", "d5_responsive", "d6_components"]:
        dim = getattr(result, attr)
        data["dimensions"][attr] = {
            "name": dim.name,
            "score": dim.pct,
            "passed": dim.checks_passed,
            "total": dim.checks_total,
            "failures": dim.failures,
        }
    print(json.dumps(data, indent=2, ensure_ascii=False))


def batch_evaluate(directory: str, output_json: bool = False):
    """Evaluate all HTML files in a directory."""
    dir_path = Path(directory)
    results = []
    for html_file in sorted(dir_path.glob("*.html")):
        # Infer test ID from filename (e.g., T01-landing.html -> T01)
        test_id = html_file.stem.split("-")[0].upper()
        if not test_id.startswith("T"):
            test_id = "T01"  # default
        result = evaluate(str(html_file), test_id)
        results.append(result)

    if output_json:
        batch_data = []
        for r in results:
            batch_data.append({
                "test_id": r.test_id,
                "file": r.file_path,
                "composite": r.composite,
                "d1": r.d1_token.pct,
                "d2": r.d2_antipattern.pct,
                "d3": r.d3_typography.pct,
                "d4": r.d4_layout.pct,
                "d5": r.d5_responsive.pct,
                "d6": r.d6_components.pct,
            })
        print(json.dumps(batch_data, indent=2))
    else:
        for r in results:
            print_report(r, verbose=False)

        # Summary table
        print(f"\n{'='*80}")
        print(f"  BATCH SUMMARY")
        print(f"{'='*80}")
        print(f"  {'Test':<6} {'D1':>6} {'D2':>6} {'D3':>6} {'D4':>6} {'D5':>6} {'D6':>6} {'Total':>7}")
        print(f"  {'─'*50}")
        total_composite = 0
        for r in results:
            print(f"  {r.test_id:<6} {r.d1_token.pct:>5.1f} {r.d2_antipattern.pct:>5.1f} {r.d3_typography.pct:>5.1f} {r.d4_layout.pct:>5.1f} {r.d5_responsive.pct:>5.1f} {r.d6_components.pct:>5.1f} {r.composite:>6.1f}")
            total_composite += r.composite
        avg = total_composite / len(results) if results else 0
        print(f"  {'─'*50}")
        print(f"  {'AVG':<6} {'':>6} {'':>6} {'':>6} {'':>6} {'':>6} {'':>6} {avg:>6.1f}")
        print(f"{'='*80}\n")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Claude Design Style Evaluator")
    parser.add_argument("file", nargs="?", help="HTML file to evaluate")
    parser.add_argument("--test-id", default="T01", help="Test case ID (T01-T10)")
    parser.add_argument("--batch", help="Evaluate all HTML files in directory")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show failure details")
    args = parser.parse_args()

    if args.batch:
        batch_evaluate(args.batch, args.json)
    elif args.file:
        result = evaluate(args.file, args.test_id)
        if args.json:
            print_json(result)
        else:
            print_report(result, args.verbose)
    else:
        parser.print_help()
        sys.exit(1)
