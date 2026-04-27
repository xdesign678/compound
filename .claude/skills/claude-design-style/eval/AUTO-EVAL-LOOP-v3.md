# Claude Design Style — 自动化循环评测 v3

融合 Karpathy autoResearch（metric-gated loop）+ Reflexion（verbal critique）的全自动评测框架。

**v3 变更**: 全程由 Sonnet 4.6 代理直接执行，利用多模态能力直接看图评分，无需外部 API。

**执行代理模型**: `claude-sonnet-4-6`

---

## v2 → v3 关键变更

| 问题     | v2 做法                                | v3 做法                                      |
| -------- | -------------------------------------- | -------------------------------------------- |
| 评分模型 | Qwen 3.6 Plus API 调用                 | 代理自身直接看图评分（Sonnet 4.6 多模态）    |
| 截图方式 | Playwright Python 脚本                 | 代理用 `browser` 工具直接截图                |
| 多次采样 | 3 次 API 调用取中位数                  | 代理单次评分 + 详细推理（消除 API 调用波动） |
| 修复方式 | Python 正则替换 CSS                    | 代理直接用 Edit 工具精准修改                 |
| 依赖     | Python + Pillow + Playwright + API key | 零依赖，代理自带所有能力                     |

---

## 全局配置

```bash
SKILL_DIR=~/.claude/skills/claude-design-style
EVAL_DIR=$SKILL_DIR/eval
REF_DIR=$EVAL_DIR/reference/screenshots    # 参考截图已存在
TEST_DIR=$EVAL_DIR/tests                    # 测试 HTML 已存在
SHOT_DIR=$EVAL_DIR/screenshots-v3           # v3 新目录
REPORT_DIR=$EVAL_DIR/reports-v3
MAX_ROUNDS=3
PASS_THRESHOLD=8.0
MIN_SINGLE=6.0
```

```bash
mkdir -p $SHOT_DIR $REPORT_DIR
```

---

## Phase A: 前置检查

### A.1 验证参考截图存在

```bash
ls $REF_DIR/R01-homepage-desktop.png \
   $REF_DIR/R03-research-desktop.png \
   $REF_DIR/R06-pricing-desktop.png \
   $REF_DIR/R07-api-desktop.png
```

如果缺失，需先执行参考截图采集（见 REFERENCE-CAPTURE-PROMPT.md）。

### A.2 验证测试 HTML 存在

```bash
ls $TEST_DIR/T01-landing.html $TEST_DIR/T10-darkmode.html
```

### A.3 参考图 → 测试映射

| 测试           | 对应参考图           | 说明            |
| -------------- | -------------------- | --------------- |
| T01-landing    | R01-homepage-desktop | 首页风格        |
| T02-article    | R03-research-desktop | 研究/文章页风格 |
| T03-pricing    | R06-pricing-desktop  | 定价页风格      |
| T04-auth       | R01-homepage-desktop | 整体色调基准    |
| T05-chat       | R02-claude-desktop   | 产品页风格      |
| T06-dashboard  | R07-api-desktop      | API/仪表盘风格  |
| T07-states     | R01-homepage-desktop | 整体风格基准    |
| T08-components | R01-homepage-desktop | 组件库风格      |
| T09-mobile     | R01-homepage-desktop | 窄屏风格        |
| T10-darkmode   | R01-homepage-desktop | 暗色版本基准    |

### A.4 有暗色模式的测试

T01, T03, T04, T05, T06, T07, T10

---

## Phase B: 循环主体（每轮执行）

### B.1 启动本地服务器 + 截图

```bash
cd $TEST_DIR && python3 -m http.server 8765 &
```

对每个 T01-T10：

1. `browser navigate http://localhost:8765/{filename}.html`
2. 等待渲染完成（观察截图确认页面加载）
3. `browser screenshot` → 保存为 `$SHOT_DIR/{T}-R{round}-desktop.png`

对有暗色模式的测试（T01, T03, T04, T05, T06, T07, T10）：

