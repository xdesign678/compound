# Compound UX 全面审计报告

> **审计日期**: 2026-05-11
> **审计方法**: Playwright 实机走查 + Nielsen 10 大启发式评估
> **覆盖范围**: Desktop (1280×800) + Tablet (768×1024) + Mobile (375×812)
> **参考标准**: Claude Design Style (Anthropic 设计系统)
> **审计团队**: Agent A (状态反馈) + Agent B (导航心智) + Agent C (视觉/CSS)

---

## 执行摘要

| 严重程度       | 数量   |
| -------------- | ------ |
| 🔴 Critical    | 7      |
| 🟠 Major       | 12     |
| 🟡 Minor       | 13     |
| 🔵 Enhancement | 6      |
| **总计**       | **38** |

### Top 5 最有影响力的改进

1. **修复首页自动重定向 + Escape 键跳转 bug** — 用户无法稳定停留在首页，严重破坏基础使用体验
2. **消除 CSS !important 战争** — 111 处 !important 是技术债的核心，影响所有后续样式修改的效率
3. **Token 化 CSS 硬编码值** — font-size token 使用率仅 12%，spacing 仅 1.2%，是设计一致性的根本瓶颈
4. **统一 /sync 和 /review 的认证错误处理** — 暴露原始 "Unauthorized" 文本，用户体验断裂
5. **修复搜索按钮跳转到离线页面** — 核心功能路径错误，直接影响移动端可用性

---

## 🔴 Critical 问题 (7)

### C-01 | 首页频繁自动重定向到其他页面

- **Nielsen**: H3 用户控制与自由 + H7 灵活高效
- **页面**: `/` 首页 | Desktop + Mobile
- **现状**: 加载首页 2-3 秒后自动跳转到 `/sync`、`/recap` 或 `/review`，行为不确定且不可预测
- **影响**: 用户完全无法稳定停留在首页，心智模型被严重破坏
- **修复**: 去除自动导航逻辑，或限定为仅在明确条件下触发并给用户选择权
- **文件**: `app/page.tsx` 中的导航逻辑

### C-02 | Escape 键触发意外跳转到 /sync

- **Nielsen**: H3 用户控制与自由
- **页面**: 首页任意 Tab | Desktop
- **现状**: 在首页按 Escape 键（无论场景），页面会意外导航到 `/sync`
- **影响**: 用户频繁丢失当前工作上下文
- **修复**: 检查 Escape 键事件处理链，确保只在有弹窗/overlay 打开时触发关闭，而非全局导航
- **文件**: `lib/hooks/useKeyboardShortcuts.ts`

### C-03 | 搜索按钮在移动端跳转到离线页面

- **Nielsen**: H2 系统与现实匹配
- **页面**: 移动端 Header → 搜索图标 | Mobile 375×812
- **现状**: 点击搜索图标后跳转到 `/offline`（离线模式页面），而非打开搜索
- **影响**: 核心功能路径完全错误
- **修复**: 修复搜索按钮的 onClick 事件绑定
- **文件**: `components/Header.tsx`

### C-04 | /sync 和 /review 页面暴露原始 "Unauthorized" 错误

- **Nielsen**: H1 系统状态可见性 + H9 错误恢复
- **页面**: `/sync` + `/review` | Desktop + Mobile
- **现状**: 页面顶部显示裸露的英文 "Unauthorized" 文本，无样式、无说明、无操作指引
- **影响**: 用户无法理解问题原因，无法自行解决
- **修复**: 使用 store 中已有的 `ERROR_MESSAGES['401']` 映射显示中文错误消息"认证失败，请在设置中检查 API 配置"，添加指向设置的操作按钮
- **文件**: `app/sync/page.tsx`, `app/review/page.tsx`, `lib/store/ui-slice.ts`

### C-05 | CSS !important 样式战争 (111 处)

- **Nielsen**: H4 一致性与标准
- **页面**: 全局 CSS
- **现状**: `globals.css` L5648-5876 段 "CLAUDE DESIGN SYSTEM OVERRIDES" 使用了 111 个 `!important` 强制覆盖前面的样式。例如 `.msg-user` 的 border-radius 被 4 处不同声明覆盖 (18px→8px→12px→16px)
- **影响**: 样式维护极其困难，任何修改都可能被覆盖或产生意外效果
- **修复**: 将 OVERRIDES 段的值合并回组件原始定义位置，删除 !important。如需层叠控制，使用 CSS `@layer`。目标: !important < 15 处
- **文件**: `app/globals.css` L5648-5876

### C-06 | font-size Token 使用率仅 12%

