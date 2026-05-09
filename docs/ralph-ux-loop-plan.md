# 拉尔夫循环 · UX/PWA 体验优化版 · 主计划

> 本文件是 UX 专项 ralph 循环的**唯一权威源**。所有执行 agent 必须以此文件为准；
> 任何与 `PROMPT.md` 冲突的部分，本计划只覆盖 `PROMPT.md` §1 第 8 步（STOP → 进入下一轮）和 §2 阶段门槛（替换为本文件 §3）。

最后更新：2026-05-09 · 适用对象：任何具备文件编辑、shell、Playwright/Lighthouse 调用能力的 coding agent。

---

## 1. 目标（终态）

跑完整轮循环后，应用必须达到：

- 22 个 surface（见 §4 阶段 2）每个：
  - Lighthouse PWA / a11y / best-practices 三项分数全部 ≥ 90
  - axe-core (`wcag2a/wcag2aa/wcag21a/wcag21aa`) 0 critical/serious 违规
  - Mobile（375×667）+ Desktop（1280×800）视觉快照 baseline 已建立
- 全局横切（U1.x）落地：PWA manifest / SW 升级 / offline / focus-visible / motion 收敛 / error 边界 / iOS splash 都达标
- 5 条端到端用户故事（首次进入 / 断网编辑后联网 / 安装到桌面 / 1k 概念渲染 / 慢网答题）走查 + 录屏，全部不出戏
- 设计语言保持现有米色（`#faf9f5`）+ 橘红（`#c96442` / `#d97757`）+ Lora/Noto Serif SC，**严禁改 token**

---

## 2. 已对齐的关键决策

| 项             | 决策                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 循环组织       | **独立 UX 循环**：新 `PROMPT_UX.md` + `docs/plans/ralph-ux-loop.md` + `docs/plans/ralph-ux-progress.md`，与现有 ralph 互不干扰 |
| Design skill   | 本机 `/root/compound/.claude/skills/claude-design-style/`（warm minimalism，token 已与项目对齐）                               |
| 改造程度       | **严格增量**：保留现有视觉语言；不许新增/删除/改 design token；只许把现有 token 用对位置                                       |
| 验证手段       | **全套**：Lighthouse + axe + Playwright 视觉快照基线（mobile + desktop），diff > 1% 必须显式更新基线                           |
| 工作分支       | 永远 `main`，不开 PR/分支（沿用 `AGENTS.md`）                                                                                  |
| Commit 格式    | `feat(ux): U2.03 polish SourcesView empty/error/contrast`                                                                      |
| commit 后 push | 完成单卡后自动 `git push origin main`                                                                                          |

---

## 3. 阶段门槛（PICK 时必须遵守）

```
阶段 0 (U0.x) — 基础设施              任意时刻可挑（最先做）
阶段 1 (U1.x) — 全局横切              U0 全 [x] 才解锁
阶段 2 (U2.x) — 主路径页面巡检        U1 完成 ≥ 70% 才解锁
阶段 3 (U3.x) — 跨页验收              U2 完成 ≥ 80% 才解锁
```

同阶段内**严格按编号顺序**拣选。被 `[!]` 阻塞的卡跳过下一张。

百分比 = 该阶段 `[x]` 数 / 该阶段总卡数。

---

## 4. 任务卡（U0~U3.x）

> 每张卡列出：标题、文件锚点（只能动这些文件）、acceptance（VERIFY 通过的具体表现）。
> 一张卡 = 一个 commit。一个 surface = 一张卡。严禁合并。

### 阶段 0 · 基础设施

#### U0.1 接入 Lighthouse + axe 阈值常量

- 文件锚点：`package.json`、`scripts/audit-page.mjs`（新建）、`tests/e2e/lighthouse.spec.ts`（新建）
- 动作：
  - `npm i -D lighthouse chrome-launcher`（已装 axe）
  - 在 `scripts/audit-page.mjs` 顶部 export 阈值常量：`MIN_PWA = 90`、`MIN_A11Y = 90`、`MIN_BEST_PRACTICES = 90`、`VISUAL_DIFF_TOLERANCE = 0.01`
- Acceptance：`npm run typecheck && npm run test` 通过；新建脚本可手动 dry-run（无报错即可）

#### U0.2 写 audit:ux 巡检脚手架

