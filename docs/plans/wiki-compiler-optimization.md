# Compound Wiki Compiler Optimization

这次融合把 `compound` 从“只把资料概念化”推进到“把资料编译成可检索、可追溯的 Wiki 层”。

## 改了什么

### 1. 证据优先的服务端结构

新增并按需初始化这些表：

- `source_chunks`：每份资料的标题感知分块
- `concept_evidence`：概念到原文分块的证据链
- `concept_versions`：概念版本历史
- `concept_relations`：后续图谱升级的关系基础
- `model_runs`：预留的模型成本/延迟记录
- `concept_fts` / `chunk_fts`：SQLite FTS5 混合检索

### 2. 长文档按标题分块

Markdown 不再只截前半段，而是按标题层级、token 估算和 overlap 做稳定分块。这样长文档后半截也能进入检索。

### 3. 问答改成混合上下文

`/api/query` 现在会合并：

1. 现有客户端 IndexedDB 候选概念
2. 服务端概念检索结果
3. 原文分块检索结果
4. 已存的证据链片段

UI 不用重写，但大库问答召回会更稳。

### 4. GitHub 同步后自动编译

服务端同步摄入后，会顺手补齐：

- source chunks
- concept FTS
- concept evidence
- concept version

这样后面的问答和排查都会更快。

### 5. 修了同步更新的旧问题

同一路径的 GitHub 文件更新时，现在会把旧 `source` 替换成新 `source`，同步改写概念里的来源引用，并清掉旧分块/旧证据，避免数据越跑越脏。

### 6. 新增管理 API

- `GET /api/wiki/health`：看 chunk / evidence / version 指标
- `POST /api/wiki/search`：调试一条查询拿到的上下文
- `POST /api/wiki/rebuild-index`：从现有数据重建 chunk / FTS / evidence
- `GET /api/wiki/export`：导出 Markdown 版 wiki 载荷

## 几千篇文档时建议流程

1. 配置 `COMPOUND_ADMIN_TOKEN`
2. 部署这次改动
3. 先跑一次 `POST /api/wiki/rebuild-index`
4. 再开始 GitHub sync
5. 用 `GET /api/wiki/health` 看 chunk 和 evidence 覆盖率

## 环境变量

```env
COMPOUND_CHUNK_MAX_TOKENS=1200
COMPOUND_CHUNK_OVERLAP_TOKENS=120
COMPOUND_QUERY_CONTEXT_CONCEPT_LIMIT=24
COMPOUND_QUERY_CONTEXT_CHUNK_LIMIT=12
```

## 后续高杠杆方向

- 给大批量编译补 `ingest_jobs` 队列
- 在 FTS 之后再加 embedding / rerank
- 把 `related: string[]` 升级成有类型的关系图
- 给高风险概念合并加 review queue
- 直接导出到 GitHub wiki 或 Obsidian vault