- **Nielsen**: H4 一致性与标准
- **页面**: 全局 CSS
- **现状**: 定义了完整的 `--text-2xs` 到 `--text-2xl` 共 8 级 type-scale token，但 465 处 font-size 声明中仅 57 处(12%)使用了 token，其余 408 处硬编码像素值。含 42 处不在 scale 上的半像素值 (10.5px, 11.5px, 12.5px...)
- **影响**: 设计系统形同虚设，排版一致性无法保证
- **修复**: 批量替换 12px→`var(--text-xs)`, 13px→`var(--text-sm)`, 15px→`var(--text-base)`; 必要时扩展 scale
- **文件**: `app/globals.css` 全文

### C-07 | Cmd+K 命令面板在某些状态下触发 JS 崩溃

- **Nielsen**: H5 错误预防
- **页面**: 概念详情页返回后 | Desktop
- **现状**: 从概念详情页返回后按 `Meta+k` 触发全页面错误 "页面遇到问题"，显示 Sentry 错误
- **影响**: 快捷键不应导致页面崩溃
- **修复**: 检查命令面板初始化逻辑的 null safety，添加 try-catch 保护
- **文件**: `components/CommandPalette.tsx`

---

## 🟠 Major 问题 (12)

### M-01 | "活动" Tab 名称与内容严重不匹配

- **Nielsen**: H2 系统与现实匹配
- **页面**: 活动 Tab | Desktop
- **现状**:
  - 侧边栏点击 → 跳到 `/review`（审核队列）
  - tabpanel 模式 → 显示"知识库健康检查"
  - "活动"让用户联想到 activity feed，但实际是运维功能
- **修复**: 将 Tab 名改为"维护"或"运维"；或将内容统一为活动流

### M-02 | Tab 切换状态不一致/延迟导致跳转

- **Nielsen**: H2 + H6
- **页面**: 所有 Tab | Desktop + Mobile
- **现状**:
  - 首次点击"问答"Tab 后页面仍显示 Wiki 内容
  - `selected`/`active` 属性同时出现在两个 Tab 上
  - 页面加载后自动跳转到其他路由
- **修复**: 统一 Tab 状态管理，确保 active/selected 状态原子更新

### M-03 | 导航布局不一致（侧边栏 vs 底部 Tab）

- **Nielsen**: H4 一致性 + H6 识别非回忆
- **页面**: Desktop 整体导航
- **现状**: Wiki Tab 用侧边栏导航，资料/问答 Tab 切换到底部 Tab 栏+顶部 Header
- **修复**: 桌面端统一使用侧边栏模式

### M-04 | 搜索输入触发页面崩溃 (Error Boundary)

- **Nielsen**: H7 灵活高效
- **页面**: 搜索功能 | Desktop
- **现状**: 某些情况下在搜索框输入文字会触发 JavaScript 错误，显示错误边界
- **修复**: 添加搜索逻辑的异常保护

### M-05 | 概念详情页 URL 直链 404

- **Nielsen**: H6 识别非回忆
- **页面**: `/concept/[id]` | Desktop
- **现状**: 某些交互路径产生 `/concept/c-seed-2` URL，但该路由不存在，返回 404
- **修复**: 为 `/concept/[id]` 添加路由页面，或确保 URL 与 overlay 状态同步

### M-06 | Spacing Token 使用率仅 1.2%

- **Nielsen**: H4 一致性
- **页面**: 全局 CSS
- **现状**: 定义了 9 级 spacing token 但 859 处 padding/margin 中仅 10 处(1.2%)使用
- **修复**: 批量替换 4px→`var(--space-2xs)`, 8px→`var(--space-sm)`, 12px→`var(--space-md)`, 16px→`var(--space-lg)`
- **文件**: `app/globals.css`

### M-07 | 硬编码 rgba() 颜色值 114+ 处

- **Nielsen**: H4 一致性
- **页面**: 全局 CSS
- **现状**: clay 系 23 次、深 clay 18 次、文字系 38 次、纯黑 35 次。暗色模式下这些值不会自动适配
- **修复**: 提取为语义变量如 `--clay-08`, `--ink-14`，并在 `.dark` 中提供覆盖
- **文件**: `app/globals.css`

### M-08 | border-radius 值碎片化 (11+ 种不同值)

- **Nielsen**: H4 一致性
- **页面**: 全局 CSS
- **现状**: 4px(20x), 6px(19x), 7.5px(24x), 8px(55x), 10px(27x), 12px(30x)... 7.5px 与 8px 视觉差异极小却混用
- **修复**: 定义 `--radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-full: 999px`，统一 7.5px→8px
- **对照 claude-design-style**: Anthropic 标准为 7.5px(按钮/输入)、8px(卡片)、12px(弹窗)

### M-09 | 媒体查询断点碎片化 (10+ 种)

- **Nielsen**: H4 一致性
- **页面**: 全局 CSS
- **现状**: 420px, 640px, 680px, 720px, 767px, 768px, 960px, 1023px, 1024px, 1440px，其中 720px(6x) 与 767px 功能重叠
- **修复**: 统一为 3-4 级标准断点: sm(640), md(768), lg(1024), xl(1440)

