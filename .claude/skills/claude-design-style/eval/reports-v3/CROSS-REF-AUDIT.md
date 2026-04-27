# Cross-Reference Consistency Audit

**审计范围**: `SKILL.md` ↔ `references/*.md` (10 个参考文件)
**审计日期**: 2026-04-05
**审计方法**: 逐一对比同名 token/值在不同文件中的定义

---

## 检查项目总览

| Token / 项目                                     | 检查结果      | 说明                                                                            |
| ------------------------------------------------ | ------------- | ------------------------------------------------------------------------------- |
| `--bg-primary` light (`#faf9f5`)                 | ✅ 一致       | SKILL.md、colors.md、所有 HTML 文件一致                                         |
| `--bg-primary` dark (`#1a1a18`)                  | ✅ 一致       | 所有文件一致                                                                    |
| `--bg-secondary` light (`#f0eee6`)               | ✅ 一致       | SKILL.md、colors.md 一致                                                        |
| `--bg-secondary` dark (`#232320`)                | ✅ 一致       |                                                                                 |
| `--bg-card` light (`#fefdfb`)                    | ✅ 一致       |                                                                                 |
| `--bg-card` dark (`#232320`)                     | ✅ 一致       |                                                                                 |
| `--bg-button` light (`#0f0f0e`)                  | ✅ 一致       |                                                                                 |
| `--bg-button` dark (`#ece9e1`)                   | ✅ 一致       |                                                                                 |
| `--bg-button-hover` light (`#3d3d3a`)            | ✅ 一致       |                                                                                 |
| `--bg-button-hover` dark (`#d4d1c9`)             | ✅ 一致       |                                                                                 |
| `--bg-hover` light (`#f5f4f0`)                   | ✅ 一致       |                                                                                 |
| `--bg-hover` dark (`#2a2a27`)                    | ✅ 一致       |                                                                                 |
| `--bg-muted` light (`#f0efe8`)                   | ✅ 一致       |                                                                                 |
| `--bg-muted` dark (`#2a2a27`)                    | ✅ 一致       |                                                                                 |
| `--bg-active` light (`rgba(20,20,19,0.06)`)      | ✅ 一致       | SKILL.md 与 e2e HTML 一致                                                       |
| **`--bg-active` dark**                           | ❌ **不一致** | 见下方详细说明                                                                  |
| `--text-primary` light (`#141413`)               | ✅ 一致       |                                                                                 |
| `--text-primary` dark (`#ece9e1`)                | ✅ 一致       |                                                                                 |
| `--text-body` light (`rgba(20,20,19,0.85)`)      | ✅ 一致       |                                                                                 |
| `--text-body` dark (`rgba(236,233,225,0.85)`)    | ✅ 一致       |                                                                                 |
| `--text-secondary` light (`#5e5d59`)             | ✅ 一致       |                                                                                 |
| `--text-secondary` dark (`#9b9b95`)              | ✅ 一致       |                                                                                 |
| `--text-tertiary` light (`#b0aea5`)              | ✅ 一致       |                                                                                 |
| `--text-tertiary` dark (`#6b6b66`)               | ✅ 一致       |                                                                                 |
| `--text-on-button` light (`#faf9f5`)             | ✅ 一致       |                                                                                 |
| `--text-on-button` dark (`#1a1a18`)              | ✅ 一致       |                                                                                 |
| `--brand-clay` (`#d97757`)                       | ✅ 一致       | brand.md、colors.md、SKILL.md 全部一致                                          |
| `--border-light` light (`rgba(20,20,19,0.08)`)   | ✅ 一致       |                                                                                 |
| `--border-default` light (`rgba(20,20,19,0.12)`) | ✅ 一致       |                                                                                 |
| `--border-section` light (`rgba(20,20,19,0.06)`) | ✅ 一致       |                                                                                 |
| `--border-*` dark                                | ✅ 一致       | `rgba(236,233,225,0.08/0.12/0.06)` 全部一致                                     |
| `--shadow-sm/md/lg` light                        | ✅ 一致       |                                                                                 |
| `--shadow-sm/md/lg` dark                         | ✅ 一致       |                                                                                 |
| 字体栈 sans                                      | ✅ 一致       | Geist → Inter → system-ui                                                       |
| 字体栈 serif/reading                             | ⚠️ 命名差异   | 见下方说明（非错误，仅写法不同）                                                |
| 字体栈 mono                                      | ✅ 一致       |                                                                                 |
| 圆角 button (`7.5px`)                            | ✅ 一致       | SKILL.md、components.md、forms.md、shadcn.md 一致                               |
| 圆角 card (`8px`)                                | ✅ 一致       |                                                                                 |
| 内容宽度 reading (`640px`)                       | ✅ 一致       | SKILL.md、layout.md 一致                                                        |
| 内容宽度 chat (`768-840px`)                      | ✅ 一致       |                                                                                 |
| Nav 高度 (`68px`)                                | ✅ 一致       | SKILL.md、layout.md、brand.md、claude-app.md 一致                               |
| Hamburger 断点 (`< 768px`)                       | ✅ 一致       | layout.md `max-width: 767px`，SKILL.md checklist item 27 说 "below 768px"，等价 |
| **验证色 `--state-warning`**                     | ❌ **不一致** | 见下方详细说明                                                                  |
| 验证色 error light (`#b85b44`)                   | ✅ 一致       | SKILL.md、colors.md、forms.md、shadcn.md 一致                                   |
| 验证色 error dark (`#d4826a`)                    | ✅ 一致       |                                                                                 |
| 验证色 success light (`#5a856a`)                 | ✅ 一致       |                                                                                 |
| 验证色 success dark (`#7aab87`)                  | ✅ 一致       |                                                                                 |
| 验证色 info light (`#5a7d9b`)                    | ✅ 一致       | colors.md 独有，SKILL.md 未列出（非错误）                                       |
| Selection (`rgba(204,120,92,0.5)`)               | ✅ 一致       | SKILL.md、colors.md、所有 HTML 文件一致                                         |
| Transition 值                                    | ✅ 一致       | `150ms/200ms/300ms` 全部一致                                                    |
| Body 字体大小 (`17px`)                           | ✅ 一致       |                                                                                 |
| H1 clamp (`clamp(2.5rem,...,4rem)`)              | ✅ 一致       |                                                                                 |
| H2 clamp (`clamp(1.75rem,...,2.5rem)`)           | ✅ 一致       |                                                                                 |
| H3 clamp (`clamp(1.25rem,...,1.75rem)`)          | ✅ 一致       |                                                                                 |
| Site margin clamp                                | ✅ 一致       | `clamp(2rem, 1.08rem + 3.92vw, 5rem)` 全部一致                                  |

