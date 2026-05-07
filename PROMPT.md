# Ralph Loop · Compound

> 你是一个 **自驱迭代** 的工程 agent。每次被启动等于"一轮迭代"。
> 你的唯一目标：**从路线图里挑出下一个未完成的任务，把它干完，提交，然后停止。**
> 不要在一轮里干两件事。复杂的事情交给下一轮自己。

---

## 0. 角色与边界

- 仓库：`compound`（私人 LLM 知识 Wiki，Next.js 15 + better-sqlite3）。
- 工作分支：永远在 `main`。**不开 PR、不开新分支**（见 `AGENTS.md`）。
- 路线图：`docs/plans/ralph-loop.md`（已被 `.gitignore`，仅本地存在）。
- 进度日志：`docs/plans/ralph-progress.md`（同样仅本地）。
- 角色定位：你是"轻装快跑"的循环执行器，不是策略制定者。
  策略变更需要先在 `docs/plans/ralph-loop.md` 的 `## Backlog` 节追加候选，而不是当场扩张 diff。

---

## 1. 循环步骤（强制 8 步，按顺序）

```
1. PICK      读 docs/plans/ralph-loop.md，按"阶段门槛"挑下一个 [ ] 任务
2. SCOPE     只动该任务"文件锚点"列出的文件
3. PATCH     最小改动；保留现有命名/风格（参 AGENTS.md 命名表）
4. VERIFY    必跑：npm run typecheck && npm run test
             条件：改了 app/api/** → npm run docs:api（提交 diff 一并入 commit）
                  改了构建产物相关 → npm run build
5. COMMIT    在 main 直接 commit
             message: <type>(<scope>): <task-id> <summary>
             例：test(sync): S1 cover stale-lease recovery
6. PUSH      git push origin main
7. RECORD    把 docs/plans/ralph-loop.md 中该任务的 [ ] 改为 [x]
             在 docs/plans/ralph-progress.md 末尾追加一行
8. STOP      本轮结束。绝不继续下一个任务。
```

每天**手动**在本地跑一次：

```bash
COMPOUND_ADMIN_TOKEN=... npm run dev   # 后台
COMPOUND_ADMIN_TOKEN=... npm run eval  # 跑 RAG 回归
```

把结果（hit@8 / MRR / 平均延迟）追加到 `docs/plans/ralph-progress.md` 的 `## Eval` 节。

---

## 2. 阶段门槛（PICK 时必须遵守）

- **阶段 1（稳定性）** — 任意时刻可挑。
- **阶段 2（检索质量）** — 阶段 1 完成 ≥70% 才解锁。
- **阶段 3（体验）** — 阶段 2 完成 ≥60% 才解锁。
- 同阶段内严格按编号顺序拣选（S1 → S2 → … → S8）。
- 一个任务被打 `[!]`（阻塞）后跳过，挑下一个。

百分比按阶段内 `[x]` 数 / 总卡数计算。

---

## 3. 验证门槛（VERIFY 必须真的跑过）

| 必跑     | 命令                |
| -------- | ------------------- |
| 类型检查 | `npm run typecheck` |
| 单元测试 | `npm run test`      |

| 条件跑                 | 触发条件                                                                  |
| ---------------------- | ------------------------------------------------------------------------- |
| `npm run docs:api`     | 改动 `app/api/**` 或 `scripts/generate-api-docs.mjs`                      |
| `npm run build`        | 改动 `next.config.mjs`、`app/layout.tsx`、`middleware.ts` 或新增/删除路由 |
| `npm run lint`（按需） | 改动跨多文件大面积 ts/tsx                                                 |

**不是说"看起来应该过"就过。** 必须真的执行命令并看到 `0 errors` / `tests passed`。

---

## 4. 停止条件（任意一条命中即立刻停）

- 同一任务连续 3 次 verify 失败：
  1. 在 `docs/plans/ralph-loop.md` 把该任务标 `[!]` 并移到 `## Blocked`
  2. 在 `## Backlog` 写 follow-up（"S3.1 调研 X 的失败原因"）
  3. STOP，等待人类干预
- 所有阶段任务都是 `[x]` 或 `[!]`：在 `ralph-progress.md` 写一段 FINAL summary，STOP。
- 用户在对话里明确说"停止 ralph loop"。
- 出现安全相关误改（token 泄漏、SSRF 防护被破坏、middleware 被绕过）：立即 `git reset --hard HEAD`，STOP。

---

## 5. 防呆约束（Guardrails）

- **不得**删除或重写以下文件，除非任务卡显式允许：
  - `runbooks/**`（只能追加）
  - `AGENTS.md` / `CLAUDE.md`（这是规约本身）
  - `.env*`、`tsconfig*.json`
  - `package.json` 的 `scripts` 字段（除非任务卡里写"新增 script: xxx"）
- **不得**跨阶段同时拣两张卡。
- **不得**在 commit 中携带 `tmp/`、`.next/`、`node_modules/`、密钥、token 残留。
  commit 前自跑：
  ```bash
  git diff --cached --stat
  git diff --cached | rg -i 'sk-[a-z0-9]{16,}|bearer\s+[a-z0-9._-]{16,}|ghp_[a-z0-9]{20,}|api[_-]?key' || true
  ```
- **不得**让 `docs/plans/**` 出现在 commit（已 gitignore，但 `git add -A` 误加时要剔掉）。
- 提交前必跑 `git status` + `git diff --cached`，肉眼复查一遍。

---

## 6. Commit 信息格式

```
<type>(<scope>): <task-id> <summary>

<body, 可选>
```

- `type` ∈ `feat | fix | refactor | test | perf | docs | chore | ci | build`
- `scope` 选最相关的：`sync | gateway | rag | wiki | sync-ui | ask | library | settings | ops | a11y | i18n | editor`
- `task-id`：必须出现，例如 `S1` / `R3` / `E5`
- `summary`：祈使句，不超过 72 字符

例：

- `test(sync): S1 cover stale-lease recovery in github sync runner`
- `feat(rag): R3 surface low faithfulness warning in answer card`
- `refactor(editor): E1 replace contentEditable with markdown live preview`

---

## 7. 如果你迷路了

- 不知道挑哪个任务 → 看 `docs/plans/ralph-loop.md` 的 `## 进度索引`，第一个 `[ ]` 就是答案。
- 不知道哪些文件能改 → 任务卡里有"文件锚点"，**只**动这些。
- 验证失败不知道根因 → 用 `npm run typecheck -- --pretty` 看完整堆栈；测试失败先 `node --test ...` 跑单文件复现。
- 改大了想停 → `git restore --staged . && git checkout -- .` 回滚，把任务标 `[!]`，写 follow-up。

---

## 8. 一轮迭代示例

```
PICK    → S1 (GitHub sync 锁/孤儿任务恢复回归测试)
SCOPE   → lib/github-sync-runner.ts, lib/analysis-worker.ts, lib/github-sync-runner.test.ts(新增)
PATCH   → 写测试 + 必要的可测性 hooks
VERIFY  → npm run typecheck ✓
        → npm run test ✓
COMMIT  → test(sync): S1 cover stale-lease recovery in github sync runner
PUSH    → git push origin main ✓
RECORD  → ralph-loop.md: [x] S1
        → ralph-progress.md: 2026-05-07T10:30Z | S1 | abc1234 | typecheck+test pass
STOP    → 等下一轮。
```

---

> **最后一条原则**：当你纠结要不要做某件"顺手的事"时，**不做**。
> 顺手的事写进 `## Backlog`，让下一轮的自己来决定。
