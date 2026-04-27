# Claude Design Style 评测执行 Prompt

将此 prompt 交给独立代理执行。

---

## 任务

你要对 `claude-design-style` 技能进行全面评测。流程：生成 10 个测试页面 → 用固定评估器打分 → 输出分数矩阵和诊断报告。

## 关键约束

1. 每个测试页面必须调用 `/claude-design-style` 技能生成（不要手写样式）
2. 评估器 `~/.claude/skills/claude-design-style/eval/run_eval.py` 是**不可修改的**
3. 生成的 HTML 保存到 `~/.claude/skills/claude-design-style/eval/tests/` 目录
4. 文件命名格式：`T01-landing.html`, `T02-article.html`, ...

## 执行步骤

### Step 1: 逐一生成 10 个测试页面

对每个测试，先调用 claude-design-style 技能，然后按 prompt 生成纯 HTML 页面，保存到 tests/ 目录。

**T01-landing.html** -- 企业官网首页

```
用 Claude 设计风格创建一个 AI 公司的官网首页。包含：
- 顶部导航栏（Logo + 5个链接 + 主CTA按钮）
- Hero 区域（大标题 + 副标题 + 两个按钮）
- 4个特性卡片网格
- 客户 Logo 展示区（6个灰度Logo占位）
- 底部 Footer（3列链接 + 版权）
要求支持暗色模式切换，纯 HTML + CSS + 少量 JS，单文件，不用框架。
```

**T02-article.html** -- 长文博客页

```
用 Claude 设计风格创建一篇关于"AI安全研究"的博客文章页。包含：
- 导航栏
- 文章标题（sans字体）、作者、发布日期
- 正文（serif字体，至少3个段落）
- 一个代码块（带语言标签）
- 一个引用块（blockquote）
- 一个有序列表
- 1张图片占位符（带圆角）
- 底部导航（上一篇/下一篇链接）
内容最大宽度 640px，阅读体验优先。纯 HTML + CSS，单文件。
```

**T03-pricing.html** -- 定价页

```
用 Claude 设计风格创建一个 SaaS 产品的定价页。包含：
- 页面标题和副标题
- 3个定价方案卡片（Free / Pro / Enterprise），Pro 为推荐方案（颜色反转：暗色背景+浅色CTA按钮）
- 每个卡片：名称、月价格、5条特性列表、CTA按钮
- 下方 FAQ 手风琴（4个问题，用 grid-template-rows: 0fr/1fr 实现展开收起）
要求支持暗色模式切换。纯 HTML + CSS + 少量 JS，单文件。
```

**T04-auth.html** -- 登录/注册表单

```
用 Claude 设计风格创建一个登录页面。包含：
- 居中的表单卡片（白色背景，圆角8px）
- Email 输入框（展示正常态+错误态样式）
- 密码输入框（展示正常态+成功态样式）
- "记住我"复选框
- 登录按钮（主按钮样式）
- Google / GitHub OAuth 按钮（次按钮样式）
- "忘记密码？"和"创建账户"链接
同时展示三种验证状态：正常、错误（红色边框+提示）、成功（绿色边框）。
支持暗色模式。纯 HTML + CSS，单文件。
```

**T05-chat.html** -- AI 聊天界面

```
用 Claude 设计风格创建一个 AI 聊天界面。包含：
- 左侧会话列表侧边栏（宽度约260px，可折叠）
- 右侧聊天区域，消息最大宽度 768px 居中：
  - 1条用户消息
  - 1条AI已完成消息
  - 1条AI正在生成的消息（带闪烁光标动画，用 cursor-blink 关键帧）
- AI 正在思考的三点加载动画（thinking-dots）
- 底部输入区域（文本框 + 发送按钮）
纯 HTML + CSS + 少量 JS（侧边栏折叠），单文件。
```

**T06-dashboard.html** -- 仪表盘设置页

```
用 Claude 设计风格创建一个应用设置页面。包含：
- 左侧导航菜单（5个分类：个人资料/通知/外观/安全/账户）
- 右侧内容区：
  - 个人信息表单（姓名输入框、邮箱输入框）
  - 3个通知开关（Toggle 组件）
  - 语言选择（Select 下拉框）
  - 主题选择（Radio 按钮组：浅色/暗色/跟随系统）
- 状态 Badge 标签（活跃/待验证/已禁用，三种样式）
- 保存按钮
- Toast 成功通知（右上角，自动消失动画）
支持暗色模式。纯 HTML + CSS + JS，单文件。
```

**T07-states.html** -- 空状态+加载态+错误页

```
用 Claude 设计风格创建一个 UI 状态展示页，垂直排列以下 4 个区域，每个区域用标题分隔：
1. Skeleton 加载态：3个骨架屏卡片（skeleton-pulse 动画 2s）
2. 空状态："暂无项目"（48px图标 + 标题 + 描述文字 + "创建项目"CTA按钮）
3. 404 错误页：大号"404"数字 + "页面不存在"描述 + "返回首页"按钮
4. Toast 通知区：成功（绿）/错误（红）/警告（橙）三种 Toast
5. 页面底部加一个 Spinner 加载指示器（0.8s旋转）
支持暗色模式。纯 HTML + CSS，单文件。
```

