# claude-design-style

将 Anthropic / Claude 官网的设计美学应用到任意 Web 项目。基于对 anthropic.com、claude.ai 和 Claude App 界面的深度分析提炼。

这套设计系统强调**温暖简约**、**排版清晰**、**充裕留白**和**文学阅读体验**。

---

## 安装

### 方式一：使用 clawhub（推荐）

```bash
clawhub install claude-design-style
```

### 方式二：手动安装

将本仓库克隆到 Claude Code 的技能目录：

```bash
git clone https://github.com/xdesign678/claude-design-style.git \
  ~/.claude/skills/claude-design-style
```

验证安装：

```bash
ls ~/.claude/skills/claude-design-style/SKILL.md
```

---

## 使用方法

安装后，在与 Claude Code 对话时，使用以下任意触发词即可激活该技能：

### 中文触发词

- "做成 Claude 风格"
- "温暖简约设计"
- "文学感网页"
- "Anthropic 设计风格"
- "阅读体验"
- "克制优雅设计"

### 英文触发词

- "Claude style"
- "Anthropic design"
- "elegant reading design"
- "warm minimal design"
- "literary web design"

### 示例对话

```
用户：帮我把这个页面做成 Claude 风格

用户：用 Anthropic 设计风格重新设计这个组件

用户：这个博客页面改成温暖简约设计，有文学阅读感
```

---

## 适用场景

| 场景                 | 推荐      |
| -------------------- | --------- |
| 博客、文章页面       | ✅ 首选   |
| 知识库、文档站       | ✅ 首选   |
| AI 对话界面          | ✅ 适合   |
| 作品集、个人主页     | ✅ 适合   |
| 数据大盘 / Dashboard | ❌ 不适合 |
| 电商、营销落地页     | ❌ 不适合 |
| 游戏 / 娱乐界面      | ❌ 不适合 |

---

## 设计系统概览

### 核心色板

| Token              | 值        | 用途                     |
| ------------------ | --------- | ------------------------ |
| `--bg-primary`     | `#faf9f5` | 温暖奶油色背景           |
| `--text-primary`   | `#141413` | 标题与正文               |
| `--text-secondary` | `#5e5d59` | 辅助文字                 |
| `--bg-button`      | `#0f0f0e` | 主按钮背景               |
| `--brand-clay`     | `#d97757` | Claude 品牌橙（仅 Logo） |

### 字体系统

| 用途      | 字体栈                                      |
| --------- | ------------------------------------------- |
| 正文阅读  | `Lora, "Noto Serif SC", Georgia, serif`     |
| 标题 / UI | `Geist, Inter, system-ui, sans-serif`       |
| 代码      | `"Geist Mono", "JetBrains Mono", monospace` |

### 暗色模式

| Token              | 值        | 用途                 |
| ------------------ | --------- | -------------------- |
| `--bg-primary`     | `#1a1a18` | 暖炭灰背景（非纯黑） |
| `--text-primary`   | `#ece9e1` | 暖白文字             |
| `--bg-button`      | `#ece9e1` | 按钮反转为浅色       |
| `--text-on-button` | `#1a1a18` | 按钮文字反转为深色   |

关键规则：`.dark {}` CSS 块必须写在 `:root {}` 之后（同特异性，后定义优先）。

### 验证色（品牌对齐）

| 语义    | 亮色                   | 暗色      |
| ------- | ---------------------- | --------- |
| Error   | `#b85b44` 温暖砖红     | `#d4826a` |
| Success | `#5a856a` 哑光鼠尾草绿 | `#7aab87` |
| Warning | `#c4923a`              | `#d4a85a` |
| Info    | `#5a7d9b`              | `#7a9db5` |

禁止使用纯色 `#dc2626`、`#16a34a` 等，与品牌暖色调冲突。

### 关键规则

- 按钮圆角：`7.5px`（Anthropic 标志性圆角，非 pill 形）
- 内容最大宽度：640px（阅读）/ 768-840px（应用）
- 无渐变，无纹理，无重阴影
- 行高 1.6（正文），1.1-1.3（标题）
- 过渡动画 150-300ms ease
- 28 项 Quick Checklist 覆盖色彩、字体、组件、暗色、移动端、无障碍

---

## 参考文件

技能包含 10 个按需加载的参考文件，Claude 会根据任务类型自动选择加载：

| 文件                       | 内容                                      |
| -------------------------- | ----------------------------------------- |
| `references/colors.md`     | 完整色彩 Token、Tailwind 配置             |
| `references/typography.md` | 字体加载、类型比例、Tailwind 配置         |
| `references/components.md` | 代码块、下拉、弹窗、徽章、表格等          |
| `references/layout.md`     | 网格系统、响应式断点、页面模板            |
| `references/motion.md`     | 关键帧、过渡、加载状态、滚动行为          |
| `references/brand.md`      | Logo SVG、图标规范、品牌使用规则          |
| `references/claude-app.md` | AI 对话 UI：消息气泡、输入框、侧边栏      |
| `references/forms.md`      | 表单验证状态、字段组、特殊输入控件        |
| `references/states.md`     | 空状态、骨架屏、Toast、错误页             |
| `references/shadcn.md`     | shadcn/ui 主题配置、HSL 变量、globals.css |

