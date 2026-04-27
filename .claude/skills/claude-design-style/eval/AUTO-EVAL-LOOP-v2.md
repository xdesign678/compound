# Claude Design Style — 自动化循环评测 v2

融合 Karpathy autoResearch（metric-gated loop）+ Reflexion（verbal critique）的全自动评测框架。

**v2 修复**: 解决 v1 三轮越改越差的四个根因：评分模型不稳定、ground truth 文字描述错误、暗色截图未生效、修复方向反转。

**交给有 browser + 图片识别能力的代理执行。**

---

## v1 → v2 关键变更

| 问题         | v1 做法                            | v2 做法                              |
| ------------ | ---------------------------------- | ------------------------------------ |
| 评分模型     | Gemini Flash 单次调用              | Qwen 3.6 Plus 3 次采样取中位数       |
| Ground truth | observations.md 文字描述（写反了） | 纯视觉对比，不依赖文字描述           |
| 暗色截图     | classList.add 后立即截图           | 加验证：检查 body 背景色已变化后再截 |
| 修复范围     | 可修改技能文档                     | 禁止修改技能文档，只改测试 HTML      |
| N/A 处理     | 评分时可能给 0                     | 明确标记，不参与平均分计算           |

---

## 评分模型配置

**模型**: `qwen3.6-plus`（通过阿里云百炼 DashScope API 调用）

选择原因：

1. 已验证的视觉理解能力：能准确识别 Anthropic 官网 serif 标题、米白配色、按钮风格
2. 评分质量高：首次测试即精准命中字体问题（C2=5，理由准确）
3. 支持双图对比 + JSON 格式输出
4. 成本低、速度快

**API 调用方式**:

```bash
SCORING_API="https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
SCORING_KEY="sk-02dfe974396a486a85dfff5143a766be"
SCORING_MODEL="qwen3.6-plus"
```

```bash
curl -s $SCORING_API \
  -H "Authorization: Bearer $SCORING_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.6-plus",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,{REF_IMG_BASE64}"}},
          {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,{TEST_IMG_BASE64}"}},
          {"type": "text", "text": "{SCORING_PROMPT}"}
        ]
      }
    ],
    "max_tokens": 800
  }'
```

**图片预处理**: 发送前将截图缩放到 720px 宽度、JPEG quality=70，控制 base64 大小在 30KB 以内，避免请求超时。

```python
from PIL import Image
import io, base64

def prep_image(path, width=720, quality=70):
    img = Image.open(path)
    img = img.resize((width, int(width * img.height / img.width)))
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=quality)
    return base64.b64encode(buf.getvalue()).decode()
```

**多次采样协议**: 每张截图对调用 3 次，取每个维度的中位数。如果 3 次中某维度标准差 > 2，标记为 `unstable`，在报告中注明。

---

## 全局配置

```bash
SKILL_DIR=~/.claude/skills/claude-design-style
EVAL_DIR=$SKILL_DIR/eval
REF_DIR=$EVAL_DIR/reference/screenshots    # 参考截图已存在
TEST_DIR=$EVAL_DIR/tests                    # 测试 HTML 已存在
SHOT_DIR=$EVAL_DIR/screenshots-v2           # v2 使用新目录避免混淆
REPORT_DIR=$EVAL_DIR/reports-v2
MAX_ROUNDS=3
PASS_THRESHOLD=8.0
MIN_SINGLE=6.0
SCORING_MODEL="qwen3.6-plus"
SCORING_API="https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
SCORING_KEY="sk-02dfe974396a486a85dfff5143a766be"
SAMPLES_PER_SCORE=3
```

```bash
mkdir -p $SHOT_DIR $REPORT_DIR
```

---

## Phase A: 参考基准检查

**v2 不重新截图**。使用 v1 已采集的参考截图（`reference/screenshots/R01-R10`）。

### A.1 验证参考截图存在

```bash
ls $REF_DIR/R01-homepage-desktop.png \
   $REF_DIR/R03-research-desktop.png \
   $REF_DIR/R06-pricing-desktop.png \
   $REF_DIR/R09-careers-desktop.png
```

如果缺失，才执行 Phase A 截图流程（同 v1）。

### A.2 参考图 → 测试类型映射

| 测试类型       | 对应参考图               | 说明                               |
| -------------- | ------------------------ | ---------------------------------- |
| T01 Landing    | R01-homepage, R02-claude | 首页/产品页风格                    |
| T02 Article    | R03-research, R04-news   | 文章/研究页风格                    |
| T03 Pricing    | R06-pricing              | 定价页风格                         |
| T04 Auth       | R01-homepage             | 无直接参考，用首页的整体色调做基准 |
| T05 Chat       | R02-claude               | 产品页风格最接近                   |
| T06 Dashboard  | R07-api                  | API/产品页风格                     |
| T07 States     | R01-homepage             | 用首页的整体风格做基准             |
| T08 Components | R01-homepage, R08-docs   | 首页+文档页综合                    |
| T09 Mobile     | R01-homepage             | 首页风格（只是窄屏）               |
| T10 Dark       | R01-homepage             | 首页风格的暗色版本                 |

