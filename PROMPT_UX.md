# Ralph UX Loop · Compound

> 你是 Compound 的 **UX/PWA 体验优化 ralph loop 执行器**。
> 每次被启动等于一轮迭代：从 UX 路线图里挑出下一个解锁的未完成任务，把它干完，验证，通过后提交并停止。

---

## 0. 权威源与边界

- 仓库：`compound`（Next.js 15 + better-sqlite3 + PWA）。
- 工作分支：永远 `main`，不开新分支，不开 PR；详见 `AGENTS.md`。
- 主计划：`docs/ralph-ux-loop-plan.md`。
- Checklist：`docs/ux-audit-checklist.md`。
- 循环路线图：`docs/plans/ralph-ux-loop.md`（本地 runtime 文件，已被 `.gitignore` 忽略）。
- 进度日志：`docs/plans/ralph-ux-progress.md`（本地 runtime 文件，已被 `.gitignore` 忽略）。
- 视觉 skill：`/root/compound/.claude/skills/claude-design-style/SKILL.md`。

如果本文件与 `docs/ralph-ux-loop-plan.md` 冲突，以主计划为准。

---

## 1. 启动序列

按顺序执行：

```bash
cat docs/ralph-ux-loop-plan.md
cat docs/ux-audit-checklist.md
cat AGENTS.md
cat PROMPT.md
cat /root/compound/.claude/skills/claude-design-style/SKILL.md
ls PROMPT_UX.md docs/plans/ralph-ux-loop.md docs/plans/ralph-ux-progress.md
git rev-parse --abbrev-ref HEAD
git status
```

- 任一 runtime 三件套不存在时，当前轮就是 `U0.6`。
- 当前分支必须是 `main`；若不是，先 `git checkout main`。
- 工作区必须干净；若不干净，停止并报告。
- 在 `docs/plans/ralph-ux-loop.md` 的 `## 进度索引` 找第一个 `[ ]`，并遵守阶段门槛。
- 输出：

```text
===== UX-LOOP ROUND <n> START: <task-id> =====
```

---

## 2. 阶段门槛

```text
阶段 0 (U0.x) 基础设施       任意时刻可挑，最先做
阶段 1 (U1.x) 全局横切       U0 全 [x] 才解锁
阶段 2 (U2.x) 主路径巡检     U1 完成 >= 70% 才解锁
阶段 3 (U3.x) 跨页验收       U2 完成 >= 80% 才解锁
```

同阶段内严格按编号顺序拣选。被 `[!]` 阻塞的卡跳过下一张。百分比按该阶段 `[x]` 数 / 该阶段总卡数计算。

---

## 3. 每轮 11 步

1. `PICK`：在 `docs/plans/ralph-ux-loop.md` 的 `## 进度索引` 找下一个 `[ ]`，遵守阶段门槛。
2. `SCOPE`：只动该卡文件锚点列出的文件。
3. `AUDIT`：对 U2/U3 surface 先跑 `npm run audit:ux -- --page=<id>`；U0 基础设施卡可按主计划跳过 surface audit。
4. `ANALYZE`：从 audit 报告挑 <= 5 个最严重问题。
5. `DESIGN`：视觉、排版、微交互问题调用 `claude-design-style`，只给 token 级建议。
6. `PATCH`：最小改动，保留现有命名、架构和设计语言。
7. `VERIFY`：运行本文件 §4 的命令，任何必需命令失败都不准 commit。
8. `COMMIT`：在 `main` 直接提交，格式见 §5。
9. `PUSH`：`git push origin main`。
10. `RECORD`：把任务 `[ ]` 改 `[x]`，在进度日志追加一行。
11. `STOP`：停止，不继续下一张卡。

---

## 4. VERIFY 命令

必跑：

```bash
npm run typecheck
npm run test
npm run audit:ux -- --page=<id>
```

说明：

- U0.x 非 surface 基础设施卡如果当前仓库还没有 `audit:ux` 能力，以任务 acceptance 为准；不能伪造 audit 结果。
- U2.x 的 `<id>` 必须使用当前 surface 对应的 registry id。

条件跑：

```bash
npm run build
npm run docs:api
npm run audit:ux -- --page=<id> --update-baseline
```

- 改了 `app/layout.tsx`、`next.config.mjs`、`public/sw.js`、`middleware.ts` 时跑 `npm run build`。
- 改了 `app/api/**` 或 API 文档生成器时跑 `npm run docs:api`。
- 视觉 diff > 1% 时必须更新 baseline，并在 commit body 解释原因。

通过门槛：

- Lighthouse PWA / a11y / best-practices 三项 >= 90。
- axe critical/serious = 0。
- 视觉 diff < 1%，或显式更新 baseline 并说明。

---

## 5. Commit 格式

```text
<type>(<scope>): <task-id> <summary>
```

- `type`：`feat | fix | refactor | test | perf | docs | chore | ci | build`。
- `scope`：`ux | pwa | a11y | motion | sync-ui | wiki | library | sources | ask | settings | review | recap | activity | health | onboarding`。
- 示例：`feat(ux): U2.03 polish SourcesView empty and contrast states`。

commit 前必跑并检查：

```bash
git diff --cached --stat
git diff --cached | rg -i 'sk-[a-z0-9]{16,}|bearer\s+[a-z0-9._-]{16,}|ghp_[a-z0-9]{20,}|api[_-]?key' || true
```

不得把 `tmp/ux-audit/**`、`playwright-report/**`、`tests/e2e/visual/diff/**`、`docs/plans/**`、密钥、token、API key 放进 commit。

---

## 6. 防漂移硬约束

- 一卡 = 一个 surface = 一个 commit；U0/U1 基础卡也必须一张一卡。
- 不许新增、删除、修改 design token；只有 `U1.5` 和 `U1.8` 可追加指定变量。
- 不许改变设计语言：保持米色 `#faf9f5`、橘红 `#c96442` / `#d97757`、Lora / Noto Serif SC。
- 不许跳 VERIFY 或用“看起来差不多”替代实际命令。
- 不许把顺手优化塞进当前卡；写入 backlog。
- 不许改 `.env*` 或把真实凭据写入代码、文档、提交信息、测试快照。
- 不许新建分支或开 PR，除非用户明确要求。

---

## 7. RECORD 格式

完成单卡后：

- `docs/plans/ralph-ux-loop.md`：把该任务 `[ ]` 改 `[x]`。
- `docs/plans/ralph-ux-progress.md`：在 `## Rounds` 下追加：

```text
<ISO 时间> | <task-id> | <commit-hash> | LH<PWA/A11y/BP> | axe<crit/serious> | diff<%>
```

U0 非 surface 卡可将 Lighthouse / axe / diff 记录为 `n/a`，并在备注写明按主计划基础设施 acceptance 验证。

---

## 8. 停止条件

- 所有任务都是 `[x]` 或 `[!]`。
- 同一卡连续 3 次 verify 失败。
- `git push` 失败累计 >= 2 次。
- 单轮超过 30 分钟。
- 出现安全相关误改。
- 用户要求停止。

停止时最后一句必须是：

```text
===== UX-LOOP STOPPED =====
原因: <一句话>
最近 commit: <短 hash>
未完成: <剩余 [ ] 任务编号列表>
```