---

## 不适合此技能的情况

- 通用的"让它更好看"请求（无明确审美方向）
- 需要高信息密度的数据展示界面
- 需要强调品牌个性的营销页面

---

## 质量保证

技能内置完整评测框架（`eval/` 目录）：

- **L1 代码分析**（`run_eval.py`）：22 项 token 精确匹配 + 12 项反模式检测 + 字体/布局/响应式检查，当前 10 个测试页面平均 **98.65/100**
- **L2 视觉对比**（`AUTO-EVAL-LOOP-v3.md`）：对比 Anthropic 官网真实截图，7 维度评分，当前均分 **8.29/10**
- **10 个测试页面**覆盖：Landing、Article、Pricing、Auth、Chat、Dashboard、States、Components、Mobile、Darkmode

---

## 变更记录

### 2026-04-05 Phase 7 生产优化

- **验证色统一**：消除 colors.md / shadcn.md / forms.md / states.md 之间的冲突，统一为暖色方案（error `#b85b44`、success `#5a856a`），token 名统一为 `--state-*`
- **SKILL.md 补全**：新增 `--text-body`、`--bg-active`、`--font-reading` token，checklist 计数修正为 28 项
- **组件补全**：新增 Breadcrumb（含 aria）、Sticky Sidebar、Date Picker、Carousel 触摸滑动、500/503 错误页、全页加载态、Pagination aria 属性
- **typography.md**：新增 `font-display: swap` 指南、`@font-face` 示例
- **forms.md**：新增 autocomplete 属性指南，修复 error focus ring 纯红色问题
- **run_eval.py**：修复暗色阴影误判，新增 CSS 顺序检查和纯色验证色检测
- **Breakpoint 统一**：hamburger 切换断点统一为 `< 768px`
- **清理**：归档 v1/v2 旧评测数据，删除过期计划文件

### 2026-04-04 Phase 6 design-extractor 对比校准

- **colors.md**: 基于 anthropic.com DevTools 实测数据，修正 3 个关键 token：
  - `--bg-button-hover`: `#2a2a27` -> `#3d3d3a`（按钮悬停色偏暗）
  - `--bg-secondary`: `#f9f9f7` -> `#f0eee6`（区域背景色偏冷偏白）
  - 边框基色从 `rgba(0,0,0,...)` 改为 `rgba(20,20,19,...)`（暖色调一致性）
- **colors.md**: 新增 `--bg-secondary-hover: #e8e6dc`、`--brand-clay-accent: #c6613f`
- **colors.md**: 扩展色板 6 色全部更新为实际提取值（olive/cactus/sky/heather/fig/coral）
- **typography.md**: 字体名称更新 `AnthropicSans` -> `Anthropic Sans`（带空格）
- **SKILL.md**: 同步更新快速参考 token 和 checklist 中的边框描述

### 2026-04-04 Phase 4.5 移动端 + 暗色模式全量补充

- **layout.md**: 新增 `Mobile-First Essentials` 章节（viewport meta、safe area、touch targets、iOS zoom prevention、scroll behavior、移动端导航等）
- **forms.md**: 新增 `Dark Mode`（验证色暗色变体、toggle/select 暗色适配）和 `Mobile Touch Targets`（输入框 16px、checkbox/radio/toggle 44px 触摸区域）
- **states.md**: 新增 `Mobile Adaptations`（toast safe-area、pagination 触摸优化、empty/error 移动端间距）
- **components.md**: 新增 `Pricing Card (Featured)`（颜色反转模式 + 暗色模式 + 移动端 badge 溢出保护）
- **claude-app.md**: 修复 `cursor-pulse` -> `cursor-blink`，补充完整 keyframe 定义
- **SKILL.md**: Quick Checklist 从 18 条扩展到 27 条，覆盖暗色模式(3 条)、移动端(5 条)、reduced-motion(1 条)

### 2026-04-04 Phase 3 实测验证修复

- **blockquote 修正**：实测 anthropic.com/research 文章页，blockquote 边框为 `1px solid var(--text-primary)`（非原文档的 `2px solid rgba(20,20,19,0.15)`），padding-left 为 16px（非 24px）。已同步更新 `components.md`、`typography.md`、`SKILL.md`。
- **colors.md 色彩说明更新**：anthropic.com 当前背景色已测量为 `#faf9f5`（与 claude.ai 一致），移除了旧的 `#e8e6dc` 区别说明。

---

## License

详见 [LICENSE.txt](LICENSE.txt)
