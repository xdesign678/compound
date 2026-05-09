# Obsidian → GitHub → LLM 全链路稳定性 / 异步性深度研究

日期：2026-05-09

> 本文是 [`docs/obsidian-github-llm-sync-optimization-plan.md`](./obsidian-github-llm-sync-optimization-plan.md) 的姊妹篇，专注于：
>
> 1. 仔细对照仓库代码看现在到底落地了什么；
> 2. 通过四个并行 sub-agent 研究开源队列、RAG 管线、GitHub 同步与异步 LLM 取消的最新实践；
> 3. 把"还差什么"和"该怎么补"写成可立即执行的 phase 计划。

读者推荐顺序：先看本篇 §1–§3 了解差距，再回旧 plan 看历史背景，最后按 §4 落地。

---

## 1. 链路总览

```text
本地 Obsidian
  ─ git push ─►  GitHub repo
                  │   ├─ webhook ─► /api/sync/github/webhook
                  │   └─ cron     ─► /api/sync/cron/rescan
                  ▼
              startGithubSync (lib/github-sync-runner.ts)
                  │
                  ├─ listMarkdownFiles (tree, fallback contents)
                  ├─ diff vs sources (external_key sha)
                  ├─ download x4 concurrent (fetchMarkdownContent)
                  ▼
              analysis_jobs queue (SQLite)
                  │
                  ├─ github_ingest (LLM ingest + chunk + FTS + concept)
                  │       └─ contextualize chunks (LLM x N)
                  ├─ embedding
                  ├─ summarize
                  ├─ relations
                  └─ qa_index
                  ▼
              Wiki SQLite (sources, concepts, chunks, FTS, evidence)
                  │
                  ▼
              /sync 仪表盘、/ask 检索、/library
```

补充：

- 本机 Obsidian 已通过 git 推到 GitHub，不在 Compound 内承担同步职责。
- Compound 是 Next.js + better-sqlite3 + Node 22；没有 Redis、没有 BullMQ、没有 Temporal。
- 线上目标 `https://compund.zeabur.app`；线上 LLM smoke 模型 `minimax/minimax-m2.7`。

---

## 2. 仓库现状（代码层面已经做了什么）

### 2.1 稳定性已落地

| 项                                                   | 位置                                                             | 状态                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| SQLite WAL + busy_timeout=3000ms                     | `lib/server-db.ts:55-58`                                         | 已开启，但研究建议 ≥5000ms                  |
| analysis_jobs lease (5 min) + heartbeat (15s)        | `lib/analysis-worker.ts:LEASE_MS / HEARTBEAT_MS`                 | 已落地                                      |
| `recoverStaleAnalysisJobs()` 反向回收                | `lib/analysis-worker.ts:recoverStaleAnalysisJobs`                | dashboard poll 每次自动跑                   |
| 错误分类 transient / permanent / cancelled / unknown | `lib/analysis-worker.ts:classifyJobError`                        | 已落地                                      |
| 指数退避（最大 15 min）+ maxAttempts                 | `lib/analysis-worker.ts:failJob`                                 | 已落地，但 stage 间 maxAttempts 不一致      |
| HMAC-SHA256 webhook 签名 + safeEqual                 | `app/api/sync/github/webhook/route.ts`                           | 已落地                                      |
| GitHub tree truncated → contents API fallback        | `lib/github-sync.ts:listMarkdownFilesViaContents`                | 已落地                                      |
| Stage fingerprint cache（输入未变化跳过）            | `source_analysis_stage_cache` 表                                 | 已落地，但 github_ingest 阶段不参与缓存     |
| Circuit breaker（LLM / embedding）                   | `lib/circuit-breaker.ts` + `lib/gateway.ts` + `lib/embedding.ts` | 已落地                                      |
| AbortController 按 runId 注册 + abortRun()           | `lib/analysis-worker.ts:cancelControllers`                       | 已落地，已传入 chat / embed / contextualize |

### 2.2 异步性已落地

