# LLM uniform-second timeouts (≥5 文件同秒数失败)

Use this when `/sync` 显示一批文件全部以**完全相同的秒数**（如 16 个文件全部 `55s`）抛出
`The operation was aborted due to timeout`。这是一个高置信度模式，**几乎不是网络抖动，
而是配置或模型层的硬性问题**。

## 影响

- 多文件同步几乎 100% 失败、且每次失败时长完全一致。
- 重试逻辑无效 — 第二次、第三次仍在同一秒撞墙。
- 失败文件卡片底部显示「分析 · Ns」，N 在 30/45/55/60/120 这些圆整值附近。
- `errorGroups[0].fingerprint` 通常是 `timeout`、`timeout-wallclock` 或 `timeout-stream-idle`。

## 自动检测

`/sync` 控制台顶部出现红色 banner，标题形如「N 个文件以同样方式超时」，附带 chip：

- 切换到 gpt-4o-mini（推荐）
- 查看 env 变量
- 阅读本 runbook
- 跳过这批文件

`lib/sync-narrative.ts:detectUniformTimeoutPattern()` 在失败时长方差 ≤8s 且失败数 ≥5
时识别该模式。

## Check

按概率从高到低排查：

1. **环境变量** — 部署平台 / `.env` / `.env.local`：

   ```bash
   echo "$COMPOUND_LLM_TIMEOUT_MS"        # 应为空 或 ≥120000
   echo "$COMPOUND_LLM_REASONING_EXTRA_MS" # 默认 60000
   echo "$COMPOUND_LLM_STREAM_IDLE_MS"    # 默认 45000
   ```

   - 若 `COMPOUND_LLM_TIMEOUT_MS=55000` 或类似低值 → **直接删该变量**或改成 ≥180000
     是最常见的根因。
   - 若 stream idle 设得过短，reasoning 模型还在思考就被打断 → 出现 `timeout-stream-idle`。

2. **当前 LLM_MODEL** — `echo $LLM_MODEL`：
   - DeepSeek-V3/V4-flash、MiniMax-M2、MiMo、所有 `:thinking` 后缀都属于 reasoning
     模型，OpenRouter free 档下首 token 延迟常 30–60s + 输出 30–60s，**总耗时在普通
     超时窗口内极容易撞死**。
   - 验证：去 [OpenRouter Activity](https://openrouter.ai/activity) 看你最近 10 个
     请求的实际 latency。中位数 >50s 就是模型/排队太慢。

3. **prompt 体积** — `runIngestLLM` 给 LLM 12000 字符正文 + 200 个候选概念，对慢模型
   是致命的。看 `lib/ingest-core.ts:MAX_RAW` 与 `MAX_EXISTING`。

4. **OpenRouter 队列** — 免费/低优先级模型会排队。访问 OpenRouter Dashboard 确认
   你的请求没有被堆积。

## Recovery（按代价递增）

1. **快速止血（30 秒）**：
   - 部署平台变量：删 `COMPOUND_LLM_TIMEOUT_MS=55000`（如有）。
   - 把 `LLM_MODEL` 改成 `openai/gpt-4o-mini` 或 `anthropic/claude-haiku-4.5`，重新
     `/sync` → 立即同步。这两个模型 5–15 秒就能完成同样的概念抽取。

2. **配置加固（5 分钟）**：
   - 在 `.env`/部署平台显式设置：
     ```
     COMPOUND_LLM_TIMEOUT_MS=180000
     COMPOUND_LLM_REASONING_EXTRA_MS=60000
     COMPOUND_LLM_STREAM_REASONING=true
     COMPOUND_LLM_AUTO_FALLBACK_AFTER=3
     COMPOUND_LLM_FALLBACK_MODEL=openai/gpt-4o-mini
     ```
   - 这样即使你回到慢模型，连续 3 次撞墙后会自动降级一次给 fallback 跑完，避免整批
     都失败。

3. **应用层修复**：
   - 如果模型必须用 reasoning 类，开启 streaming：`COMPOUND_LLM_STREAM_REASONING=true`
     已是默认。streaming 下 idle timeout 是 per-chunk，模型只要在持续吐字就不会被
     timeout 打断。
   - 进一步缩 prompt：
     - `COMPOUND_CHUNK_MAX_TOKENS` 降低
     - 减少 `existingConcepts` 候选数（`pickExistingConceptsForPrompt` 的 `MAX_EXISTING`）

4. **跳过永久失败文件**：
   - 在 banner 点「跳过这批文件」，或调用 `/api/sync/cancel` 把当前 run 标记完成；
     失败文件会进入 `permanently_failed`，避免每次同步都重复撞墙。

## Verify

- 重新 `/sync` 后 `errorGroups` 中 `category=timeout` 的 count 在第一分钟内回归 0。
- `/sync` 顶部诊断 banner 自动消失。
- `/api/sync/dashboard` 返回的 `failedItems` 不再包含 `operation was aborted`。
- 任意一次手动重试在 ≤30 秒内成功（fast model）或 ≤90 秒内成功（reasoning model + streaming）。

## Do not

- 不要把 `COMPOUND_LLM_TIMEOUT_MS` 设到 ≥10 分钟来「掩盖」慢模型问题 — 这只会让 worker
  lease 锁很久，下一次 sync 卡更深。优先**换模型**或**缩 prompt**。
- 不要把 reasoning 模型的 `response_format: json_object` 强行加回去 — `gateway.ts`
  已通过 `isReasoningModel()` 自动跳过它，这个判断不要绕过。
- 不要在没看完 OpenRouter Activity 的情况下断定「上游故障」。多数情况是排队 + 慢模型。

## Escalate

仍然怀疑上游网关本身问题时，参考 `runbooks/llm-gateway-degraded.md`，先做小请求验证、
再考虑切换到付费档或 OpenAI 直连。