- 文件锚点：`scripts/audit-page.mjs`（继续填充）、`package.json`（添加 script）
- 动作：
  - `audit-page.mjs` 接受 `--page=<id>` 参数，从 `surface registry`（脚本顶部 const 字典）查 URL/触发动作
  - 启动 dev server（或 `playwright.webServer` 复用），用 puppeteer/chrome-launcher 跑 Lighthouse desktop + mobile，输出 JSON 到 `tmp/ux-audit/<id>-lighthouse.json`
  - 用 `@axe-core/playwright` 跑全规则，输出到 `tmp/ux-audit/<id>-axe.json`
  - 用 Playwright 截图 `mobile (375×667)` + `desktop (1280×800)` 两张，存到 `tests/e2e/visual/<id>-{mobile,desktop}.png`，与 baseline diff
  - `package.json` 加 `"audit:ux": "node scripts/audit-page.mjs"`
- Acceptance：`npm run audit:ux -- --page=wiki` 跑通并输出报告；脚本 exit 0 当且仅当三个门槛都过

#### U0.3 视觉快照 baseline 全量捕获

- 文件锚点：`tests/e2e/visual/`（新建目录）、`playwright.config.ts`（新增 `expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } }`）、`.gitignore`（追加 `tests/e2e/visual/diff/`）
- 动作：
  - 对 §4.2 列出的 22 个 surface 全部跑 `audit:ux` 一遍，把当下 mobile/desktop 截图作为 baseline 入库
  - 生成 `tests/e2e/visual/README.md` 说明 baseline 更新流程
- Acceptance：`tests/e2e/visual/` 下 44 张 PNG（22×2）入库；后续 `audit:ux` 默认与这套 baseline diff

#### U0.4 写 7 维 audit checklist

- 文件锚点：`docs/ux-audit-checklist.md`（新建，已由本计划作者预先生成同目录文件可直接复用，必要时补充）
- 动作：把 `docs/ux-audit-checklist.md` 校对一遍，结合 surface 实际情况补特例
- Acceptance：每条规范一句话；`audit-page.mjs` 报告里 axe rule id 能对应到 checklist 条目

#### U0.5 .gitignore + 文档收尾

- 文件锚点：`.gitignore`、`docs/ux-audit-checklist.md`
- 动作：
  - `.gitignore` 追加 `tmp/ux-audit/`、`tests/e2e/visual/diff/`、`tests/e2e/visual/__diff_output__/`
  - 确认 `docs/plans/` 仍 gitignore（已是）
- Acceptance：`git status` 不会出现 audit 报告残留

#### U0.6 三件套 runtime 文件

- 文件锚点：`PROMPT_UX.md`（新建，根目录）、`docs/plans/ralph-ux-loop.md`（新建，gitignore 内）、`docs/plans/ralph-ux-progress.md`（新建，gitignore 内）
- 动作：
  - `PROMPT_UX.md`：基于 `PROMPT.md` 改造，把 §1 第 4 步 VERIFY 命令换成 §6 列出的 5 条；把 §2 阶段门槛换成本计划 §3；commit message scope 收敛到 `ux | pwa | a11y | motion | sync-ui | wiki | library | sources | ask | settings | review | recap | activity | health | onboarding`
  - `ralph-ux-loop.md`：把本计划 §4 全部任务卡 + §10 backlog 复制进去，加 `## 进度索引` 表（U0.1~U3.4 全 `[ ]`）
  - `ralph-ux-progress.md`：写头部说明 + 空 `## Rounds` 节
- Acceptance：三件套都创建；`cat PROMPT_UX.md` 能跑通"循环规则源"角色

> **基础设施 6 张做完才解锁阶段 1。**

---

### 阶段 1 · 全局横切

> 一改全身改，必须在阶段 2 之前完成；否则后续逐页修复时反复返工。

#### U1.1 PWA manifest 修订

- 文件锚点：`public/manifest.json`、`app/layout.tsx`（必要时补 `meta`）
- 动作：补 `screenshots`（mobile + desktop 各 1 张）、`launch_handler: { client_mode: "auto" }`、`display_override: ["standalone","minimal-ui","browser"]`、`shortcuts` 中的 `id`、确认 `lang` 与 `description`、补 `iarc_rating_id`（可选）
- Acceptance：Chrome DevTools Application → Manifest 0 warning；Lighthouse PWA 分 ≥ 90

#### U1.2 Service Worker 升级策略