4. `browser act "Execute JavaScript: document.documentElement.classList.add('dark')"`
5. 等待 1 秒
6. **验证暗色生效**：
   ```
   browser console exec "getComputedStyle(document.body).backgroundColor"
   ```

   - 预期返回深色值（如 `rgb(26, 26, 24)`）
   - 如果仍是浅色，尝试：`browser console exec "document.documentElement.setAttribute('data-theme','dark')"`
   - 再次检查，如果仍未生效，标记 D1 为 `SKIP`
7. `browser screenshot` → 保存为 `$SHOT_DIR/{T}-R{round}-dark.png`
8. 恢复：`browser console exec "document.documentElement.classList.remove('dark')"`

截图完成后关闭服务器：

```bash
kill $SERVER_PID
```

### B.2 逐页对比评分

对每个测试，用 Read 工具同时查看两张图：

1. **参考图**: `Read $REF_DIR/{对应参考图}.png`
2. **测试截图**: `Read $SHOT_DIR/{T}-R{round}-desktop.png`

然后按以下维度评分（0-10），输出 JSON：

```
评分维度：
C1 配色：背景、文字、强调色是否与参考图的色调体系一致？
C2 字体：字体选择和 serif/sans 的使用场景是否与参考图一致？
C3 按钮：按钮形状、颜色、圆角是否与参考图风格一致？（无按钮标 N/A）
C4 间距：留白、呼吸感、内容密度是否与参考图风格一致？
C5 组件：卡片、导航等组件的视觉风格是否与参考图一致？（无该类组件标 N/A）
C6 整体：这张页面放到 anthropic.com 上，是否在视觉上不违和？
```

对有暗色截图的测试，额外评 D1：

```
D1 暗色模式：暗色背景是否为暖灰色调（非纯黑）？文字对比度舒适？按钮正确反转？
```

**评分要求**：

- 严格对比参考图的实际视觉效果，不要凭印象
- N/A 维度不参与平均分计算
- 每个维度必须给出简短理由

### B.3 汇总分数

将所有评分写入 `$REPORT_DIR/round-{N}-scores.json`：

```json
{
  "round": 1,
  "model": "claude-sonnet-4-6",
  "timestamp": "2026-04-05T12:00:00Z",
  "scores": {
    "T01-landing": {
      "C1": { "score": 9, "reason": "背景米白正确" },
      "C2": { "score": 8, "reason": "serif/sans 对比正确" },
      "C3": { "score": 9, "reason": "深色按钮圆角匹配" },
      "C4": { "score": 9, "reason": "留白充足" },
      "C5": { "score": 9, "reason": "卡片风格一致" },
      "C6": { "score": 9, "reason": "整体品牌感统一" },
      "D1": { "score": 8, "reason": "暖灰底正确" },
      "_avg": 8.7,
      "_status": "PASS"
    }
  },
  "overall_avg": 8.5,
  "passed": true,
  "failures": []
}
```

---

## Phase C: 判定

```
PASS 条件：
1. overall_avg >= 8.0
2. 无任何维度 < 6.0（critical failure）

判定结果：
- 全部通过 → 生成最终报告，结束
- 有 critical (< 6) → 进入 Phase D 修复，然后下一轮
- 仅 minor (6-8) 且 overall >= 8 → 通过（minor 仅记录）
- 达到 MAX_ROUNDS=3 → 生成报告，标记 PARTIALLY_PASSED
```

---

## Phase D: 自动修复

### 关键约束

1. **只修改** `tests/*.html` 文件的 CSS
2. **禁止修改** `$SKILL_DIR/SKILL.md` 和 `$SKILL_DIR/references/*.md`
3. 技能文档问题记录到 `$REPORT_DIR/skill-issues.md` 供人工审查
4. **每轮最多修 3 个 critical**
5. **只修 critical (< 6)**，minor (6-8) 仅记录

### 修复流程

对每个 critical failure：