---

## Phase B: 测试页面检查

**v2 不重新生成**。使用现有 `tests/T01-T10.html`。

验证文件存在：

```bash
ls $TEST_DIR/T01-landing.html $TEST_DIR/T10-darkmode.html
```

如果缺失，才按 v1 流程重新生成。

---

## Phase C: 截图 + 对比评分

这是循环的核心。每轮执行。

### C.1 启动本地服务器

```bash
cd $TEST_DIR && python3 -m http.server 8765 &
SERVER_PID=$!
```

### C.2 截图测试页面

对每个 T01-T10：

```
1. browser navigate http://localhost:8765/{filename}
2. 等待 2 秒确保完全渲染
3. 截图 → screenshots-v2/{T}-R{round}-desktop.png
4. 如果页面有暗色模式（T01, T03, T04, T05, T06, T07, T10）：
   a. browser console exec "document.documentElement.classList.add('dark')"
   b. 等待 1 秒
   c. 验证暗色生效：
      browser console exec "getComputedStyle(document.body).backgroundColor"
      → 预期返回 rgb(26, 26, 24) 或类似深色值
      → 如果仍是浅色值，尝试替代方法：
        browser console exec "document.documentElement.setAttribute('data-theme','dark')"
        或 browser console exec "document.body.classList.add('dark')"
        等待 1 秒，再次检查
   d. 截图 → screenshots-v2/{T}-R{round}-dark.png
   e. browser console exec "document.documentElement.classList.remove('dark')"
   f. 等待 0.5 秒恢复
```

**暗色验证失败处理**: 如果尝试所有方法后 body 背景仍是浅色，在报告中标记 D1 为 `SKIP_NO_DARK_CSS`（不是给低分，而是标记该页面暗色模式 CSS 不完整），D1 不参与该测试的平均分计算。

### C.3 对比评分

**核心变更: 纯视觉对比，不使用 observations.md**

对每个测试页面，构造以下评分 prompt 发给 Qwen 3.6 Plus：

```
你是 Anthropic 设计系统的专家评审。

第一张图是 Anthropic 官网（anthropic.com）的真实截图，作为参考标准。
第二张图是一个测试页面的截图，需要评估它与 Anthropic 设计风格的一致性。

请逐维度评分（0-10），并给出简短理由：

C1 配色：背景、文字、强调色是否与参考图的色调体系一致？
C2 字体：字体选择和 serif/sans 的使用场景是否与参考图一致？
C3 按钮：按钮形状、颜色、圆角是否与参考图风格一致？（如果测试页面没有按钮，标记 N/A）
C4 间距：留白、呼吸感、内容密度是否与参考图风格一致？
C5 组件：卡片、导航等组件的视觉风格是否与参考图一致？（如果测试页面没有该类组件，标记 N/A）
C6 整体：这张页面放到 anthropic.com 上，是否在视觉上不违和？

严格按以下 JSON 格式输出，不要输出其他内容：
{
  "C1": {"score": 9, "reason": "背景米白色调正确，文字暖灰"},
  "C2": {"score": 8, "reason": "正文 serif 正确，但标题粗细偏重"},
  "C3": {"score": 10, "reason": "深色填充按钮，7.5px 圆角，完全匹配"},
  "C4": {"score": 9, "reason": "留白充足，呼吸感好"},
  "C5": {"score": "N/A", "reason": "页面无卡片组件"},
  "C6": {"score": 9, "reason": "整体品牌感统一，可放入官网"}
}
```

**暗色模式评分**（如果有暗色截图）：

用同样的参考图 + 暗色截图，额外评一个 D1 维度：

```
D1 暗色模式：暗色背景是否为暖灰色调（非纯黑）？文字对比度是否舒适？按钮是否正确反转为浅色？

在同一个 JSON 中增加 D1 字段。
```

### C.4 多次采样 + 取中位数

对每个测试页面的每次评分调用 **3 次**：

```python
# 伪代码
scores_per_test = {}
for test in T01_to_T10:
    samples = []
    for i in range(3):
        result = call_gateway(SCORING_MODEL, ref_img, test_img, prompt)
        samples.append(parse_json(result))

    median_scores = {}
    for dim in ["C1","C2","C3","C4","C5","C6","D1"]:
        values = [s[dim]["score"] for s in samples if s[dim]["score"] != "N/A"]
        if not values:
            median_scores[dim] = "N/A"
        else:
            median_scores[dim] = sorted(values)[len(values)//2]  # 中位数
            std = stdev(values) if len(values) > 1 else 0
            if std > 2:
                median_scores[dim + "_unstable"] = True

    scores_per_test[test] = median_scores
```