| 项                                                                     | 状态                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `analysis_jobs` claim 模式（`UPDATE … WHERE status='queued'` 乐观锁）  | 已落地，等价 SQLite 版 SKIP LOCKED                          |
| 后台 LLM 预算桶：github_ingest / summarize / relations / contextualize | 已落地（in-process counter）                                |
| `analysis_payload_blobs` 表把 GitHub markdown 抽出 `payload_json`      | 已落地，避免大 JSON 在 jobs 表里                            |
| 下载阶段并发 = `COMPOUND_GITHUB_DOWNLOAD_CONCURRENCY` (默认 4)         | 已落地                                                      |
| `MAX_PARALLEL_WORKERS=2` 进程内 worker 上限                            | 已落地                                                      |
| 取消信号通过 AbortController + `signal.addEventListener('abort')`      | 已落地（避开 `AbortSignal.any` 的 Node bug）                |
| Anthropic Contextual Retrieval（chunk 级 prefix）                      | 已落地 (`lib/contextual-chunk.ts`)，但每 chunk 单独一次 LLM |

### 2.3 文档与 runbook

- 旧 plan：`docs/obsidian-github-llm-sync-optimization-plan.md`（phase 1–8 已铺）。
- runbook：`runbooks/github-sync-stuck.md`、`runbooks/llm-timeout-uniform.md`、`runbooks/llm-gateway-degraded.md`、`runbooks/data-persistence.md`。
- API 文档自动生成：`docs/api-reference.md`、CI `docs-autogen.yml`。

---

## 3. 四路 sub-agent 调研结论

下面是四个并行 sub-agent 拿到的开源 / 业界主流方案要点（已经过逐项核对，不复述无关条目）。

### 3.1 SQLite 持久队列（BullMQ / River / pg-boss / Inngest / Temporal / QStash）

- **BullMQ stalled job**：`lockDuration` ≈ 30s，`lockRenewTime` = `lockDuration / 2`。心跳频率与 lease 上限符合"心跳间隔 × 3 ≤ lease"。
  Compound 当前 `HEARTBEAT_MS=15s`、`LEASE_MS=5min`，符合此规则，**不需要调**。
- **River / pg-boss claim**：标准做法是 `FOR UPDATE SKIP LOCKED`。Compound 在 SQLite 上用 `UPDATE … WHERE status='queued'` 的 affected-rows 模式，等价且正确。
- **SQLite WAL 调优**：研究推荐 `busy_timeout=5000`、`PRAGMA wal_autocheckpoint=1000`、定期 `PRAGMA wal_checkpoint(PASSIVE)`。Compound 现 `busy_timeout=3000`，**应调到 5000** 并加 autocheckpoint。
- **DLQ 模式**：QStash 风格 `analysis_jobs_dlq` 表 + 保留期 + UI"重试 / 删除 / 查看"。Compound 现在没有 DLQ，`failed` 与可重试态共用同一行。
- **Inngest / Temporal durable execution**：把任务拆成 step、每个 step 输入 / 输出落库、断点恢复。Compound 已经把 ingest 拆到多个 stage，但 **`github_ingest` 内部还包含 contextualize 多次 LLM**，不是单 step，恢复粒度太粗。

引用：

- <https://docs.bullmq.io/guide/jobs/stalled>
- <https://riverqueue.com/docs/sqlite>
- <https://github.com/timgit/pg-boss>
- <https://www.sqlite.org/wal.html>
- <https://upstash.com/docs/qstash/features/dlq>
- <https://www.inngest.com/docs/learn/how-functions-are-executed>
- <https://docs.temporal.io/>

### 3.2 RAG ingestion 管线（LlamaIndex / LangChain / GraphRAG / Haystack / mem0 / Anthropic）

- **LlamaIndex IngestionPipeline + DocumentStore**：cache key = `hash(node.content + transformation_params)`。Compound 已有 stage cache，**但 `github_ingest` 阶段没有命中 cache**，需要补一个 fingerprint = `repo + branch + path + blobSha + normalizedContentHash + parserVersion + promptVersion`。
- **LangChain RecordManager / indexing API**：cleanup 模式 `none / incremental / full`，靠 source id + content hash 决定是否重做 embedding。Compound 现在 `embedding` 是按 source 全量重做，**应改成 chunk 级 hash 比对**，未变化 chunk 不重新 embed。
- **Microsoft GraphRAG**：分层 LLM（chunk → entity → community summary）+ 只重算受影响 subgraph。Compound `relations` 阶段对应的就是 entity / relation 层；可借鉴"只对 changed source 周边 N 跳概念重抽 relation"的思路。
- **Haystack 2.x AsyncPipeline**：组件并行执行；`embedding` 与 `summarize` 在 Compound 当前是单 worker 串行 pull，**可以用独立 stage worker 池并行化**。
- **Anthropic Contextual Retrieval + prompt cache**：同文档批处理时 prompt cache 命中，latency ↓ 85%、成本 ↓ 90%。Compound 现一次只对一个 chunk 调 LLM，**应改成单 source 批处理 + cache_control: ephemeral**。

