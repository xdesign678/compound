# 分类规范化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为分类系统增加严格规则化合并，让新标签自动收口，并把旧数据批量回写成统一分类。

**Architecture:** 在 `lib/types.ts` 外抽出分类规范化工具，集中处理分类清洗、别名吸收和 `categoryKeys` 生成。导入链路、自动归类链路和数据库升级统一复用这套规则，保证新旧数据收口一致。

**Tech Stack:** TypeScript, Next.js, Dexie, better-sqlite3, Node test

---

### Task 1: 补规范化测试

**Files:**
- Create: `lib/category-normalization.test.ts`
- Modify: `lib/ingest-core.test.ts`

**Step 1: Write the failing test**

覆盖：
- 「神经科学」「脑科学/神经科学」被并到「脑科学」
- 重复和空分类被移除
- `toCategoryKeys` 输出只保留规范后的主类与二级类

**Step 2: Run test to verify it fails**

Run: `node --test lib/category-normalization.test.ts`

**Step 3: Write minimal implementation**

新增分类规范化工具，先实现脑科学相关严格合并规则。

**Step 4: Run test to verify it passes**

Run: `node --test lib/category-normalization.test.ts`

**Step 5: Commit**

暂不提交，继续完成链路接入后统一验证。

### Task 2: 接入导入与归类链路

**Files:**
- Create: `lib/category-normalization.ts`
- Modify: `lib/api-client.ts`
- Modify: `lib/server-ingest.ts`
- Modify: `lib/types.ts`

**Step 1: Write the failing test**

补导入链路测试或辅助断言，确认写入前会先规范化分类。

**Step 2: Run test to verify it fails**

Run: `node --test lib/ingest-core.test.ts lib/category-normalization.test.ts`

**Step 3: Write minimal implementation**

在客户端导入、服务端导入和自动归类写入前统一调用规范化函数。

**Step 4: Run test to verify it passes**

Run: `node --test lib/ingest-core.test.ts lib/category-normalization.test.ts`

**Step 5: Commit**

暂不提交，继续完成旧数据回填。

### Task 3: 回填旧数据

**Files:**
- Modify: `lib/db.ts`
- Modify: `lib/server-db.ts`

**Step 1: Write the failing test**

通过工具函数覆盖旧分类重写逻辑，确认数据库升级会把旧分类写成规范后的结果。

**Step 2: Run test to verify it fails**

Run: `node --test lib/category-normalization.test.ts`

**Step 3: Write minimal implementation**

Dexie 升级时扫描 `concepts` 表并规范化分类；SQLite 启动迁移时同步做一次回填。

**Step 4: Run test to verify it passes**

Run: `node --test lib/category-normalization.test.ts`

**Step 5: Commit**

暂不提交，统一验证通过后再决定是否提交。

### Task 4: 全量验证

**Files:**
- Modify: `package.json`（如需补测试脚本）

**Step 1: Run targeted tests**

Run: `node --test lib/category-normalization.test.ts lib/ingest-core.test.ts`

**Step 2: Run repo verification**

Run: `npm run lint`

**Step 3: Record remaining gaps**

如果没有现成的自动化覆盖数据库迁移路径，就在结果里明确说明已通过工具函数和升级代码双重收口。
