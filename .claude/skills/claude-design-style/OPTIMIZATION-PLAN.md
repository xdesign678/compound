# Claude Design Style — 技能优化计划

**目标**: 将技能从"评测通过"提升到"生产完美"
**当前状态**: L2 视觉评测 8.29/10 PASS，但参考文档存在内部矛盾
**日期**: 2026-04-05

---

## Phase 1: 消除内部矛盾（P0 Critical）

**目标**: 确保代理无论读到哪个文件，获得的设计指令完全一致

### 1.1 验证色统一

当前冲突：

| 文件      | 错误色 token     | 值                 | 成功色         |
| --------- | ---------------- | ------------------ | -------------- |
| colors.md | `--status-error` | `#dc2626` (纯红)   | `#16a34a`      |
| forms.md  | `--state-error`  | `#b85b44` (暖色)   | `#5a856a`      |
| shadcn.md | `--destructive`  | `#dc2626` (纯红)   | —              |
| states.md | toast error      | `color-mix()` 暖色 | 暖色           |
| SKILL.md  | Anti-Patterns    | 禁止 `#dc2626`     | 禁止 `#16a34a` |

**统一方案**（以 SKILL.md + forms.md 为准）：

```
亮色:  error #b85b44  success #5a856a  warning #c4923a  info #5a7d9b
暗色:  error #d4826a  success #7aab87  warning #d4a85a  info #7a9db5
```

**修改文件**:

- [ ] `colors.md` — 删除 `--status-error: #dc2626` / `--status-success: #16a34a`，替换为暖色方案，token 名统一为 `--state-*`
- [ ] `shadcn.md` — `--destructive` 从 `#dc2626` 改为 `#b85b44`（HSL: `13 39% 50%`），暗色改为 `#d4826a`
- [ ] `states.md` — 确认 toast error 色与 `--state-error` 一致
- [ ] `forms.md` — 修复 error focus ring `rgba(220,38,38,0.12)` → `rgba(184,91,68,0.15)`

### 1.2 Breakpoint 统一

当前冲突：

- `layout.md` 提到 `--bp-desktop: 896px` 用于 hamburger 切换
- 同文件 CSS 示例用 `max-width: 767px`

**统一方案**: 以 768px 为分界（标准 tablet/desktop 断点），hamburger 在 `<768px` 显示

- [ ] `layout.md` — 修正 `--bp-desktop` 说明，与 CSS 示例一致

---

## Phase 2: 补全 SKILL.md 主文档（P1）

**目标**: 主文档包含所有关键 token，代理不需要读 references 也能输出正确结果

### 2.1 补充遗漏 token

- [ ] 在 `:root` 变量块中添加:
  - `--text-body: rgba(20,20,19,0.85)` — 正文文字（比 --text-primary 略柔和）
  - `--bg-active: rgba(20,20,19,0.06)` — 激活/选中态背景
  - `--font-reading: Lora, "Noto Serif SC", Georgia, serif` — 阅读内容字体
- [ ] 在暗色变量块中添加对应暗色值

### 2.2 修正 Checklist 计数

- [ ] 将 "18-item Quick Checklist" 改为 "28-item Quick Checklist"

### 2.3 补充验证色到 Quick Checklist

- [ ] 确认第 22 项验证色规范包含完整的亮色+暗色值

---

## Phase 3: 修复 run_eval.py 评测器（P1）

**目标**: L1 代码分析评分从 83.5 提升到 95+，消除误判

### 3.1 修复已知 bug

- [ ] **暗色阴影误判**: `heavy_shadow` 正则 `0\.[3-9]` 会错误标记暗色模式合法阴影（`0.32-0.40`）。修复：在 `.dark` 作用域内跳过此检查，或将阈值调整为 `0.[5-9]`
- [ ] **新增 CSS 顺序检查**: 验证 `.dark {}` 出现在 `:root {}` 之后（D5 维度新增检查项）
- [ ] **验证色检查更新**: Anti-Pattern 中添加检测 `#dc2626`、`#16a34a`、`#f87171`、`#4ade80` 等纯色值
- [ ] **D6 组件检测增强**: 从纯字符串匹配升级为检查关键 CSS 属性是否存在（如 button 必须有 `border-radius: 7.5px`）

### 3.2 新增检查项