- 文件锚点：`public/sw.js`、`components/ServiceWorkerRegister.tsx`、`next.config.mjs`（注入 build id）
- 动作：cache name 拼上 `process.env.NEXT_PUBLIC_BUILD_ID`；新版上线时 SW 走 `installing → waiting`，前端 `ServiceWorkerRegister` 监听 `controllerchange` + `updatefound`，浮一个非阻塞横幅"新版本可用 · 刷新使用"，用户点击才 `skipWaiting()`
- Acceptance：本地手动 bump build id 后能看到横幅；横幅可关闭；`npm run build` 通过

#### U1.3 重写 /offline 页 UI

- 文件锚点：`app/offline/page.tsx`、`app/offline/offline.css`（如需）
- 动作：用 design skill `references/states.md` 风格重写：米色背景 + 橘红 accent + 一段文学化文案 + "重试" 按钮（点击重新 fetch `/`）+ "查看本地缓存的 wiki" 链接
- Acceptance：`npm run build` 通过；手动断网 + 直接访问 `/offline` 视觉满足 design skill 风格；axe 0 critical

#### U1.4 全局 focus-visible / 减弱动效 / 高对比

- 文件锚点：`app/globals.css`（仅追加，不重写）、`app/globals-critical.css`
- 动作：补 `:focus-visible` 通用规则（橘红描边 2px + 轻微 box-shadow）；补 `@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important } }`；补 `@media (prefers-contrast: more)` 的对比度兜底
- Acceptance：`Tab` 键巡查所有 surface 都有可见焦点；axe 关于 `focus-visible-without-outline` 0 违规

#### U1.5 motion token 收敛

- 文件锚点：`app/globals.css`（仅 `:root` 追加 token；不允许改既有 token）
- 动作：在 `:root` 追加 `--motion-fast: 150ms`、`--motion-base: 200ms`、`--motion-slow: 300ms`、`--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`、`--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)`；本卡只新增 token，不改任何使用方
- Acceptance：grep 现有 `transition: 0.2s` 等硬编码值 → 列表写到 backlog（不本卡修）；token 落地

#### U1.6 错误边界统一

- 文件锚点：`app/global-error.tsx`、`app/error.tsx`（如不存在则新建）
- 动作：统一布局：标题（错误码 + 一句人话）+ 操作按钮（重试 / 回首页 / 复制错误 ID）+ Sentry 上报状态；保持米色背景
- Acceptance：手动触发 error 看到一致 UI；axe 0 critical

#### U1.7 iOS PWA splash + meta

- 文件锚点：`app/layout.tsx`、`public/icons/`（补 splash）
- 动作：用 `next-pwa-splash-screens` 思路或手工生成主流分辨率（1170×2532 / 1284×2778 / 1179×2556 / 1290×2796 / 1488×2266 / 2048×2732 等）的 `apple-touch-startup-image`，加 `<link rel="apple-touch-startup-image" media="..." />`
- Acceptance：iOS PWA 启动有 splash；HTML head 有对应 link

#### U1.8 z-index / 遮罩透明度统一

- 文件锚点：`app/globals.css`（仅追加变量）+ 所有 modal/drawer/toast 各自 css
- 动作：在 `:root` 追加 `--z-toast: 100`、`--z-task-center: 200`、`--z-modal: 300`、`--z-command-palette: 400`、`--z-tooltip: 500`；所有 modal/drawer 遮罩用 `rgba(0,0,0,0.4)` 统一
- Acceptance：grep 硬编码 `z-index:` 全部替换为变量；交叉打开多个 layer（toast+modal+command palette）层级正确

> **U1 完成 ≥ 70%（≥ 6/8）才解锁阶段 2。**

---

### 阶段 2 · 主路径页面巡检（每张卡 = 1 surface = 1 commit）

> 每张卡的执行流程：跑 audit → 列 ≤5 个最严重问题（影响最广的优先）→ 调用 design skill → patch → VERIFY 全过 → commit。
> **其余发现一律写 backlog**，不许塞进当前卡。