### C.5 汇总本轮分数

写入 `reports-v2/round-{N}-scores.json`：

```json
{
  "round": 1,
  "model": "qwen3.6-plus",
  "samples_per_score": 3,
  "timestamp": "2026-04-04T12:00:00Z",
  "scores": {
    "T01": {
      "dimensions": {
        "C1": { "median": 9, "samples": [9, 9, 10], "std": 0.47, "reason": "背景米白正确" },
        "C2": {
          "median": 10,
          "samples": [10, 10, 9],
          "std": 0.47,
          "reason": "serif/sans 对比明显"
        },
        "C3": { "median": 9, "samples": [9, 9, 9], "std": 0, "reason": "按钮形状正确" },
        "C4": { "median": 10, "samples": [10, 9, 10], "std": 0.47, "reason": "留白充足" },
        "C5": { "median": 9, "samples": [9, 10, 9], "std": 0.47, "reason": "卡片风格一致" },
        "C6": { "median": 9, "samples": [9, 9, 10], "std": 0.47, "reason": "整体品牌感好" },
        "D1": { "median": 8, "samples": [8, 8, 9], "std": 0.47, "reason": "暖灰底正确" }
      },
      "avg": 9.1,
      "status": "PASS"
    }
  },
  "overall_avg": 8.5,
  "failures": [],
  "passed": true
}
```

---

## Phase D: 判定

读取 `round-{N}-scores.json`，执行判定：

```python
passed = True
failures = []

for test_id, test_data in scores.items():
    valid_scores = []
    for dim, dim_data in test_data["dimensions"].items():
        if dim.endswith("_unstable"):
            continue
        score = dim_data["median"]
        if score == "N/A":
            continue
        valid_scores.append(score)
        if score < MIN_SINGLE:  # < 6
            failures.append({
                "test": test_id, "dim": dim, "score": score,
                "severity": "critical", "reason": dim_data["reason"]
            })
            passed = False
        elif score < PASS_THRESHOLD:  # < 8
            failures.append({
                "test": test_id, "dim": dim, "score": score,
                "severity": "minor", "reason": dim_data["reason"]
            })

    test_avg = sum(valid_scores) / len(valid_scores) if valid_scores else 0
    test_data["avg"] = round(test_avg, 1)

overall_avg = mean([t["avg"] for t in scores.values()])
if overall_avg < PASS_THRESHOLD:
    passed = False

if passed:
    goto FINAL_REPORT
elif round >= MAX_ROUNDS:
    goto FINAL_REPORT  # 标记为 PARTIALLY_PASSED
else:
    goto PHASE_E
```

---

## Phase E: 自动修复

### 关键约束：禁止修改技能文档

v1 的教训：基于错误的 ground truth 修改技能文档会导致越改越偏。

**v2 规则**：

- **只允许修改** `tests/*.html` 文件
- **禁止修改** `$SKILL_DIR/SKILL.md` 和 `$SKILL_DIR/references/*.md`
- 如果发现的问题确实需要修改技能文档，记录到 `reports-v2/skill-issues.md` 供人工审查

### E.1 分析 failures

只处理 `severity: critical`（< 6 分）的问题。`severity: minor`（6-8 分）仅记录，不修复。

理由：minor 问题可能是评分波动导致，不值得修改引入回归风险。

### E.2 修复测试 HTML

对每个 critical failure：

1. 读取该测试 HTML 的 CSS 部分
2. 根据 critique 中的 `reason` 确定修改点
3. 编辑 CSS（不改 HTML 结构）
4. 记录修改

### E.3 修复日志

写入 `reports-v2/round-{N}-fixes.md`：

```markdown
# Round {N} 修复记录

## 测试 HTML 修改

| 文件                | 修改内容                   | 维度 | 原因         | 目标分 |
| ------------------- | -------------------------- | ---- | ------------ | ------ |
| tests/T04-auth.html | 表单错误色改为 clay accent | C1   | 使用了纯红色 | ≥ 8    |

## 需要人工审查的技能文档问题

| 问题     | 影响测试 | 建议 |
| -------- | -------- | ---- |
| （如有） |          |      |
```

### E.4 每轮最多修 3 个 critical

避免一次改太多导致回归。优先修改影响多个维度或分数最低的测试。

### E.5 回到 Phase C

修复完成后，`round += 1`，回到 Phase C 重新截图评分。

---

## 最终报告

所有轮次完成后，生成 `FINAL-EVAL-REPORT-v2.md`：