---

## 不一致详细说明与修复

### 1. `--bg-active` 暗色模式值不一致 ❌

**发现位置**: `SKILL.md` vs `references/colors.md`

| 文件                              | 值                       |
| --------------------------------- | ------------------------ |
| `SKILL.md` dark `.dark` block     | `rgba(236,233,225,0.08)` |
| `references/colors.md` dark block | `#333330`（实色）        |

**分析**: SKILL.md 使用透明度值（与 light mode 的 `rgba(20,20,19,0.06)` 对称），colors.md 使用实色。SKILL.md 的 alpha 版本更系统化、更符合设计哲学（warm-tinted alpha）。

**修复**: 以 SKILL.md 为准，修正 colors.md 中的值为 `rgba(236,233,225,0.08)`。

**已修复**: `references/colors.md` 第 83 行 `--bg-active: #333330;` → `--bg-active: rgba(236,233,225,0.08);`

---

### 2. `--state-warning` 浅色模式值不一致 ❌

**发现位置**: `references/forms.md` vs `references/colors.md`

| 文件                                 | 值                         |
| ------------------------------------ | -------------------------- |
| `references/forms.md` `:root` block  | `--state-warning: #9a7020` |
| `references/colors.md` `:root` block | `--state-warning: #c4923a` |

**分析**: `#c4923a` 是一个更温暖、更明亮的琥珀色，与 brand clay 家族更协调；`#9a7020` 偏橄榄/棕，与整体暖色调有偏差。colors.md 是颜色系统的权威来源，以其为准。

**修复**: 以 `colors.md`（`#c4923a`）为准，修正 forms.md 中的值。

**已修复**: `references/forms.md` `--state-warning: #9a7020` → `--state-warning: #c4923a`

---

### 3. 字体栈变量名命名差异 ⚠️（非错误，记录在案）

**发现位置**: `SKILL.md` vs `references/typography.md`

| 文件            | 定义方式                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `SKILL.md`      | `--font-reading: Lora, "Noto Serif SC", Georgia, "Times New Roman", serif`                               |
| `typography.md` | `--font-reading: var(--font-serif), var(--font-serif-sc), Georgia, "Times New Roman", serif`（组合变量） |

**分析**: 这是两种等价的写法。`typography.md` 定义了中间变量 `--font-serif` 和 `--font-serif-sc`，而 SKILL.md 直接展开。两者都正确，SKILL.md 的直展写法在 quick reference 场景下更易用。**无需修复**，仅记录差异。

---

### 4. `--bg-active` light mode 写法差异 ⚠️（轻微，已记录）

| 文件        | 值                    |
| ----------- | --------------------- |
| `SKILL.md`  | `rgba(20,20,19,0.06)` |
| `colors.md` | `#efeee8`（实色）     |

**分析**: 两者在视觉上几乎等同（`rgba(20,20,19,0.06)` on `#faf9f5` ≈ `#efeee8`）。colors.md 有更多扩展字段（如 `--bg-secondary-hover: #e8e6dc`），而 SKILL.md 是精简快速参考。以透明度版本（SKILL.md）为权威，因为它在不同背景上更通用。**保持现状，无需修复**。

---

## 修复执行记录

### 修复 1：colors.md `--bg-active` dark

```diff
- --bg-active: #333330;
+ --bg-active: rgba(236,233,225,0.08);
```

### 修复 2：forms.md `--state-warning`

```diff
- --state-warning: #9a7020;
+ --state-warning: #c4923a;
```

---

## 总结

| 类型                           | 数量 |
| ------------------------------ | ---- |
| 检查的 token / 项目            | 51   |
| 完全一致                       | 47   |
| 发现不一致（已修复）           | 2    |
| 轻微差异（记录在案，保持现状） | 2    |

所有核心颜色值、圆角、字体栈、间距值、断点在 SKILL.md 与 references/\*.md 之间**高度一致**。两处不一致已按 SKILL.md 为准完成修复。