1. 用 Read 工具查看对应测试 HTML 的 CSS 部分
2. 同时查看参考截图，确认应有的视觉效果
3. 用 Edit 工具精准修改 CSS
4. 记录修改到 `$REPORT_DIR/round-{N}-fixes.md`

### Anthropic 设计参考值（修复时参考）

```
背景: #faf9f5（米白，不是纯白 #fff）
文字: #141413（暖灰，不是纯黑 #000）
标题字体: Lora, Georgia, serif（大标题用 serif）
正文字体: serif（阅读内容），sans-serif（UI 文字/导航）
按钮: 深色填充 #0f0f0e，圆角 7.5px（不是药丸形）
卡片: 白色背景，轻阴影 rgba(0,0,0,0.08)，圆角 8px
暗色背景: #1a1a18（暖灰，不是纯黑）
暗色文字: #ece9e1
```

### 修复后 → 回到 Phase B

`round += 1`，重新截图、评分。

---

## 最终报告

所有轮次完成后，生成 `$REPORT_DIR/FINAL-EVAL-REPORT-v3.md`：

```markdown
# Claude Design Style — 自动化循环评测最终报告 v3

**Date**: {日期}
**评分模型**: claude-sonnet-4-6（代理直接看图评分）
**总轮数**: {N}/{MAX_ROUNDS}
**最终状态**: {PASSED / PARTIALLY_PASSED}
**最终均分**: {score}/10

---

## 评测方法

v3 改进：

- 评分由 Sonnet 4.6 代理直接完成，利用多模态能力看图对比
- 无外部 API 依赖，评分一致性由单一模型保证
- 修复由代理直接用 Edit 工具完成，精准度高于正则替换
- 纯视觉对比评分，不依赖文字 ground truth
- 暗色截图增加验证步骤，确保 CSS 生效后再截图

通过标准: 所有维度平均 >= 8.0/10，无单项 < 6/10
最大轮数: 3

---

## 轮次进化

| 轮次 | 均分 | critical | minor | 修复数 | 状态 |
| ---- | ---- | -------- | ----- | ------ | ---- |

## 逐页最终分数

| Test | 类型 | C1  | C2  | C3  | C4  | C5  | C6  | D1  | AVG | 状态 |
| ---- | ---- | --- | --- | --- | --- | --- | --- | --- | --- | ---- |

## 仍存在的问题

| Test | 维度 | 分数 | 原因 |
| ---- | ---- | ---- | ---- |

## 累计修复清单

| 文件 | 修改 | 轮次 | 维度 | 修前分 → 修后分 |
| ---- | ---- | ---- | ---- | --------------- |

## 需人工审查的技能文档问题

| 问题 | 影响测试 | 建议修改 |
| ---- | -------- | -------- |
```

---

## 约束（必须遵守）

1. **最多 3 轮** — 超过就停止
2. **禁止修改技能文档** — 只改测试 HTML，技能文档问题记录到 skill-issues.md
3. **每轮最多修 3 个 critical** — 避免回归
4. **不修改参考截图** — ground truth 不可变
5. **不使用 observations.md** — 评分完全基于视觉对比
6. **N/A 不参与计算** — 文章页没按钮不扣分，暗色未生效不扣暗色分
7. **暗色截图必须验证** — getComputedStyle 确认背景色变化后才截图
8. **只修 critical (< 6)** — minor (6-8) 仅记录
9. **评分时必须同时查看参考图和测试截图** — 不要凭记忆评分

---

## 执行命令

将以下内容发给代理（模型设为 claude-sonnet-4-6）：

```
读取 ~/.claude/skills/claude-design-style/eval/AUTO-EVAL-LOOP-v3.md，严格按照里面的步骤完整执行。

参考截图和测试 HTML 已存在，直接从 Phase B 开始循环。
每个测试页面都要截图并对比参考图评分。
循环直到通过或达到 3 轮上限。
最终生成 FINAL-EVAL-REPORT-v3.md 报告。
```