| 卡    | Surface                              | 入口                     | 重点关注                                      |
| ----- | ------------------------------------ | ------------------------ | --------------------------------------------- |
| U2.01 | WikiView                             | `/`（默认 tab）          | 空态 / "刚更新"分组 / 滚动恢复                |
| U2.02 | LibraryView                          | `/`（library tab）       | 二级 chip / 分页加载 / 滚动锚点               |
| U2.03 | SourcesView                          | `/`（sources tab）       | 列表骨架卡差异化 / N+1 已修但 UI 仍要打磨     |
| U2.04 | AskView                              | `/`（ask tab）           | 输入区 / mention 触发 / 自动滚底逻辑          |
| U2.05 | ConceptDetail                        | 任一 concept 卡进入      | 选区气泡 / 桌面双栏 / 大段 markdown 渲染      |
| U2.06 | SourceDetail                         | 任一 source 进入         | contentEditable 编辑器 / 选区气泡 / 草稿提示  |
| U2.07 | ActivityView                         | `/`（activity tab）      | 时间轴 / 空态 / 加载更多                      |
| U2.08 | RecapView                            | `/recap`                 | 卡片左右滑 / 拖动中 pointer-events / 角度阈值 |
| U2.09 | HealthView                           | `/`（settings → health） | 大量数据图表 / 慢网降级                       |
| U2.10 | SettingsDrawer · GeneralTab          | 顶栏齿轮                 | 字号/行距交互 / segmented control aria        |
| U2.11 | SettingsDrawer · DataTab             | 同上                     | 危险操作二次确认 / 进度反馈                   |
| U2.12 | SettingsDrawer · ModelTab            | 同上                     | API key 输入 / 凭据存储提示 / 模型切换流      |
| U2.13 | IngestModal                          | TabBar 中间 +            | Escape 关闭 / 长任务推送到 TaskCenter         |
| U2.14 | GithubSyncModal                      | settings → 数据          | 分步流程 / 错误恢复 / 凭据脱敏                |
| U2.15 | ObsidianImportModal                  | settings → 数据          | 文件选择 / 进度 / 大体积低内存                |
| U2.16 | OnboardingCard                       | 空库自动弹               | 三选一 / 跳过 / 二次进入                      |
| U2.17 | CommandPalette                       | `Cmd/Ctrl+K`             | 模糊搜索 / 最近使用 / 键盘流                  |
| U2.18 | Header / TabBar / TaskCenter / Toast | 全局组件统一巡检（一卡） | 一致的圆角 / 阴影 / 焦点 / motion             |
| U2.19 | /sync (SyncDashboard)                | `/sync`                  | DLQ 操作 / webhook 历史 / Drawer 滚动         |
| U2.20 | /review (ReviewQueue)                | `/review`                | 决策卡片 / 键盘流 / 撤销                      |
| U2.21 | /offline                             | `/offline`               | 视觉一致性 / 重试按钮可达性                   |

每张卡的 commit message：`feat(ux): U2.0X polish <Surface> <one-line summary>`

> **U2 完成 ≥ 80%（≥ 17/21）才解锁阶段 3。**

---

### 阶段 3 · 跨页验收

#### U3.1 全应用 Lighthouse 跨页扫描

- 动作：写 `scripts/audit-all.mjs`，遍历 surface registry 跑 lighthouse mobile + desktop，输出汇总 markdown 表到 `tmp/ux-audit/lighthouse-summary.md`；任何 < 90 的进 follow-up 列表
- Acceptance：summary 表全部 ≥ 90，否则把不达标的 surface 写到 `ralph-ux-loop.md` 的 `## Re-entry` 节，回到阶段 2 继续磨

#### U3.2 全应用 axe 跨页扫描

- 动作：同上做法，跑 axe，输出汇总
- Acceptance：0 critical/serious

#### U3.3 5 条用户故事 e2e + 录屏

- 故事清单：
  1. 首次进入（空库 → onboarding → 选示例 → 看到 wiki）
  2. 断网编辑后联网（写 note → 切飞行模式 → 编辑 → 联网 → 同步）
  3. 安装到桌面（A2HS 触发 → 安装 → 启动 splash）
  4. 1k 概念渲染（seed 1k → 滚动 / 搜索 / 切 tab 流畅度）
  5. 慢网（slow 3G）答题
- 文件锚点：`tests/e2e/stories/*.spec.ts`、Playwright trace 录屏
- Acceptance：5 条全部 pass；trace 文件保存到 `tmp/ux-audit/stories/`

#### U3.4 Final summary

- 文件锚点：`docs/plans/ralph-ux-progress.md`
- 动作：写 `## Final summary`：baseline / final 的 22 surface × 3 项分数对比表，总耗时，blocked 卡列表，未来 backlog
- Acceptance：summary 写完即终止整个循环

---

## 5. 每轮（每张卡）必须执行的循环

