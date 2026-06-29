---
name: visual-ux-to-code
description: Design-first UI workflow for turning product requirements into coded interfaces. Use when the user asks to build, redesign, or polish UI screens, web apps, dashboards, product flows, landing pages, or says "先出图再写代码", "先做设计图", "图像模型设计UI", "核心页面示意图", "UX专家", "把设计图转成代码", or similar. Act as a UX designer first, map core screens and states, generate image-model mockups for important pages, get visual confirmation when direction materially matters, then implement code and verify in a real browser.
---

# Visual UX To Code

## Overview

Use this skill to avoid jumping from vague product intent directly into JSX/CSS. The default flow is: understand the product, define the core screen set, generate visual mockups where they reduce ambiguity, convert the approved direction into code, then verify the real interface in a browser.

## Operating Rules

- Prefer the project's existing design system, route structure, components, CSS tokens, AGENTS.md, DESIGN.md, and current screenshots over inventing a new style.
- Treat generated images as UX direction, not an exact pixel contract. Preserve real product constraints, data shape, accessibility, and implementation patterns.
- Skip image generation for tiny visual fixes, copy edits, or changes that clearly follow an existing pattern. State the skip reason briefly.
- Generate images before coding when the request changes the main layout, visual language, navigation model, onboarding flow, dashboard density, or multiple core pages.
- Use anonymous sample data in mockups. Do not place secrets, tokens, private user data, or real credentials in image prompts or screenshots.
- When the user must choose a visual direction, present 2-3 image options and ask for an A/B/C decision before coding.

## Workflow

1. Build a short UX brief.
   - Inspect the project first: app routes, main components, global styles, design docs, package stack, and available screenshots.
   - Identify the user, core job, navigation shape, main objects, information density, required states, and desktop/mobile breakpoints.
   - Summarize in a compact brief: user, primary task, core screens, style direction, implementation risks.

2. Define the core screen inventory.
   - List every screen/state needed for the request: primary pages, dialogs, empty/loading/error states, mobile variants, and important interaction states.
   - Mark each item as `mockup first` or `code directly`.
   - Prioritize mockups for new layouts, unfamiliar flows, brand-sensitive pages, dense dashboards, and multi-page redesigns.

3. Generate image-model mockups.
   - Create one focused prompt per core screen or state.
   - Include product context, screen purpose, viewport, layout hierarchy, sample content, controls, interaction hints, existing design constraints, and forbidden patterns.
   - Prefer realistic product UI over decorative scenes. Show the actual page structure the user will later use.
   - Review generated images for usability problems before showing them. If a mockup violates the brief, regenerate or correct it before asking the user.

4. Confirm the direction when needed.
   - If the visual direction is material, show the mockups and ask for a concise choice.
   - If one direction is clearly strongest, recommend it and explain the reason in one sentence.
   - Continue without extra confirmation only when the user already gave a clear direction or the change is low risk.

5. Convert the chosen direction into code.
   - Map mockup elements to existing components, routes, state, and data contracts.
   - Build complete UI states: normal, empty, loading, error, disabled, hover/focus, and mobile behavior when relevant.
   - Use familiar controls and icons already present in the project. Keep text short and product-like.
   - Do not fake core functionality if the project already has a real data path. Wire to existing APIs or stores where appropriate.

6. Verify in a real browser.
   - Start the app when needed and inspect desktop and mobile widths.
   - For selection, drag, floating UI, hover/click, scroll-following, or mobile gestures, reproduce the interaction in the browser before judging the fix.
   - Check for overflow, clipped text, blank canvases/images, broken controls, inaccessible focus states, and console errors.
   - Run the project's relevant lint, test, build, or visual checks when practical.

7. Handoff clearly.
   - Report the selected design direction, files changed, verification performed, and any remaining choice or risk.
   - Keep the summary short unless the user asks for a detailed design rationale.

## Image Prompt Template

Use this as a starting point and adapt it to the project:

```text
Product context:
[What the app does, target user, current design constraints]

Screen:
[Screen name and viewport, e.g. desktop 1440px or mobile 390px]

User goal:
[What the user is trying to complete]

Layout:
[Navigation, main regions, hierarchy, density, responsive behavior]

Content:
[Realistic sample headings, rows, controls, empty/error text]

Style:
[Mood, palette, typography, spacing, components, existing brand constraints]

Avoid:
[Patterns that would hurt this product, such as decorative filler, fake marketing hero, unreadable charts, oversized cards]
```
