# E2E 修复报告 — claude-design-style 技能

**修复日期**：2026-04-05
**基于报告**：E2E-TEST-REPORT.md（2026-04-05）
**修复文件**：`SKILL.md`（共 9 个问题，全部修复）

---

## 问题 1：暗色模式 featured pricing card 缺乏处理指引

**原问题**：`--bg-button` 在暗色模式下变为 `#ece9e1`（cream），导致 featured card 在深色页面背景中出现意外的亮色块。

**修复内容**：在 `### Dark Mode Edge Cases` 新增节（位于 Dark Mode Overrides 代码块之后），提供了具体 override 代码：

```css
.dark .pricing-card.featured { background: #2e2e2b; ... }
.dark .pricing-card.featured .btn-primary { background: var(--text-primary); color: var(--bg-primary); }
```

**涉及文件**：`SKILL.md`

---

## 问题 2：暗色模式 nav border-bottom 可见性不足

**原问题**：`--border-section` 在暗色下为 `rgba(236,233,225,0.06)`，几乎不可见，但文档未说明这是有意为之还是应该调整。

**修复内容**：在同一 `### Dark Mode Edge Cases` 节中，明确说明：超淡分割线是 Anthropic 设计的正确行为（导航融入页面），同时提供可选的 `0.10` 透明度 override 供需要更明显分割线的场景使用。

**涉及文件**：`SKILL.md`

---

## 问题 3：marketing vs reading 页面 serif 使用规则歧义

**原问题**：SKILL.md 正文说 "This skill focuses on the claude.ai reading-focused pattern (serif body, sans headings)"，但 typography.md 说营销页应使用 sans body。Landing 页既是营销页又可能是 app 入口，产生歧义。

**修复内容**：将 `### Dual Brand Context` 改写，明确区分：

- **Marketing/Landing 页**：sans body + 可选 serif 大标题（display headline）
- **Reading/Article/App 页**：serif body + sans headings

保留 "skill 默认 claude.ai 阅读模式" 的说明，但补充 "纯营销页请切换为 sans body"。

**涉及文件**：`SKILL.md`

---

## 问题 4：`--font-reading` 混入 Colors 区块，token 定义散落

**原问题**：SKILL.md Quick Reference 的 `:root` 代码块标题为 "Colors — Light Mode"，但其中混有字体变量，令读者容易忽略或误解字体 token 的定义位置。

**修复内容**：

- 将 `### Colors — Light Mode` 重命名为 `### CSS Custom Properties — Light Mode (Colors + Typography)`
- 在代码块前加说明：字体 token 不随暗色模式变化
- 将 `### Colors — Dark Mode` 重命名为 `### CSS Custom Properties — Dark Mode Overrides`

**涉及文件**：`SKILL.md`

---

## 问题 5：`--font-sans` 和 `--font-mono` 未在 Quick Reference 中列出

**原问题**：Quick Reference 的 `:root` 代码块只有 `--font-reading`，缺少 `--font-sans` 和 `--font-mono`，生成时容易硬编码 `'Inter'` 而不是使用 token。

**修复内容**：在 `:root` 代码块 `/* Typography */` 注释下同时列出三个字体变量：

```css
--font-sans: Geist, Inter, system-ui, -apple-system, sans-serif;
--font-reading: Lora, 'Noto Serif SC', Georgia, 'Times New Roman', serif;
--font-mono: 'Geist Mono', 'JetBrains Mono', 'SF Mono', monospace;
```

**涉及文件**：`SKILL.md`

---

## 问题 6：`prefers-reduced-motion` 仅在 Checklist 第 28 条提及，无代码示例

**原问题**：SKILL.md 正文 Transitions 节没有示例代码，新用户不知道如何实现。

**修复内容**：在 `### Transitions` 节末尾（`See references/motion.md` 链接之前）添加示例代码块和说明文字：

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

**涉及文件**：`SKILL.md`（与 `references/motion.md` 中已有的 Reduced Motion 节保持一致）

---

## 问题 7：暗色模式 link `text-decoration-color` 未覆盖

**原问题**：Links 组件只给出亮色模式的 `rgba(20,20,19,0.3)` 下划线颜色，暗色模式下该值在深色背景上几乎不可见，但文档无任何提醒。

**修复内容**：在 `### Links` 代码块后追加暗色 override：

```css
.dark a {
  text-decoration-color: rgba(236, 233, 225, 0.3);
}
.dark a:hover {
  text-decoration-color: rgba(236, 233, 225, 0.6);
}
```

并加注释说明这是必须项，否则下划线不可见。

**涉及文件**：`SKILL.md`

---

## 问题 8：Inputs 代码示例 `font-size: 15px` 与 Checklist 第 25 条矛盾

**原问题**：`### Inputs` 代码示例用 `font-size: 15px`，但 Checklist 第 25 条要求 `inputs use font-size: 16px to prevent iOS zoom`，两处矛盾。

**修复内容**：将 Inputs 代码块中的 `font-size: 15px` 改为 `font-size: 16px`，并添加注释：

```css
font-size: 16px; /* 16px required — prevents iOS auto-zoom on focus */
```

**涉及文件**：`SKILL.md`

---

## 问题 9（报告中 P1-4）：`--font-reading` 变量名与位置不一致

此问题与问题 4 合并处理，通过重命名 `:root` 代码块标题并整合字体 token 已解决。

---

## 修复汇总表

| #   | 问题                               | 修复位置                             | 修复类型                   |
| --- | ---------------------------------- | ------------------------------------ | -------------------------- |
| 1   | 暗色 featured card 无处理指引      | SKILL.md — Dark Mode Edge Cases 新节 | 新增代码示例               |
| 2   | 暗色 nav border 可见性不明         | SKILL.md — Dark Mode Edge Cases 新节 | 新增说明 + 可选 override   |
| 3   | marketing vs reading serif 歧义    | SKILL.md — Dual Brand Context 节     | 重写说明，明确两种情境规则 |
| 4   | font token 混入 Colors 区块        | SKILL.md — 代码块标题                | 重命名标题，加说明         |
| 5   | `--font-sans`/`--font-mono` 未列出 | SKILL.md — `:root` 代码块            | 补充两个 token             |
| 6   | `prefers-reduced-motion` 无示例    | SKILL.md — Transitions 节            | 新增代码示例               |
| 7   | 暗色 link underline 未覆盖         | SKILL.md — Links 节                  | 新增 `.dark a` override    |
| 8   | input font-size 15px vs 16px 矛盾  | SKILL.md — Inputs 节                 | 改为 16px + 加注释         |
| 9   | font token 散落（同问题 4）        | SKILL.md — 代码块标题                | 合并至问题 4 修复          |

---

_报告生成于 2026-04-05_