### M-10 | Transition 硬编码值未使用 motion token

- **Nielsen**: H4 一致性
- **页面**: 全局 CSS
- **现状**: 79 处硬编码 transition（`0.15s ease`, `200ms ease`, `300ms ease`），仅 34 处使用 `var(--motion-*)`
- **修复**: `150ms/120ms` → `var(--motion-duration-fast)`; `200ms/300ms` → `var(--motion-duration-base)`

### M-11 | 视口切换时 Tab 状态丢失

- **Nielsen**: H4 一致性
- **页面**: 主页 | Desktop→Tablet 切换
- **现状**: Desktop 下选中 Wiki Tab 后，resize 到 768px 时页面变成"问答"Tab
- **修复**: Tab 状态应在布局变化时持久化

### M-12 | Toast 系统在主页未挂载

- **Nielsen**: H1 系统状态可见性
- **页面**: 主页 `/` | Desktop + Mobile
- **现状**: DOM 中无 toast 容器元素（无 `role="status"` 或 `aria-live`），操作反馈可能丢失
- **修复**: 确认 `<Toast />` 组件在 layout 中始终渲染
- **文件**: `app/layout.tsx`, `components/Toast.tsx`

---

## 🟡 Minor 问题 (13)

### m-01 | Motion Token 冗余别名

- `--motion-fast` 和 `--motion-duration-fast` 指向同一值，且 `--ease-out`/`--ease-in-out` 定义了但从未引用
- **修复**: 删除冗余别名，保留一套命名

### m-02 | 17 个 CSS 变量定义但未使用 (dead tokens)

- `--border`, `--ease-in-out`, `--ease-out`, `--ink`, `--ink-soft`, `--leading-relaxed`, `--space-2xs`, `--space-3xl`, `--space-xs`, `--text-2xl`, `--text-xl` 等
- **修复**: 用于替换硬编码值，或清理未用定义

### m-03 | /sync 和 /review 使用独立 token 体系

- `--ops-surface`, `--ops-state-*`, `--ops-radius-*` 与全局 token 语义重复
- **修复**: 复用全局 token，仅在确需差异化时添加模块级 token

### m-04 | 术语不一致

- "活动" Tab 对应同步控制台；侧边栏在不同时刻显示"我的 Wiki"或"知识库"；底部 Tab "资料" vs 页面标题"资料档案"
- **修复**: 统一核心术语表

### m-05 | /sync 页面品牌 letter-spacing 不统一

- 同步控制台 kicker 用 `0.22em`，主页 kicker 用 `0.08em`
- **修复**: 统一为 `0.08em`

### m-06 | /review 页面 kicker 用 "COMPOUND OPS" 引入额外品牌变体

- **修复**: 去掉 "OPS" 后缀或改为子标题

### m-07 | 暗色模式下 Tab 指示器对比度不足

- 硬编码 `rgba(217, 119, 87, 0.08)` 未使用 `--brand-clay-soft`，暗色模式下偏暗
- **修复**: 在 `.dark` 中提亮 clay 辅助色

### m-08 | `/` 快捷键未绑定搜索聚焦

- 业界标准快捷键（GitHub、Notion）无效
- **修复**: 绑定 `/` 键到搜索框 focus

### m-09 | `?` 快捷键行为异常

- 不弹出帮助面板，反而切换到"活动"Tab
- **修复**: 实现 `?` 打开快捷键参考弹窗

### m-10 | 侧边栏图标按钮缺少 tooltip

- GitHub 同步、Obsidian 导入、设置等按钮仅图标无文字提示
- **修复**: 添加 tooltip（如 "从 GitHub 同步"）

### m-11 | 概念详情正文中链接与普通文本不易区分

- 链接的 ARIA 角色正确但视觉辨识度低
- **修复**: 增加 `text-decoration-color` 对比度，参考 claude-design-style: `rgba(20,20,19,0.3)` hover 时提升到 `0.6`

### m-12 | box-shadow 硬编码 30+ 处

- 定义了 `--shadow-sm/md/lg` 但大量使用自定义阴影值
- **修复**: 扩展 shadow token scale，统一替换

### m-13 | z-index 部分硬编码

- 低层 z-index (1, 2, 5, 10, 20, 30, 40) 无 token
- **修复**: 补充 `--z-above: 1; --z-sticky: 10; --z-dropdown: 40` 等

---

## 🔵 Enhancement 建议 (6)

### E-01 | 添加"最近访问"功能

- 命令面板和 Wiki 列表缺少最近浏览的概念/资料入口
- **建议**: 在命令面板顶部添加"最近访问"区域

### E-02 | 概念详情页添加面包屑导航

- 仅有"返回"按钮，无层级提示
- **建议**: 添加轻量面包屑 `Wiki > 分类 > 概念名`

