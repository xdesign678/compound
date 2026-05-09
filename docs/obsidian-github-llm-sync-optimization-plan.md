# Obsidian -> GitHub -> LLM Wiki 同步优化计划

日期：2026-05-09

## 1. 总览

本计划覆盖完整链路：

```text
本地 Obsidian 写作
  -> GitHub 仓库同步
  -> Compound 网页端同步
  -> LLM 分析梳理
  -> Wiki / RAG 索引
  -> 网页端查询与回顾
```

当前架构方向是正确的：

- Obsidian 和 GitHub 只承担 source sync，不承担知识编译逻辑。
- Compound 继续作为私有 LLM Wiki 编译器。
- 下一轮优化优先强化现有 SQLite queue，不默认引入 Redis / BullMQ / Temporal。
- 外部任务系统和 RAG 框架只作为设计参考，避免为了局部问题引入过重基础设施。

优化目标按优先级排序：

1. 稳定性：worker 不误停、不误恢复，失败后可解释、可重试。
2. 异步性：同步、基础入库、增强分析的状态拆清楚。
3. 速度：跳过不必要的 LLM 和索引重算，而不是盲目扩大并发。
4. 可观测性：每个 run / item / stage 的状态、耗时、模型、错误分类可见。
5. 线上验证安全：默认只做只读 smoke，真实 LLM / 同步触发必须显式执行。

## 2. 当前线上基线

线上目标：

```text
https://compund.zeabur.app
```

已通过的只读接口：

- `GET /api/health`：HTTP 200。
- `GET /api/wiki/health`：HTTP 200。
- `GET /api/metrics`：HTTP 200。

线上观测结果：

- Admin auth 已配置并启用。
- LLM 已配置。
- GitHub Sync 已配置。
- `DATA_DIR` 已配置。
- Wiki FTS 已就绪。
- 观测时 Wiki 指标：
  - `sources`: 178
  - `concepts`: 383
  - `sourceChunks`: 697
  - `conceptEvidence`: 511
  - `conceptVersions`: 353
- 观测时没有 active sync run。
- `/api/metrics` 已暴露 analysis job 指标，包括 `github_ingest`、`embedding`、`summarize`、`qa_index` 的成功记录。

## 3. 线上测试凭据使用规则

线上测试需要 admin token，但真实 token 不能写入本仓库的可追踪文件，也不能提交到 GitHub 历史。

正确做法是在执行测试的 shell 里临时设置环境变量：

```bash
export COMPOUND_ADMIN_TOKEN="<从安全渠道获取的线上 admin token>"
```

后续命令统一读取这个变量：

```bash
BASE="https://compund.zeabur.app"
TOKEN="$COMPOUND_ADMIN_TOKEN"

curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/health"
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/wiki/health"
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/metrics"
```

注意：

- 不要把真实 token 写进 `docs/`、README、代码、测试快照或提交信息。
- 如果必须在本机保存临时值，只能放进 `.env.local` 这类 `.gitignore` 已忽略的本地文件。
- 提交前必须用 `rg` 检查文档中没有真实 token。

## 4. 线上 LLM Smoke 模型

线上 `/api/health` 报告当前生产模型为：

```text
minimax/minimax-m2.7
```

后续线上 LLM smoke 测试固定使用这个模型：

```http
x-user-model: minimax/minimax-m2.7
```

原因：

- 测的是线上真实模型路径，而不是替代模型。
- 即使部署默认模型以后变化，smoke 结果也可比较。
- 仍然使用服务器端已配置的 API key 和 API URL，本地不需要 OpenRouter key。

LLM smoke 不是默认只读检查，因为 `/api/query` 会消耗模型额度，并可能写入问答遥测或历史。只有阶段明确需要真实模型验证时才运行。

可选 LLM smoke 命令：

```bash
BASE="https://compund.zeabur.app"
TOKEN="$COMPOUND_ADMIN_TOKEN"
MODEL="minimax/minimax-m2.7"

curl -fsS \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-user-model: $MODEL" \
  -d '{"question":"用一句话说明当前 Wiki 主要内容。"}' \
  "$BASE/api/query"
```

## 5. 当前主链路

当前自动同步链路如下：