引用：

- <https://docs.llamaindex.ai/en/stable/module_guides/loading/ingestion_pipeline/>
- <https://python.langchain.com/docs/how_to/indexing/>
- <https://github.com/microsoft/graphrag>
- <https://docs.haystack.deepset.ai/docs/pipeline>
- <https://www.anthropic.com/news/contextual-retrieval>
- <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>

### 3.3 GitHub 同步可靠性（Tree truncation / Webhook outbox / Compare API / Quartz / Khoj）

- **Tree API truncation**：单次 recursive ≈ 7k 条上限。Compound 已 fallback 到 contents API，OK。
- **Webhook outbox**：标准做法是收到 webhook → 同事务写 outbox → 立即 200 → 后台 worker 消费。Compound 现在 `webhook → startGithubSync` 直推，**没有 `webhook_deliveries` 表**，没有 `delivery_id` 幂等，没法看投递历史，也无法在事故后 replay。
- **Compare API**：`GET /repos/.../compare/{base}...{head}` 自带 `files[].status`，分页可达 3000+ 条。Compound 现在每次都全量扫 tree，**webhook payload 里有 `before`/`after`，可以走 compare 拿增量**。
- **Khoj / Quartz / Dendron**：增量构建只重算 changed file，过滤 `.obsidian/` `.trash/` 与附件。Compound 已过滤前两者，路径白名单还可加 `.md` 才入队。
- **Webhook 安全**：`@octokit/webhooks` 提供 timing-safe verify。Compound 自己用 `crypto.createHmac` + `safeEqual`，等价。

引用：

- <https://docs.github.com/en/rest/git/trees>
- <https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries>
- <https://github.blog/changelog/2021-03-22-compare-rest-api-now-supports-pagination>
- <https://github.com/jackyzha0/quartz>
- <https://github.com/khoj-ai/khoj>
- <https://docs.khoj.dev/clients/obsidian/>

### 3.4 异步 LLM 取消、限流、Graceful Shutdown