### E-03 | 添加批量操作功能

- Wiki 概念列表缺少多选、批量标签等操作
- **建议**: 为高级用户提供批量操作入口

### E-04 | Recap 页面添加导航进度指示

- 仅右上角 "1/8" 文字，缺少更明显的进度指示
- **建议**: 添加小圆点指示器或进度条

### E-05 | 底部 Tab/侧边栏添加连接状态指示器

- 离线/在线状态仅通过 banner 和 toast 传达
- **建议**: 在常驻 UI 中添加小型连接状态图标(绿点/红点)

### E-06 | letter-spacing Token 化

- 使用了 15 种不同的值，无 token
- **建议**: 提取 `--tracking-tight/-normal/-wide/-widest`

---

## CSS 设计系统重构优先级

基于 claude-design-style 标准，推荐以下重构顺序：

### Phase 1: 消除技术债 (最高优先)

1. **合并 DESIGN SYSTEM OVERRIDES** — 将 !important 覆盖层的值合并回原始定义，使用 `@layer` 替代
2. **清理 dead tokens** — 删除未使用的 17 个变量或开始引用

### Phase 2: Token 化迁移 (高优先)

3. **font-size → var(--text-\*)** — 目标: 80%+ 使用率
4. **spacing → var(--space-\*)** — 目标: 60%+ 使用率
5. **border-radius → var(--radius-\*)** — 统一 7.5px/8px → 8px (claude-design-style: 7.5px 为按钮签名圆角)
6. **rgba() → CSS 变量** — 提取重复超过 3 次的值

### Phase 3: 统一规范 (中优先)

7. **断点标准化** — 合并为 sm/md/lg/xl 四级
8. **transition → var(--motion-\*)** — 统一动效 token
9. **shadow → var(--shadow-\*)** — 扩展并统一 shadow scale
10. **z-index → var(--z-\*)** — 补充低层 token

### Phase 4: 架构优化 (低优先)

11. **globals-critical.css 精简** — 仅保留首屏关键路径
12. **letter-spacing Token 化**
13. **Sub-page token 归并** — /sync, /review 的 `--ops-*` token 映射到全局

---

## 对照 Claude Design Style 标准的差异

| 标准项                         | 当前状态             | 差异               |
| ------------------------------ | -------------------- | ------------------ |
| 背景色 `#faf9f5`               | ✅ 完全一致          | —                  |
| 暗色背景 `#1a1a18`             | ✅ 完全一致          | —                  |
| 品牌色 clay `#d97757`          | ✅ 使用正确          | —                  |
| 按钮圆角 7.5px                 | ⚠️ 混用 7.5px 和 8px | 建议统一           |
| serif 阅读体 (Lora)            | ✅ 完全一致          | —                  |
| sans UI 体 (Inter)             | ✅ 完全一致          | —                  |
| body line-height 1.6           | ✅ 使用 1.7 (可接受) | —                  |
| 内容 max-width ~640px          | ✅ 完全一致          | —                  |
| 链接 color:inherit + underline | ⚠️ 链接辨识度不足    | 需增加下划线对比度 |
| 过渡 150-300ms                 | ⚠️ 大量硬编码        | 需迁移到 token     |
| 无渐变/无纯黑白                | ✅ 遵循              | —                  |
| ::selection clay 色            | ✅ 完全一致          | —                  |
| prefers-reduced-motion         | ✅ 完全一致          | —                  |

**总评**: 视觉设计层面已经非常接近 claude-design-style 标准（温暖文学感、排版品质优秀），主要差距在 **CSS 实现层面**——Token 定义齐全但使用率极低，需要一次系统性的代码迁移来将设计意图真正落地到代码中。

---

## 附录：表现优秀的方面

1. **暗色模式** — 温暖深色调(#1a1a18) + clay 亮度提升(#f0a183)，品牌一致性优秀
2. **概念详情页信息结构** — 标题→元数据→正文(serif)→引用→相关概念→版本历史，层次清晰
3. **双向链接系统** — 概念↔资料关联清晰可见，知识图谱导航优秀
4. **离线架构** — OfflineBanner + Toast 暂停通知 + TaskCenter paused-offline 状态，完整的离线体验
5. **触摸交互** — SwipeBack、PullToRefresh、haptic 反馈，原生感优秀
6. **无障碍基础** — ARIA 标签、焦点管理、键盘导航、reduced-motion、高对比度
7. **分类筛选** — 带计数的一级分类按钮，渐进式筛选直观
8. **错误恢复页** — 重试 + 回首页 + 复制 Sentry ID 三个操作选项，设计周到
9. **日期本地化** — "1 小时前"、"昨天" 相对时间格式良好
10. **性能优化** — 动态 import + Tab 预加载 + critical CSS + SW 缓存策略
