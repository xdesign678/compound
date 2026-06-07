# Compound

Compound is a private, LLM-powered personal knowledge Wiki. It turns raw notes, links, and Markdown files into concept pages, then lets you ask questions across the evolving Wiki.

## Important security note

Compound stores and processes private knowledge. Do not expose it on the public internet without access protection.

For production deployments, set a strong random token:

```bash
COMPOUND_ADMIN_TOKEN="$(openssl rand -base64 32)"
```

When the token is set, the app supports browser Basic Auth and API requests with either:

```http
Authorization: Bearer <token>
```

or:

```http
X-Compound-Admin-Token: <token>
```

The Settings drawer also has a local “访问保护” field for saving the same token in the current browser.

## Architecture

For a deep dive on services, data flow, external dependencies and background
workers, see [`docs/architecture.md`](docs/architecture.md). It includes
Mermaid diagrams for the system overview, GitHub sync pipeline, query flow,
review/repair loop, and deployment topology.

## Local development

```bash
npm ci
npm run dev
```

In local development, if `COMPOUND_ADMIN_TOKEN` / `ADMIN_TOKEN` is not set, auth is not enforced.

## Environment variables

Copy `.env.example` and edit the values:

```bash
cp .env.example .env.local
```

Required for production:

- `COMPOUND_ADMIN_TOKEN` or `ADMIN_TOKEN`: site/API access protection.
- `LLM_API_URL`: OpenAI-compatible chat completions endpoint, for example `https://api.openai.com/v1/chat/completions`.
- `LLM_API_KEY`: server-side LLM API key.
- `LLM_MODEL`: model name.
- `DATA_DIR`: persistent SQLite directory, for example `/data`.

Required for GitHub/Obsidian server sync:

- `GITHUB_REPO`: `owner/repo` or a GitHub repo URL.
- `GITHUB_TOKEN`: fine-grained PAT with Repository → Contents: Read-only.
- `GITHUB_BRANCH`: defaults to `main`.

Optional sync/analysis controls:

- `GITHUB_WEBHOOK_SECRET`: verifies `/api/sync/github/webhook` push events.
- `CRON_SECRET`: allows scheduled full rescan through `/api/sync/cron/rescan`.
- `COMPOUND_GITHUB_DELETE_MODE`: `soft` by default; set `hard` to remove local records when remote files disappear.
- `COMPOUND_EMBEDDING_PROVIDER`: `local` by default; set `remote` only when an embedding endpoint is configured.
- `COMPOUND_EMBEDDING_API_KEY`, `COMPOUND_EMBEDDING_API_URL`, `COMPOUND_EMBEDDING_MODEL`: optional remote embedding settings.
- `COMPOUND_DISABLE_HYBRID_SEARCH=true`: disables embedding-assisted retrieval and uses FTS only.

## Docker

```bash
docker build -t compound .
docker run --rm -p 3000:3000 \
  -e COMPOUND_ADMIN_TOKEN=change-me \
  -e LLM_API_URL=https://api.openai.com/v1/chat/completions \
  -e LLM_API_KEY=sk-... \
  -e LLM_MODEL=gpt-4o-mini \
  -v compound-data:/data \
  compound
```

## Deployment notes

- GitHub sync uses a long-running Node process and a SQLite-backed job table. Prefer container deployment over serverless.
- `/sync` shows run-level progress, file-level status, analysis worker state, retry/cancel controls, and index coverage.
- `/review` shows low-confidence or large-change review items before they are accepted by a human.
- [`docs/deployment-observability.md`](docs/deployment-observability.md) explains where to watch deploy impact in real time: Zeabur, Sentry, GitHub Actions, `/api/health`, `/api/metrics`, `/sync`, `/review`, and Slack deploy notifications.
- Incident response playbooks live in [`runbooks/`](runbooks/). Start there for production 503s, auth lockouts, stuck GitHub sync, LLM gateway failures, and SQLite persistence issues.
- The service writes SQLite data under `DATA_DIR`.
- The browser also keeps an IndexedDB cache for fast local reads.
- User-supplied custom LLM endpoints must use the user’s own API key. The server-owned key is never sent to a user-supplied URL.

## 稳定性与性能加固

近期的四轮加固已全部通过验证（56 项断言 + 375 条 node:test + 类型检查 + lint 零警告）。

### 后端稳定性（里程碑 1）

- **进程级崩溃守卫**：`instrumentation.ts` 注册 `unhandledRejection` / `uncaughtException`，未捕获异常不再拖垮整个进程
- **Analysis Worker 循环 `.catch()`**：与其他 Worker 一致，循环内异常不再静默丢失
- **启动时卡死任务自动恢复**：sync / analysis / repair 中处于 running 但已超时的任务，启动时自动标记为失败并重试
- **任务终态守卫**：`finishJob` / `failJob` / `failJobPermanently` 只更新 `running` 状态的任务，防止状态机紊乱
- **毒丸任务死信路径**：反复失败的任务进入 dead-letter 而非无限重试
- **原子化概念写入**：多步写入包裹在 SQLite 事务中，杜绝半成品数据
- **原子化 Source Artifact 操作**：删除 + 插入在单一事务中完成
- **数据保留 / GC 模块**：可配置 append-only 表（sync_events、model_runs 等）的行数上限，自动清理历史数据

### API 健壮性（里程碑 2）

- **统一请求体大小限制**：所有写入路由使用 `readJsonWithLimit`，超限返回 413
- **认证暴力破解防护**：失败认证限速 + `Retry-After` 响应头
- **Webhook 限速**：HMAC 校验之前先做频率限制，避免签名验证成为瓶颈
- **统一错误响应**：`apiError()` 辅助函数，防止内部细节泄露
- **输入校验 4xx**：非法输入不再返回 500，一律正确状态码
- **网关超时覆盖 Body 读取阶段**：客户端断连时中止正在进行的 LLM 调用

### 前端流畅度（里程碑 3）

- **字体优化**：移除 Noto Serif SC 预加载，改用系统 CJK 衬线回退字体
- **CSS 拆分**：globals.css 按路由拆分，首屏 CSS 从 ~300KB 降至 ~27KB
- **Ask 流式渲染节流**：消除逐 token 重新解析的 O(n²) 开销
- **Observer / 滚动优化**：移除全局 subtree MutationObserver，IntersectionObserver 仅用于滚动锚点
- **IDB `bulkGet` 替代逐条获取**；marked / dompurify 懒加载；移除未使用的 postcss 依赖

### 收尾（里程碑 4）

- 新增 server-only 模块纳入 ESLint 受限路径与 AGENTS.md 列表
- repair-worker 终态写入守卫 + cancelled 任务 blob 清理 + repair 死信路径

## Checks

```bash
npm run typecheck
npm run test
npm run docs:api:check   # ensures docs/api-reference.md is up to date
npm run build
npm run build:measure    # writes tmp/build-metrics.json for build duration and static size
```

## API reference

The full HTTP API surface is documented in
[`docs/api-reference.md`](docs/api-reference.md). That file is generated
automatically from the JSDoc comments and exported handlers in
`app/api/**/route.ts`:

```bash
npm run docs:api          # regenerate docs/api-reference.md
npm run docs:api:check    # fail if the file is stale (CI uses this)
```

A dedicated GitHub Actions workflow (`.github/workflows/docs-autogen.yml`)
also regenerates and commits the file on every push to `main` that touches
the API routes or the generator script.