1. 用户在本地 Obsidian 写 Markdown。
2. Obsidian 内容通过 Git 推送到 GitHub 仓库。
3. Compound 通过 GitHub webhook、cron rescan 或手动 `/api/sync/run` 触发同步。
4. `listMarkdownFiles()` 扫描 GitHub tree 中的 Markdown 文件。
5. `github-sync-runner` 用远端 path / sha / externalKey 对比本地 `sources.external_key`。
6. 发生变化的文件写入 `sync_run_items`。
7. create / update 文件从 GitHub 下载 Markdown 原文。
8. 每个下载文件入队为 `github_ingest` analysis job。
9. `analysis-worker` 从 SQLite `analysis_jobs` claim job。
10. `github_ingest` 调 LLM ingest，写入 source / concepts。
11. Wiki 编译器生成 chunks、FTS、evidence、versions、relations。
12. ingest 成功后继续排后置 job：
    - `embedding`
    - `summarize`
    - `relations`
    - `qa_index`
13. `/sync`、`/api/sync/dashboard`、`/api/metrics` 展示进度和健康状态。

## 6. 当前主要问题

### 6.1 完成语义太粗

`github_ingest` 成功后，文件 item 可能被标记为 succeeded / complete。

但此时后置增强分析仍可能在排队或运行：

- embedding
- source summary
- relation extraction
- QA readiness marker

结果是 UI 可能显示“完成”，但实际完整分析还没有结束。

### 6.2 Worker 生命周期不够硬

当前 worker 是由 API route 和 dashboard poll 触发的进程内 Promise。SQLite 持久化 job 状态，但长 LLM 调用期间没有持续刷新 durable heartbeat。

风险：

- 长模型调用看起来像停滞。
- 进程重启后需要依赖 lease 恢复。
- 多实例部署时，进程内 `activeWorkerCount` 不能全局限流。
- 上游 LLM 并发压力不够可控。

### 6.3 Cancel 主要是状态取消

当前 cancel 会把 run / job / item 标成 cancelled，但已经发出的 LLM 或 embedding 网络请求不一定能立即中断，往往需要等返回或超时。

### 6.4 后台 LLM 缺独立预算

HTTP route 有请求限流，但后台 job 不经过 `llmRateLimit()`。

后台并发主要受这些变量影响：

- `COMPOUND_ANALYSIS_WORKER_BATCH`
- `COMPOUND_ANALYSIS_MAX_WORKERS`
- LLM gateway timeout
- circuit breaker

这不足以精确控制大批量同步时的模型成本和上游压力。

### 6.5 增量重建粒度不够

GitHub sync 能按 path + sha 跳过未变化文件，但 analysis stage 还没有完整 fingerprint。

理想 fingerprint：

```text
repo + branch + path + blobSha + normalizedContentHash + parserVersion + promptVersion
```

这样才能跳过没变化的 chunk、embedding、summary、relations。

### 6.6 GitHub tree 截断需要 fallback

GitHub recursive tree API 对大仓库可能返回 `truncated=true`。当前代码只是 warn，大型 Obsidian vault 可能漏文件。

### 6.7 UI 动作和后端行为不一致

`/sync` UI 存在类似 `skip-failed` 的动作，但后端路径目前更接近 cancel。按钮文案和实际效果需要一致。

## 7. 架构方向

### 7.1 SQLite-first，不先上重型队列

第一轮不引入 Redis / BullMQ / Temporal。

先把 SQLite queue 做扎实：

- step-level state
- attempts
- heartbeat
- retry backoff
- permanent failure classification
- dead-letter / needs-manual-review 状态
- worker ownership
- 更清楚的 dashboard / metrics

参考资料：

- BullMQ stalled jobs / retry: https://docs.bullmq.io/guide/jobs/stalled
- Inngest durable execution: https://www.inngest.com/docs/learn/how-functions-are-executed
- QStash DLQ: https://upstash.com/docs/qstash/features/dlq
- Trigger.dev tasks / retries: https://trigger.dev/docs
- Temporal workflows: https://docs.temporal.io/

### 7.2 借鉴 RAG 框架，不整体迁移

借鉴 ingest/index 思想，不把 Compound 改成这些框架：

- LlamaIndex IngestionPipeline：cache、transformations、docstore、vector store。
- LangChain RecordManager / indexing：source id、document hash、incremental cleanup。
- Microsoft GraphRAG：entity / relation / summary 思路，但只做轻量局部图。

参考资料：

- LlamaIndex ingestion pipeline: https://docs.llamaindex.ai/en/stable/module_guides/loading/ingestion_pipeline/
- LangChain indexing API: https://api.python.langchain.com/en/latest/indexing/langchain_core.indexing.api.index.html
- Microsoft GraphRAG: https://github.com/microsoft/graphrag