```
1. PICK     在 docs/plans/ralph-ux-loop.md 的 ## 进度索引找下一个 [ ]，遵守阶段门槛
2. SCOPE    只动该卡"文件锚点"列出的文件
3. AUDIT    npm run audit:ux -- --page=<id>（U0.x 卡可跳过）
4. ANALYZE  从 audit 报告挑 ≤ 5 个最严重问题（影响最广 + 实现成本最低优先）
5. DESIGN   视觉/排版/微交互问题 → 调用 Skill: claude-design-style，让它根据当前 surface
            特征给出 token 级建议；严禁新增/改 token，只许把现有 token 用对位置
6. PATCH    最小改动；保留现有命名/风格（参 AGENTS.md 命名表）
7. VERIFY   必跑：
              ✓ npm run typecheck
              ✓ npm run test
              ✓ npm run audit:ux -- --page=<id>
                 - Lighthouse PWA/a11y/best-practices 三项全 ≥ 90
                 - axe 0 critical/serious
                 - 视觉 diff < 1%（>1% 必须 --update-baseline 并在 commit body 解释）
            条件跑：
              ✓ 改了 layout.tsx / next.config.mjs / sw.js / middleware.ts → npm run build
              ✓ 改了 app/api/** → npm run docs:api（本循环很少触发）
8. COMMIT   feat(ux): UX.X <一句话 ≤ 72 字符>
9. PUSH     git push origin main
10. RECORD  ralph-ux-loop.md 把该任务 [ ] 改 [x]
            ralph-ux-progress.md 末尾追一行：<ISO 时间> | <task-id> | <commit-hash> | <Lighthouse 三项分数> | <axe critical/serious 数> | <视觉 diff %>
11. STOP    本轮结束。绝不继续下一卡。
```

`STOP` 之后由外部调度（人 / Codex `/goal` / Claude `/loop`）触发下一轮。
若使用 `PROMPT_UX_GOAL.md`（本计划暂不要求生成）则按 `PROMPT_GOAL.md §2 轮次切换协议` 自动进入下一轮。

---

## 6. VERIFY 命令清单

```bash
# 必跑
npm run typecheck
npm run test
npm run audit:ux -- --page=<id>          # 对应当前卡的 surface

# 条件跑
npm run build                             # 改了 next.config.mjs / layout.tsx / sw.js / middleware.ts
npm run docs:api                          # 改了 app/api/**

# baseline 更新（视觉 diff > 1% 时）
npm run audit:ux -- --page=<id> --update-baseline
```

任一不过都不准 commit。看见绿勾才算过。

---

## 7. 防漂移硬约束（本循环特有）

1. 一卡 = 一个 surface = 一个 commit。不准借机改其他页。
2. **不许新增 / 删除 / 改 design token**（CSS variable）。只许把现有 token 用对位置。U1.5/U1.8 是仅有的例外（追加而非修改）。
3. 不许改 design philosophy（米色 + 橘红 + Lora）。
4. 不许跳 VERIFY，特别是 Lighthouse 分数门槛。"看起来过了"立即停。
5. 视觉 diff > 1% 必须 `--update-baseline` 并在 commit body 解释为什么变。
6. 不许把 axe critical/serious 用 `[!]` escape——要么修，要么拆 follow-up 卡。
7. 不许改 `PROMPT_UX.md` / `ralph-ux-loop.md` 自己（除非任务卡显式说"修订循环规约"）。
8. 不许在 main 之外的分支跑（沿用 `AGENTS.md`）。
9. commit 前必跑 `git diff --cached --stat` + `git diff --cached | rg -i 'sk-[a-z0-9]{16,}|bearer\s+[a-z0-9._-]{16,}|ghp_[a-z0-9]{20,}|api[_-]?key' || true`，禁止泄漏。
10. 不许让 `tmp/ux-audit/**`、`playwright-report/**`、`tests/e2e/visual/diff/**`、`docs/plans/**` 进 commit。
11. 不许把"顺手优化"塞进当前卡——记 `## Backlog`，下一轮自己来。

---

## 8. 终止条件

| 触发                                                          | 动作                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| 所有任务都是 `[x]` 或 `[!]`                                   | 在 `ralph-ux-progress.md` 写 `## Final summary` → STOP           |
| 同一卡连续 3 次 verify 失败                                   | 标 `[!]`、移到 `## Blocked`、写 follow-up 到 `## Backlog` → STOP |
| `git push` 失败累计 ≥ 2 次                                    | STOP（远端可能在拒绝；继续刷只会越积越多）                       |
| 单轮 > 30 分钟（含验证）                                      | 标该卡 `[!]` 写"粒度过大需拆分" follow-up → STOP                 |
| 安全相关误改（token 泄漏 / SSRF 防护 / middleware / `.env*`） | `git reset --hard origin/main` → STOP                            |
| 用户喊"停止 ralph loop" / "stop"                              | 立即停，不要追问                                                 |