**T08-components.html** -- 组件展示页

```
用 Claude 设计风格创建一个组件库展示页，依次展示以下组件，每个配标题说明：
1. 代码块：带语言标签头栏 + 复制按钮 + 代码内容
2. Modal 弹窗：点击按钮打开，含标题/正文/取消+确认按钮，overlay 背景
3. Dropdown 下拉菜单：点击按钮展开，3个选项
4. Tooltip 提示：hover 显示，箭头指向触发元素
5. Tab 标签切换：3个标签页，点击切换内容
6. 数据表格：5行3列，表头加粗，行 hover 高亮，排序箭头图标
纯 HTML + CSS + JS，单文件。
```

**T09-mobile.html** -- 移动端响应式页

```
用 Claude 设计风格创建一个移动端优先的页面（默认视口 375px 设计）。包含：
- viewport meta 标签（width=device-width, initial-scale=1.0, viewport-fit=cover）
- 汉堡菜单图标（点击展开全屏导航，用 clip-path: circle() 动画）
- 一段文章内容（标题+2段正文）
- 带验证的表单（姓名+邮箱+提交按钮）
- 底部固定操作按钮（带 env(safe-area-inset-bottom) padding）
- 所有可交互元素最小 44px 高度
- 所有输入框 font-size: 16px（防止 iOS 缩放）
- @media (prefers-reduced-motion: reduce) 关闭所有动画
纯 HTML + CSS + JS，单文件。
```

**T10-darkmode.html** -- 暗色模式全覆盖

```
用 Claude 设计风格创建一个暗色模式展示页，默认暗色主题（class="dark"）。包含以下组件的暗色版本：
- 导航栏（暗底 #1a1a18）+ 搜索输入框
- 2张内容卡片（bg #232320, border rgba(236,233,225,0.08)）
- 3种按钮：主按钮（bg #ece9e1, text #1a1a18）、次按钮、Ghost按钮
- 表单输入框（含一个错误验证态，验证色用 #f87171 而非 #dc2626）
- 代码块（bg #2a2a27）
- 2条聊天消息（用户+AI）
- 一段 serif 正文（color #ece9e1）
- 右上角主题切换按钮（暗色↔浅色）
验证所有颜色在暗色模式下的正确反转。纯 HTML + CSS + JS，单文件。
```

### Step 2: 逐一评分

对每个生成的 HTML 文件运行评估器：

```bash
cd ~/.claude/skills/claude-design-style/eval
python3 run_eval.py tests/T01-landing.html --test-id T01 --verbose
python3 run_eval.py tests/T02-article.html --test-id T02 --verbose
python3 run_eval.py tests/T03-pricing.html --test-id T03 --verbose
python3 run_eval.py tests/T04-auth.html --test-id T04 --verbose
python3 run_eval.py tests/T05-chat.html --test-id T05 --verbose
python3 run_eval.py tests/T06-dashboard.html --test-id T06 --verbose
python3 run_eval.py tests/T07-states.html --test-id T07 --verbose
python3 run_eval.py tests/T08-components.html --test-id T08 --verbose
python3 run_eval.py tests/T09-mobile.html --test-id T09 --verbose
python3 run_eval.py tests/T10-darkmode.html --test-id T10 --verbose
```

或者批量执行：

```bash
python3 run_eval.py --batch tests/ --json > results.json
python3 run_eval.py --batch tests/
```

### Step 3: 生成评测报告

将所有分数汇总为 Markdown 报告，保存到 `~/.claude/skills/claude-design-style/eval/EVAL-REPORT.md`：

```markdown
# Claude Design Style 评测报告

## 总览

- 日期: {今天日期}
- 综合平均分: {xx.x}/100

## 分数矩阵

| 测试     | D1 Token | D2 反模式 | D3 排版 | D4 布局 | D5 响应式 | D6 组件 | 综合分 |
| -------- | -------- | --------- | ------- | ------- | --------- | ------- | ------ |
| T01      |          |           |         |         |           |         |        |
| T02      |          |           |         |         |           |         |        |
| ...      |          |           |         |         |           |         |        |
| T10      |          |           |         |         |           |         |        |
| **平均** |          |           |         |         |           |         |        |

## 行分析（页面类型弱项）

{哪些页面得分低，为什么}

## 列分析（维度弱项）

{哪些维度普遍低分，技能在哪方面指导不足}

## Top 5 失分项

1. ...
2. ...

## 改进建议

{基于失分项，给出具体的 SKILL.md 或 references/\*.md 修改建议}
```

## 重要提示

- 生成页面时，prompt 中**不要包含任何具体的 CSS 值**（如颜色代码、字体大小），让技能自行决定——这才是在测试技能的指导能力
- 如果某个页面生成失败或不完整，记录原因并继续下一个
- 评估器的正则匹配是基于内联 `<style>` 标签的 CSS，确保生成的 HTML 将样式写在 `<style>` 而非外部文件
- 每个 HTML 文件必须是完整的单文件（包含 `<!DOCTYPE html>`, `<head>`, `<body>`）