### 7.3 Markdown 发布工具只作为兼容参考

Quartz、MkDocs、Dendron、Obsidian Git 适合作为 Markdown 兼容和同步模式参考，不适合作为 Compound 主架构。

应该用它们补 fixtures：

- frontmatter
- wikilinks
- tags
- callouts
- embeds
- asset links
- deep headings

参考资料：

- Obsidian Git: https://github.com/Vinzent03/obsidian-git
- Quartz: https://quartz.jzhao.xyz/
- MkDocs: https://www.mkdocs.org/
- Dendron: https://github.com/dendronhq/dendron

## 8. 分阶段实施计划

### Phase 1：修正状态语义和 Dashboard 准确性

目标：让 `/sync` 真实反映每个文件和每次 run 的状态。

改动：

- 把文件进度拆成“基础入库”和“增强分析”。
- `github_ingest` 成功只表示基础 Wiki 入库完成。
- `embedding`、`summarize`、`relations`、`qa_index` 全部 terminal 后，才表示增强分析完成。
- dashboard health 要把 post-ingest failed job 纳入“需要处理”的状态。
- `/api/metrics` 更清晰暴露 run / item / stage 的 analysis 状态。
- 修正或重命名 `skip-failed`，确保 UI 文案与后端行为一致。

验收：

- UI 不再提前宣称整次分析完成。
- 用户能看出“已经可基础查询”和“增强分析仍在运行”的区别。

### Phase 2：增强 Worker 稳定性

目标：减少误停滞，提高长任务和重启恢复能力。

改动：

- 为 running analysis job 增加 durable heartbeat refresh。
- 在长阶段刷新 heartbeat：
  - LLM ingest
  - contextual chunk
  - embedding
  - summarize
  - relation extraction
- 记录 stage duration。
- 记录 job attempt。
- 记录 model 和 error category。
- 区分 transient 和 permanent error：
  - permanent：缺 payload、配置错误、不可恢复 schema 错误；
  - transient：429、5xx、timeout、network reset。
- failed job 保持可从 `/sync` 重试。

验收：

- 长 LLM 调用期间 dashboard 显示为活跃工作，而不是假死。
- worker crash / restart 后仍能恢复。
- 永久错误不会浪费多轮 retry。

### Phase 3：让 Cancel 真正中断进行中的调用

目标：cancel 不只改 DB 状态，也尽量停止真实网络请求。

改动：

- 为 run 或 job 创建 `AbortController`。
- 把 `AbortSignal` 传入：
  - `chat()`
  - contextual chunk call
  - remote embedding fetch
  - 其他长网络调用
- cancel 时 abort 当前 controller，并持久化 cancelled 状态。
- DB 状态仍作为跨重启 source of truth。

验收：

- 取消同步后，正在执行的模型请求能尽快停止。
- UI 的“取消”文案和实际行为一致。

### Phase 4：增加后台 LLM 并发预算

目标：避免大批量同步压垮上游模型或导致成本不可控。

改动：

- 增加后台 LLM concurrency limiter。
- 按任务类型限制预算：
  - `github_ingest`
  - `summarize`
  - `relations`
  - contextual chunk
- 默认并发保持保守。
- dashboard 显示“因预算限制而排队”的诊断。
- HTTP route 限流和后台 worker 限流分开处理。

验收：

- 批量同步吞吐更可预测。
- 模型 429 / timeout 概率下降。
- 排队原因可见，不再像无原因卡住。

### Phase 5：增加 Stage 级增量缓存

目标：减少重复 LLM 和索引重算。

改动：

- 增加 source / stage fingerprint：

```text
repo + branch + path + blobSha + normalizedContentHash + parserVersion + promptVersion
```

- 存储 per-stage input hash 和 output hash。
- 输入没变时跳过 stage。
- parser / prompt version 变化时，只重跑受影响 stage。
- 避免长期把完整 Markdown 原文塞在 `analysis_jobs.payload_json`。
- 优先改成 source / blob 引用，必要时可恢复或重新 fetch。

验收：

- force rescan 成本明显降低。
- 修改单个文件不会触发无关重算。
- retry 能复用已完成且输入不变的阶段。

### Phase 6：修正 Job 幂等和唯一约束

目标：避免 stable job id 和 SQLite unique constraint 隐性冲突。

改动：