停止时最后一句必须是：

```
===== UX-LOOP STOPPED =====
原因: <一句话>
最近 commit: <短 hash>
未完成: <剩余 [ ] 任务编号列表>
```

---

## 9. 启动序列（agent 接到任务后必须按顺序执行）

```
1. cat docs/ralph-ux-loop-plan.md            # 本文件
2. cat docs/ux-audit-checklist.md
3. cat AGENTS.md                              # 仓库协作约定
4. ls PROMPT_UX.md docs/plans/ralph-ux-loop.md docs/plans/ralph-ux-progress.md
   - 任一不存在 → 当前卡是 U0.6（先把这三件套创建出来）
5. git rev-parse --abbrev-ref HEAD           # 必须 main，否则 STOP 报告
6. git status                                 # 必须 working tree clean
7. ralph-ux-loop.md 的 ## 进度索引找第一个 [ ]
8. 输出: ===== UX-LOOP ROUND <n> START: <task-id> =====
9. 进入 §5 循环步骤
```

---

## 10. 不在本循环范围（提前列出来防漂移）

- `app/globals.css` 271KB 瘦身（涉及多页 reflow，独立排期）
- 暗色模式 micro-tuning（不在本循环 token 范围）
- i18n 全套国际化（独立循环 / 独立排期）
- 新富文本编辑器接入（已 partial 完成，独立大卡）
- 列表全面虚拟化 react-window（已 partial 完成，独立大卡）
- 把 lucide-react 换成 Phosphor / Heroicons
- 把 CSS 动画全部换成 framer-motion / Motion
- 设计系统重构（token 重写）

这些都进 `ralph-ux-loop.md` 的 `## Out of Scope` 节，循环结束后再决定要不要单独立项。

---

## 11. Surface registry（脚本和卡共用）

```ts
// scripts/audit-page.mjs 顶部
export const SURFACES = {
  wiki: {
    url: '/',
    setup: () => {
      /* default tab */
    },
  },
  library: { url: '/', setup: (page) => page.click('text=知识库') },
  sources: { url: '/', setup: (page) => page.click('text=资料') },
  ask: { url: '/', setup: (page) => page.click('text=问答') },
  conceptDetail: { url: '/', setup: (page) => page.click('.concept-card >> nth=0') },
  sourceDetail: {
    url: '/',
    setup: (page) => page.click('text=资料').then(() => page.click('.source-row >> nth=0')),
  },
  activity: { url: '/', setup: (page) => page.click('text=活动') },
  recap: { url: '/recap', setup: () => {} },
  health: {
    url: '/',
    setup: (page) => page.click('button[aria-label="设置"]').then(() => page.click('text=诊断')),
  },
  settingsGeneral: { url: '/', setup: (page) => page.click('button[aria-label="设置"]') },
  settingsData: {
    url: '/',
    setup: (page) => page.click('button[aria-label="设置"]').then(() => page.click('text=数据')),
  },
  settingsModel: {
    url: '/',
    setup: (page) => page.click('button[aria-label="设置"]').then(() => page.click('text=模型')),
  },
  ingestModal: { url: '/', setup: (page) => page.click('[aria-label="新增"]') },
  githubSync: {
    url: '/',
    setup: (page) =>
      page.click('button[aria-label="设置"]').then(() => page.click('text=GitHub 同步')),
  },
  obsidianImport: {
    url: '/',
    setup: (page) =>
      page.click('button[aria-label="设置"]').then(() => page.click('text=Obsidian 导入')),
  },
  onboarding: {
    url: '/',
    setup: (page) =>
      page.evaluate(() => localStorage.removeItem('compound_seeded')).then(() => page.reload()),
  },
  commandPalette: { url: '/', setup: (page) => page.keyboard.press('Meta+K') },
  globalShell: {
    url: '/',
    setup: () => {
      /* Header+TabBar+TaskCenter+Toast 共截一张 */
    },
  },
  sync: { url: '/sync', setup: () => {} },
  review: { url: '/review', setup: () => {} },
  offline: { url: '/offline', setup: () => {} },
};
```

字典是模板，agent 在 U0.2 实现时根据真实 selector 校准。
