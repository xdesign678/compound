# Ralph Loop · GOAL MODE

> 适配 Codex `/goal`、Claude `/loop`、Aider `--auto` 等"持续执行直到目标达成"的 agent。
> 与单轮模式的 `PROMPT.md` 互补：本文件让 agent **不停下来**，直到所有任务卡完成或触发终止条件。
>
> 启动命令示例：
>
> ```bash
> codex exec --full-auto --prompt-file PROMPT_GOAL.md
> ```

---

## 0. 你的目标

把 `docs/plans/ralph-loop.md` 里 22 张任务卡里所有 `[ ]` 推进到 `[x]` 或 `[!]`，
按"稳定 → 检索 → 体验"三阶段顺序，一次一卡，循环直到收敛。

完成所有任务前你不允许停下；但每张任务卡之间必须严格执行 §2 的"轮次切换协议"。
**速度不是目标，稳定才是。**

---

## 1. 规则源（仍然是 PROMPT.md）

`PROMPT.md`（仓库根）是规则源。本文件只覆盖**一处**：

- 把 `PROMPT.md §1 第 8 步` 的 `STOP 本轮结束。绝不继续下一个任务。`
  改成 `立即进入下一轮（执行 §2 轮次切换协议）`。

其余全部沿用：

- §0 角色与边界
- §1 前 7 步（PICK → SCOPE → PATCH → VERIFY → COMMIT → PUSH → RECORD）
- §2 阶段门槛（阶段 1 ≥70% 才解锁阶段 2；阶段 2 ≥60% 才解锁阶段 3；同阶段按编号顺序）
- §3 验证门槛（必跑 typecheck + test；条件跑 docs:api / build）
- §4 停止条件（连续 3 次 verify 失败 / 全部完成 / 安全误改 / 用户喊停）
- §5 防呆约束（不得改 runbooks / AGENTS.md / .env / scripts；不得跨阶段；不得让 docs/plans 进 commit）
- §6 commit 信息格式：`<type>(<scope>): <task-id> <summary>`
- §7 迷路自救
- §8 一轮迭代示例

如有冲突，本文件优先；其它一字不改。

---

## 2. 轮次切换协议（每完成一张卡必须按顺序执行）

```
1. 完成本卡的 PROMPT.md §1 第 1–7 步 (PICK → ... → RECORD)
2. 强制自检（依次输出，不要跳过）：
     - git log -1 --oneline                       # 确认 commit 落地
     - git status                                  # 必须 working tree clean
     - git rev-parse HEAD@{u} == HEAD              # 必须远端已同步
     - cat docs/plans/ralph-progress.md | tail -3  # 确认本轮记录追加成功
3. 输出明确分隔标记：
     ===== ROUND <n> DONE: <task-id> =====
4. 执行"上下文重置仪式"：
     a. 在心里清空对刚才那张卡的任何细节（不再保留实现思路）
     b. 重新 cat 以下三个文件，把规则与状态完全替换为最新版：
        - PROMPT.md
        - docs/plans/ralph-loop.md
        - docs/plans/ralph-progress.md
     c. 只保留"规则 + 当前状态"两类信息进入下一轮
5. 在 ralph-loop.md 的 ## 进度索引 表里找下一个 [ ] 任务（注意阶段门槛）
6. 输出明确分隔标记：
     ===== ROUND <n+1> START: <next-task-id> =====
7. 回到 PROMPT.md §1 第 1 步 (PICK)，开干
```

为什么要重读三件套：long session 里你的注意力会逐渐偏移。每轮强制 `cat` 一遍 = anti-drift。
不要因为"我刚才看过了"就跳过 —— 那正是漂移的开始。

---

## 3. 终止条件（任意一条命中立即停）

| 触发                                                                                | 动作                                                                                   |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ralph-loop.md` 里所有任务都是 `[x]` 或 `[!]`                                       | 在 `ralph-progress.md` 写 `## Final summary`（含完成卡数 / 阻塞卡数 / 总耗时估算），停 |
| 同一任务连续 3 次 VERIFY 失败                                                       | 标 `[!]` → 移到 `## Blocked` → 在 `## Backlog` 写 follow-up → 停                       |
| 累计 `git push` 失败 ≥ 2 次                                                         | 立即停（远端可能在拒绝；继续刷只会越积越多）                                           |
| 出现安全相关误改（token 泄漏 / SSRF 防护被破坏 / middleware 被绕过 / `.env*` 被改） | `git reset --hard origin/main` → 停                                                    |
| 单轮耗时 > 30 分钟（含验证）                                                        | 标该卡 `[!]` 写 follow-up "粒度过大需拆分"，停                                         |
| 用户在对话里说"停止 ralph loop" / "stop"                                            | 立即停，不要追问                                                                       |

停止时**最后一句输出必须是**：

```
===== RALPH LOOP STOPPED =====
原因: <一句话>
最近 commit: <短 hash>
未完成: <剩余 [ ] 任务编号列表>
```

---

## 4. 防漂移硬约束（最易违反，最易翻车）

1. **严禁合并多张卡到一次 commit**。一张卡 = 一个 commit。完成 S1 + 又顺手改了 S2 → 是错。
2. **严禁修改任务"文件锚点"之外的文件**。觉得有必要也不行——记 `## Backlog`。
3. **严禁跨阶段挑卡**。阶段 1 完成度未到 70% 不准动 R*；阶段 2 未到 60% 不准动 E*。
4. **严禁忽略 VERIFY**。"看起来应该过"不算过，必须真跑命令并看到 0 errors / pass。
5. **严禁让 `docs/plans/**`、`tmp/**`、`.next/**`进 commit**（已 gitignore，但`git add -A`时务必复查`git diff --cached --stat`）。
6. **严禁改 `PROMPT.md` 自己**（除非任务卡显式说"修订循环规约"）。
7. **严禁在 main 之外的分支工作**。永远 `git rev-parse --abbrev-ref HEAD` 检查。
8. **严禁因为"后续要用"就提前布置基础设施**。任务卡没要的不做。

发现自己马上要违反任意一条 → 停手 → 把那个想法记到 `## Backlog` 当一行文字 → 回到当前任务卡的最小路径。

---

## 5. 运行心态（重要）

- 你不是在写代码，你是在**驱动一台稳定运行的循环机**。
- 每张卡之间的"重读三件套" 不是仪式感，是工程纪律。
- 慢一点没关系。错一卡可能要回滚整轮，得不偿失。
- 看到诱人的"顺手优化" → 那就是漂移的味道 → 立刻收敛。
- 觉得规则烦 → 那是规则在保护你，正在生效。

---

## 6. 启动指令

收到本提示词后，**不要再问任何问题**，直接按以下顺序执行：

```
1. cat PROMPT.md
2. cat docs/plans/ralph-loop.md
3. cat docs/plans/ralph-progress.md
4. git rev-parse --abbrev-ref HEAD     # 必须返回 main
5. git status                          # 必须 working tree clean
6. 在 ralph-loop.md 的 ## 进度索引 找第一个 [ ] 任务
7. 输出: ===== ROUND 1 START: <task-id> =====
8. 进入 PROMPT.md §1 第 1 步 (PICK)
```

如果第 4/5 步不满足，**立即停**并报告，不要尝试自动 fix。

开始。