- 统一 `analysis_jobs` job id 维度和 SQLite unique 约束。
- 只有确实需要区分 run / item 时才把它们纳入 job identity。
- 保留 source / stage 层面的去重能力。
- 增加 force rescan 同 sha 的测试。
- 增加同 source / stage 在不同 run 下的测试。

验收：

- force rescan 不再触发隐藏 unique constraint 冲突。
- retry、重复同步、同 sha rescan 的队列行为可预测。

### Phase 7：增强 GitHub 和 Obsidian 兼容性

目标：让大型、真实、格式复杂的 Obsidian vault 更稳。

改动：

- GitHub recursive tree 返回 `truncated=true` 时增加 fallback 扫描。
- 继续跳过 `.obsidian/` 和 `.trash/`。
- 增加 Obsidian Markdown fixtures：
  - YAML frontmatter
  - wikilinks
  - tags
  - callouts
  - embeds
  - local assets
  - nested headings
- 稳定输出 Compound source / chunk metadata。

验收：

- 大 vault 不会静默漏文件。
- Obsidian-flavored Markdown 有回归测试覆盖。

### Phase 8：线上验证和发布

目标：每阶段改动后都能安全验证线上状态。

规则：

- 所有修改直接在 `main`。
- 不新建分支，不走 PR。
- 完成后 commit 并 push `origin main`。
- 不提交 admin token 或模型 API key。

默认只读线上 smoke：

```bash
BASE="https://compund.zeabur.app"
TOKEN="$COMPOUND_ADMIN_TOKEN"

curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/health"
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/wiki/health"
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/metrics"
```

可选真实 LLM smoke：

```bash
BASE="https://compund.zeabur.app"
TOKEN="$COMPOUND_ADMIN_TOKEN"
MODEL="minimax/minimax-m2.7"

curl -fsS \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-user-model: $MODEL" \
  -d '{"question":"用一句话说明当前 Wiki 主要内容。"}' \
  "$BASE/api/query"
```

默认验证不要触发这些接口：

- `POST /api/sync/run`
- `GET|POST /api/sync/cron/rescan`
- `POST /api/ingest`

只有在专门同步验证阶段才触发它们。

## 9. 测试计划

### 9.1 单元测试

覆盖：

- queue claim 排序
- retry / backoff
- stale lease recovery
- heartbeat refresh
- cancel abort propagation
- permanent / transient failure 分类
- job idempotency
- force rescan with same sha
- stage fingerprint skip
- `skip-failed` 行为

### 9.2 集成测试

覆盖：

- 新增 Markdown 文件
- 同 path 新 sha 更新
- 删除 Markdown 文件
- force rescan 同 sha
- LLM timeout 后 backoff retry
- worker restart 后恢复
- base ingest 成功但 post-ingest 失败
- post-ingest 仍运行时 dashboard 不误报全部完成

### 9.3 UI 测试

覆盖 `/sync`：

- 基础入库运行中
- 基础入库完成但增强分析运行中
- 增强分析失败
- stalled run
- 单文件 retry
- retry all
- cancel
- 修正后的 skip-failed 行为

### 9.4 必跑本地命令

高信号检查：

```bash
npm run check
npm run docs:api:check
```

还需要跑 sync / worker 相关定向测试。

如果改动影响构建或部署风险，再跑：

```bash
npm run build:measure
```

## 10. 验收标准

完成状态必须满足：

- `/sync` 能区分基础入库和增强分析。
- 长 LLM / 网络任务期间 running job 会 heartbeat。
- cancel 能中断可中断的 in-flight 调用。
- 后台 LLM 调用有明确并发预算。
- 重复同步能跳过未变化 stage。
- force rescan 不触发隐藏 job uniqueness 冲突。
- GitHub recursive tree 截断时有 fallback。
- 默认线上只读 smoke 通过。
- 可选线上 LLM smoke 固定使用 `x-user-model: minimax/minimax-m2.7`。
- 代码和文档提交并推送到 `origin main`。

## 11. 假设

- 线上地址保持为 `https://compund.zeabur.app`。
- 线上 LLM smoke 模型固定为 `minimax/minimax-m2.7`，除非明确修订本计划。
- 线上部署已经有可用的服务端 LLM key。
- 本地不需要 OpenRouter key 就能做线上 API 验证。
- 稳定性和可观测性优先于盲目增加 worker 并发。
- 下一轮实施仍以 SQLite 为 source of truth。