- **AbortSignal**：`AbortSignal.timeout()` Node 18+ 原生 OK；`AbortSignal.any()` 在 Node v23 有已知 bug ([nodejs#57736](https://github.com/nodejs/node/issues/57736))。Compound 用手动 AbortController + `addEventListener('abort')`，**正确路线，不要切到 `any()`**。
- **OpenAI / Anthropic SDK signal**：流式响应 `controller.abort()` 触发 `reader.cancel()`，会 RST_STREAM 关连接。Compound 已经把 `signal` 传到 `chat()` / `embed()` / `contextualizeChunk()`。
- **后台限流**：`p-queue@^7.3.0` 是 2026 年仍维护、TS-friendly 的最优选；按 task 类型分桶 + 解析 provider rate-limit header。Compound 现在用 `setTimeout(1000)` 轮询等额度，**应换 p-queue**。
- **Heartbeat 频率**：Temporal 标准建议 10–30s。Compound `HEARTBEAT_MS=15s`，**符合**。
- **Durable cancellation outbox**：在 `runs` 表加 `cancelled_at`，每个 step 开头查一次。Compound `isRunCancelled()` 已经做了 in-memory + DB 双源，**已对齐**。
- **Graceful shutdown**：Vercel 自托管控制不到容器；Zeabur 可拦 SIGTERM；npm `http-graceful-shutdown@^3.1` 是常用方案。Compound 没显式处理，但因为 worker 在 process 内，重启会自然走 `recoverStaleAnalysisJobs()`，**风险可接受**。

引用：

- <https://github.com/nodejs/node/issues/57736>
- <https://ai-sdk.dev/docs/advanced/stopping-streams>
- <https://www.npmjs.com/package/p-queue>
- <https://www.npmjs.com/package/http-graceful-shutdown>
- <https://www.inngest.com/docs/features/inngest-functions/cancellation>
- <https://docs.temporal.io/encyclopedia/detecting-activity-failures>
- <https://docs.restate.dev/guides/sagas>

---

## 4. 还差什么（按维度归类）

只列**仓库里没有 / 不达标 / 不一致**的项；旧 plan 已覆盖、且代码已落地的不重复。

### 4.1 稳定性

1. **Webhook 幂等 + outbox 缺失**。`/api/sync/github/webhook` 直接调 `startGithubSync`，依赖 `getActiveSyncJob()` 单例去重；没有 `delivery_id` 表，没法看投递历史，也没法重放。
2. **DLQ 表 / UI 缺失**。`analysis_jobs.status='failed'` 与可重试态共用同一行；`/sync` 仅展示最后一个 error。
3. **`busy_timeout=3000ms` 偏低**。研究建议 ≥5000ms；contextualize 批 + 多 worker 并发偶发 `SQLITE_BUSY`。
4. **`startGithubSync` 不在事务里**。`recover → getActive → insertSyncJob` 三条 SQL，并发 webhook 仍可能短暂双开。
5. **`ingestSourceToServerDb` 内嵌 contextualize**。`server-ingest.ts` 在事务后跑 N 次 LLM，整个 `github_ingest` job 时长 = ingest LLM + N × contextualize LLM；单 job 失败回退代价大。

### 4.2 异步性

6. **后台 LLM 预算用 busy-wait**。`analysis-worker.ts:withBackgroundLlmBudget` 每秒轮询；应换 `p-queue` 或自写 token-bucket，按 task 维度分桶 + 解析 rate-limit header 反馈调速。
7. **post-ingest 串行被同一 worker pull**。`embedding / summarize / relations / qa_index` 全用同一 batch=1 的 worker；按 stage 分 worker pool 才能并行。
8. **GitHub tree 全量扫描**。webhook 有 `after` commit SHA，可走 compare 拿增量；现在仍无差别走 `git/trees/.../?recursive=1`。
9. **下载并发 4 但不读 `x-ratelimit-remaining`**。高频 push 时碰二级限流不会优雅退避。

### 4.3 速度 / 成本

10. **contextualize 一 chunk 一次 LLM**。应改成同 source 批处理 + prompt cache。
11. **`processQaIndex` 是空操作**。每次入库后还排了一个 job，浪费 worker 调度，可以改成 ingest 完成时直接 inline mark。
12. **`maxAttempts` 不一致**。`embedding=3 / summarize=2 / relations=2 / qa_index=1 / github_ingest=3`，没有体现"网络型"和"LLM 型"的区别；`embedding` 失败 3 次 ≈ 24 min 回退，期间检索效果劣化。

### 4.4 可观测性

13. **Prometheus 缺 stage 分位数 / 队列深度**。`/api/metrics` 已有 analysis 计数，但没有：
    - `analysis_job_duration_seconds_bucket{stage,status}`
    - `analysis_queue_depth{stage}`
    - `github_sync_run_duration_seconds`
    - `webhook_delivery_total{status}`
14. **`/sync/dashboard` 没有 DLQ / 投递历史卡片**。
15. **`syncObs` 事件没有 `delivery_id` / `compare_base_sha` 维度**。

---

## 5. 分阶段实施计划

每个 phase 独立可发布；按"投入产出比 + 风险"排序。

```text
P1 ── webhook outbox + DLQ + busy_timeout + 启动事务收紧
   ├─► P2 ── token-bucket + post-ingest 限流重写 (p-queue)
   │       ├─► P3 ── compare API 增量 sync + contextualize batch
   │       │       └─► P4 ── stage worker 池 + Prometheus 指标完善
   │       │               └─► P5 ── /sync UI: DLQ / 投递历史 / 死信 drawer
```

### Phase 1 — 稳定性硬底（1–2 天）

#### 任务

- 新表 `webhook_deliveries`：

  ```sql
  CREATE TABLE webhook_deliveries (
    delivery_id TEXT PRIMARY KEY,         -- X-GitHub-Delivery
    event TEXT NOT NULL,                  -- push / ping / ...
    signature_sha256 TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'received', -- received / processed / replayed / rejected
    job_id TEXT,                          -- startGithubSync 返回的 jobId
    error TEXT
  );
  CREATE INDEX idx_webhook_deliveries_received ON webhook_deliveries(received_at DESC);
  ```

  - HMAC 通过后，先 `INSERT OR IGNORE`；`changes()=0` 直接 `existing=true` 返回。
  - 同事务调用 `startGithubSync()`，把返回的 jobId 写回。

- DLQ 视图（不开新表，加字段更轻）：
  - `analysis_jobs` 加 `dead_letter_at INTEGER`；`failJob` 在 `terminal=true` 时设。
  - `/api/sync/dashboard` 多返一段 `dlq: { count, byStage, recent: [...] }`。
- SQLite pragma：
  - `lib/server-db.ts` 改 `busy_timeout=5000`、`PRAGMA wal_autocheckpoint=1000`、启动时 `PRAGMA wal_checkpoint(PASSIVE)`。
- `startGithubSync` 用 `BEGIN IMMEDIATE` 包 `getActiveSyncJob + insertSyncJob`。

#### 验收

- 同一 `delivery_id` 重投立即 200 + `existing=true`，不会启动新 run。
- `/sync` 出现"死信"计数（即便是 0）。
- 多并发 webhook 同秒触发不再短暂双开。

### Phase 2 — 后台 LLM 预算重写（2–3 天）

#### 任务

- 新依赖 `p-queue@^7.3.0`（纯 ts、无 worker_threads，CommonJS/ESM 都支持）。
- 新 `lib/llm-budgets.ts`：

  ```ts
  export const llmBudgets = {
    github_ingest: new PQueue({ concurrency: N }),
    contextualize: new PQueue({ concurrency: N }),
    summarize: new PQueue({ concurrency: N }),
    relations: new PQueue({ concurrency: N }),
    embedding: new PQueue({ concurrency: N }),
  };
  ```

- `withBackgroundLlmBudget` 替换为 `llmBudgets[bucket].add(() => fn(), { signal })`。
- 新 `lib/llm-rate-headers.ts`：解析每次 LLM/embedding/GitHub 响应 header；命中 `retry-after` 或 `remaining < threshold` 时 `queue.pause(ms)`。
- 单测覆盖：高并发提交 → 任何时刻活跃 task ≤ concurrency；header 触发 pause 时新 task 不会被立即 dequeue。

#### 验收

- 后台不再 `setTimeout(1000)` 轮询；CPU profile 能看到 idle 时段。
- 模拟 429 时队列自动暂停 + Sentry breadcrumb。

### Phase 3 — Compare API + Contextualize 批处理（2–3 天）

#### 任务

- `lib/github-sync.ts`：
  - 新 `listChangedSinceCommit(baseSha, headSha)`：`/repos/.../compare/{base}...{head}` + 分页；filter `status in {'added','modified','removed','renamed'}` + `.md` 后缀。
  - `startGithubSync` 接受 `before / after` 两个可选参数；若都有且能查到 `last_synced_commit_sha` 即走 compare 路径，否则回退 tree。
- `sources` 表加 `last_synced_commit_sha TEXT`（非破坏，单字段加列）；`startGithubSync` 成功时写入 head SHA。
- `lib/contextual-chunk.ts` 新 `contextualizeChunkBatch({source, chunks, signal})`：
  - 一次 LLM 调用，system message 含 source 全文 + `cache_control: ephemeral`，user message 给 chunk 列表，要求返回 `{[chunkId]: prefix}`。
  - 失败回退到原有 per-chunk 调用。
- `server-ingest.ts:runContextualizationForSource` 改用 batch 版；保留 `COMPOUND_CONTEXTUAL_RETRIEVAL=off` 总开关。
- `processQaIndex` 改为 `github_ingest` 成功时 inline 标记，不再排独立 job（保留 stage 字段以便老数据回放）。

#### 验收

- 单 push 修改 1 个文件时，sync 全程不再扫全 tree；线上日志能看到 `compare_base_sha → compare_head_sha → 1 changed`。
- contextualize 总 LLM 调用次数从 N 降到 ⌈N / batch_size⌉。

### Phase 4 — Stage worker 池 + Prometheus 指标（2 天）

#### 任务

- `analysis-worker` 增 `claim(stages?: AdvancedAnalysisStage[])` 重载；`startAnalysisWorker(reason, { stages })`。
- 调用方默认两类池子：
  - `github_ingest` 池（concurrency=2）；
  - `post_ingest` 池（embedding / summarize / relations，concurrency=3）。
- 环境变量：`COMPOUND_ANALYSIS_STAGE_WORKERS_GITHUB / _POST_INGEST`。
- `lib/observability/prometheus.ts` 加：
  - `analysis_job_duration_seconds_bucket{stage,status}`
  - `analysis_queue_depth{stage}`（Gauge，dashboard poll 时刷）
  - `github_sync_run_duration_seconds`
  - `webhook_delivery_total{status}`

#### 验收

- `embedding` 不再被 `relations` 阻塞；dashboard 能看到分 stage 队列深度。
- Prometheus rules 自动更新（`alerts:check` 通过）。

### Phase 5 — `/sync` UI 收尾（1 天）

#### 任务

- `components/sync/AdvancedDrawer.tsx` 加两个 tab：
  - **死信**：列出 `analysis_jobs.dead_letter_at IS NOT NULL`，支持"重新入队 / 删除"。
  - **投递历史**：从 `webhook_deliveries` 取最近 50 条，含 status / event / 关联 jobId。
- 文案核对：`skip-failed` 与 `cancel` 在前后端语义一致。

#### 验收

- 用户能在 `/sync` 直接看到投递历史和死信详情，不必再 `curl` API。

---

## 6. 验证策略

每个 phase 完成后跑：

```bash
npm run check                        # format / typecheck / unit / build / docs:api
npm run test -- lib/analysis-worker  # 队列层定向测试
npm run docs:api                     # 路由签名变化时刷新
```

线上只读 smoke（与现有约定一致）：

```bash
set -a && source .env.local && set +a
BASE="https://compund.zeabur.app"
TOKEN="$COMPOUND_ADMIN_TOKEN"
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/health"
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/wiki/health"
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/metrics"
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/sync/dashboard"
```

每个阶段直接 commit + push `origin main`（按仓库约定）。

---

## 7. 选项

请选择执行范围（之后明确告诉我即可，我会按选定方向落地）。

- **Option A — 稳定性硬底优先**：仅 Phase 1（webhook outbox + DLQ + pragma + 事务收紧）。最小改动、最快上线、回退风险最低。约 1–2 天。
- **Option B — 异步加速优先**：Phase 2 + Phase 3（p-queue 限流 + compare API + contextualize batch）。重点压速度与吞吐。约 4–6 天。
- **Option C — 全套（推荐）**：Phase 1 → 5 顺序全部落地，每个阶段独立 commit / push，整体 8–12 天。期间任意阶段都可独立验证。
- **Option D — 仅研究归档**：把这份 spec 与 sub-agent 调研结论写进 `docs/`（即本文件），不动代码，等用户后续指示。

---

## 8. 关键引用（去重整理）

- BullMQ stalled jobs：<https://docs.bullmq.io/guide/jobs/stalled>
- River SQLite 队列：<https://riverqueue.com/docs/sqlite>
- pg-boss：<https://github.com/timgit/pg-boss>
- SQLite WAL：<https://www.sqlite.org/wal.html>
- LangChain RecordManager：<https://python.langchain.com/docs/how_to/indexing/>
- LlamaIndex IngestionPipeline：<https://docs.llamaindex.ai/en/stable/module_guides/loading/ingestion_pipeline/>
- Microsoft GraphRAG：<https://github.com/microsoft/graphrag>
- Anthropic Contextual Retrieval：<https://www.anthropic.com/news/contextual-retrieval>
- Anthropic Prompt Caching：<https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- p-queue：<https://www.npmjs.com/package/p-queue>
- Inngest cancellation：<https://www.inngest.com/docs/features/inngest-functions/cancellation>
- Temporal heartbeat：<https://docs.temporal.io/encyclopedia/detecting-activity-failures>
- Restate sagas：<https://docs.restate.dev/guides/sagas>
- Node `AbortSignal.any` bug：<https://github.com/nodejs/node/issues/57736>
- GitHub Compare API 分页：<https://github.blog/changelog/2021-03-22-compare-rest-api-now-supports-pagination>
- GitHub Webhook 验证：<https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries>
- GitHub Trees API：<https://docs.github.com/en/rest/git/trees>
- Khoj Obsidian 同步：<https://docs.khoj.dev/clients/obsidian/>
- Quartz：<https://github.com/jackyzha0/quartz>
- QStash DLQ：<https://upstash.com/docs/qstash/features/dlq>
- Vercel AI SDK 取消流：<https://ai-sdk.dev/docs/advanced/stopping-streams>
- http-graceful-shutdown：<https://www.npmjs.com/package/http-graceful-shutdown>

---

## 9. 假设

- 线上地址保持 `https://compund.zeabur.app`，模型 smoke 固定 `minimax/minimax-m2.7`。
- 仍以 SQLite 为 source of truth，不引入 Redis / BullMQ / Temporal。
- 所有改动直接 commit 到 `main` 并 push，按仓库 AGENTS.md 约定。
- Sub-agent 引用全部为公开网址，不含真实 token。