- [ ] 检查 `--text-body` token 是否定义
- [ ] 检查 `font-display: swap` 是否存在（Web 性能）
- [ ] 检查暗色模式 `prefers-color-scheme: dark` media query 是否有 fallback

---

## Phase 4: 参考文档补全（P2）

**目标**: 覆盖常见 Web 应用场景，减少代理"即兴发挥"

### 4.1 组件补全

- [ ] `components.md` 添加 **Breadcrumb** 组件（文档/多级页面常用）
- [ ] `components.md` 添加 **Sticky Sidebar** 模式（文档/文章页常用）
- [ ] `forms.md` 添加 **Date Picker** 基础样式
- [ ] `components.md` 补充 Carousel **触摸滑动** 处理

### 4.2 可访问性补全

- [ ] `states.md` 添加 Pagination **aria 属性**（`aria-label="pagination"`、`aria-current="page"`）
- [ ] `forms.md` 添加 `autocomplete` 属性指南
- [ ] `typography.md` 添加 Latin 字体 `font-display: swap` 指南

### 4.3 缺失页面模式

- [ ] `states.md` 添加 **500/503 错误页**
- [ ] `states.md` 添加 **全页加载态**（路由切换时的 loading）

---

## Phase 5: 清理与归档（P2）

**目标**: 删除过期文件，保持技能目录整洁

### 5.1 归档旧版评测

- [ ] 将以下目录压缩为 `eval/archive-v1v2.tar.gz` 后删除:
  - `eval/screenshots/`（v1 截图）
  - `eval/reports/`（v1/v2 旧分数 JSON）
  - `eval/reports-v2/`（v2 千问分数）
  - `eval/reference/_meta/observations.md`（错误的 ground truth）
- [ ] 删除旧版 prompt 文件:
  - `eval/AUTO-EVAL-LOOP-PROMPT.md`（v1 Gemini Flash 版）
  - `eval/FIX-EVAL-PROMPT.md`
  - `eval/COMPARE-EVAL-PROMPT.md`
  - `eval/REFERENCE-CAPTURE-PROMPT.md`
- [ ] 保留:
  - `eval/AUTO-EVAL-LOOP-v3.md`（当前版本）
  - `eval/run_eval.py`（修复后）
  - `eval/tests/`（测试 HTML）
  - `eval/reference/screenshots/`（参考截图）
  - `eval/reports-v3/`（v3 分数）
  - `eval/screenshots-v3/`（v3 截图）

### 5.2 清理根目录

- [ ] 删除已完成的阶段文件:
  - `PHASE3-PLAN.md`、`PHASE4-PLAN.md`、`PHASE4-REPORT.md`
  - `PHASE5-PLAN.md`、`PHASE5-REPORT.md`
  - `EVAL-PLAN.md`
- [ ] 将关键历史决策摘要写入 `CHANGELOG.md`

---

## Phase 6: 终极验证

### 6.1 L1 代码验证

- [ ] 对 10 个测试页面运行修复后的 `run_eval.py`，目标 ≥ 95/100
- [ ] 确认零 false positive

### 6.2 L2 视觉验证

- [ ] 用 AUTO-EVAL-LOOP-v3.md 跑一轮（Sonnet 4.6），目标均分 ≥ 8.5
- [ ] 确认验证色在所有测试页面中统一

### 6.3 端到端测试

- [ ] 用技能生成一个全新页面（不在 T01-T10 中），验证:
  - 验证色是否为暖色 #b85b44（不是纯红）
  - 暗色模式 CSS 顺序是否正确
  - 所有 token 是否与 SKILL.md 一致

---

## 执行建议

| Phase   | 预估工作量 | 可并行            | 建议执行方式        |
| ------- | ---------- | ----------------- | ------------------- |
| Phase 1 | 中         | 1.1 和 1.2 可并行 | 代理直接修改        |
| Phase 2 | 小         | 与 Phase 1 同步   | 代理直接修改        |
| Phase 3 | 中         | 独立              | 代理修改 + 运行验证 |
| Phase 4 | 大         | 各子任务可并行    | 可拆给多个代理      |
| Phase 5 | 小         | 独立              | 代理执行            |
| Phase 6 | 中         | 6.1/6.2/6.3 串行  | 代理执行            |

**建议先执行 Phase 1 + 2**（消除矛盾 + 补全主文档），这是投入产出比最高的优化。

---

_计划版本: v1.0 | 基于 2026-04-05 全量代码审查_