```markdown
# Claude Design Style — 自动化循环评测最终报告 v2

**Date**: {日期}
**评分模型**: qwen3.6-plus（3 次采样取中位数）
**总轮数**: {N}/{MAX_ROUNDS}
**最终状态**: {PASSED / PARTIALLY_PASSED}
**最终均分**: {score}/10

---

## 评测方法

v2 改进：

- 评分模型从 Gemini Flash 换为 Qwen 3.6 Plus，减少评分随机性
- 每维度 3 次采样取中位数，标准差 > 2 的标记为不稳定
- 纯视觉对比评分，不依赖文字 ground truth 描述
- 暗色截图增加验证步骤，确保 CSS 生效后再截图
- 修复范围限制为测试 HTML，技能文档问题仅记录供人工审查

通过标准: 所有维度平均 ≥ 8.0/10，无单项 < 6/10
最大轮数: 3

---

## 轮次进化

| 轮次 | 均分 | critical 数 | minor 数 | 修复数 | 状态 |
| ---- | ---- | ----------- | -------- | ------ | ---- |
| R1   | /10  |             |          | -      |      |
| R2   | /10  |             |          |        |      |
| R3   | /10  |             |          |        |      |

## 分数演进（逐维度平均）

| 维度    | R1  | R2  | R3  | 趋势 | 稳定性            |
| ------- | --- | --- | --- | ---- | ----------------- |
| C1 配色 |     |     |     |      | {stable/unstable} |
| C2 字体 |     |     |     |      |                   |
| C3 按钮 |     |     |     |      |                   |
| C4 间距 |     |     |     |      |                   |
| C5 组件 |     |     |     |      |                   |
| C6 整体 |     |     |     |      |                   |
| D1 暗色 |     |     |     |      |                   |

---

## 逐页最终分数

| Test | 类型    | C1  | C2  | C3  | C4  | C5  | C6  | D1  | AVG | 状态 |
| ---- | ------- | --- | --- | --- | --- | --- | --- | --- | --- | ---- |
| T01  | Landing |     |     |     |     |     |     |     | /10 |      |
| T02  | Article |     |     |     |     |     |     | N/A | /10 |      |
| ...  |         |     |     |     |     |     |     |     |     |      |

---

## 评分稳定性分析

v2 的一个关键指标：3 次采样的标准差。

| Test                      | 维度 | 采样值 | 中位数 | 标准差 | 稳定? |
| ------------------------- | ---- | ------ | ------ | ------ | ----- |
| {列出 std > 1 的所有维度} |      |        |        |        |       |

如果大量维度标准差 > 2，说明即使 Qwen 3.6 Plus 也无法稳定评分，需要重新审视评测维度定义。

---

## 累计修复清单

| 文件 | 修改 | 轮次 | 维度 | 修前分 → 修后分 |
| ---- | ---- | ---- | ---- | --------------- |
|      |      |      |      |                 |

## 需人工审查的技能文档问题

| 问题 | 影响测试 | 建议修改 |
| ---- | -------- | -------- |
|      |          |          |

---

## v1 vs v2 对比

| 指标           | v1 (Gemini Flash) | v2 (Qwen 3.6 Plus) |
| -------------- | ----------------- | ------------------ |
| R1 均分        | 7.27              |                    |
| R3 均分        | 6.90              |                    |
| 趋势           | 越改越差          |                    |
| 单维度最大方差 | 9 → 0（T03 C5）   |                    |
| 暗色 D1 均分   | 1.4               |                    |

---

## 结论

{1-3 句话总结}

---

_Generated by automated eval loop v2 | Qwen 3.6 Plus 4.6 scorer | {N} rounds | {M} total API calls_
```

---

## 执行状态文件

`reports-v2/loop-state.json`（同 v1 结构，用于断点恢复）

---

## 约束

1. **最多 3 轮** — 超过就停止
2. **禁止修改技能文档** — 只改测试 HTML，技能文档问题记录到 skill-issues.md
3. **每轮最多修 3 个 critical** — 避免回归
4. **不修改参考截图** — ground truth 不可变
5. **不使用 observations.md** — 评分完全基于视觉对比，不依赖文字描述
6. **N/A 不参与计算** — 文章页没按钮不扣分，暗色未生效不扣暗色分
7. **暗色截图必须验证** — getComputedStyle 确认背景色变化后才截图
8. **每次评分 3 次采样** — 取中位数，标准差 > 2 标记为 unstable
9. **只修 critical (< 6)** — minor (6-8) 仅记录，不在自动修复范围

---

## 执行命令

```
读取 ~/.claude/skills/claude-design-style/eval/AUTO-EVAL-LOOP-v2.md，按照里面的步骤完整执行。参考截图和测试 HTML 已存在，直接从 Phase C 开始。循环直到通过或达到最大轮数。
```
