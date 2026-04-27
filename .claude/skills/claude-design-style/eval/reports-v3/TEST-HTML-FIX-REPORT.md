# Test HTML Fix Report

修复时间：2026-04-05

## 修复概述

对 10 个测试 HTML 页面进行了三类系统性修复，以提升 L2 视觉评分。

---

## 逐文件修改记录

### T01-landing.html

- **字体修复**：将 Google Fonts 链接由 `Inter` 改为 `Noto Serif SC`，并新增 Geist Sans/Mono CDN（jsdelivr）
- **暗色模式**：添加 `prefers-color-scheme: dark` 自动检测脚本（原有 `.dark` 选择器和手动切换按钮已正确存在）

### T02-article.html

- **字体修复**：将 Google Fonts 链接由 `Inter` 改为 `Noto Serif SC`，并新增 Geist Sans/Mono CDN
- **暗色模式**：新增完整 `.dark` CSS 变量块（原文件无暗色支持），添加 `body` 过渡动画，添加 `prefers-color-scheme` 自动检测脚本

### T03-pricing.html

- **字体修复**：将 Google Fonts 链接由 `Inter` 改为 `Noto Serif SC`，并新增 Geist Sans/Mono CDN
- **暗色模式**：添加 `prefers-color-scheme: dark` 自动检测脚本（原有 `.dark` 选择器正确）

### T04-auth.html

- **字体修复**：将 Google Fonts 链接由 `Inter` 改为 `Noto Serif SC`，并新增 Geist Sans/Mono CDN
- **暗色模式**：添加 `prefers-color-scheme: dark` 自动检测脚本（原有 `.dark` 选择器正确，验证色 `#b85b44`/`#5a856a` 已正确）

### T05-chat.html

- **字体修复**：将 Google Fonts 链接由 `Inter` 改为 `Noto Serif SC`，并新增 Geist Sans/Mono CDN
- **暗色模式**：添加 `prefers-color-scheme: dark` 自动检测脚本（原有 `.dark` 选择器正确）

### T06-dashboard.html

- **字体修复**：将 Google Fonts 链接由 `Inter` 改为 `Noto Serif SC`，并新增 Geist Sans/Mono CDN
- **暗色模式**：添加 `prefers-color-scheme: dark` 自动检测脚本（原有 `.dark` 选择器正确）

### T07-states.html

- **字体修复**：将 Google Fonts 链接由 `Inter` 改为 `Noto Serif SC`，并新增 Geist Sans/Mono CDN
- **暗色模式**：添加 `prefers-color-scheme: dark` 自动检测脚本（原有 `.dark` 选择器正确）
- **组件细节**：修复 toast-error 颜色从 `#e05252`（纯红）改为 `#b85b44`（暖色 error），`.toast-error` 背景和边框色同步修正

### T08-components.html

- **字体修复**：将 Google Fonts 链接由 `Inter` 改为 `Noto Serif SC`，并新增 Geist Sans/Mono CDN
- **暗色模式**：新增完整 `.dark` CSS 变量块（原文件无暗色支持），添加 `body` 过渡动画，添加 `prefers-color-scheme` 自动检测脚本

### T09-mobile.html

- **字体修复**：将 Google Fonts 链接由 `Inter` 改为 `Noto Serif SC`，并新增 Geist Sans/Mono CDN
- **暗色模式**：新增完整 `.dark` CSS 变量块（原文件无暗色支持），添加 `body` 过渡动画，添加 `prefers-color-scheme` 自动检测脚本
- **组件细节**：修复 `.error-msg` 颜色从 `#e05252` 改为 `#b85b44`，修复 JS 中内联 `borderColor` 同步更正

### T10-darkmode.html

- **字体修复**：将 Google Fonts 链接由 `Inter` 改为 `Noto Serif SC`，并新增 Geist Sans/Mono CDN
- **暗色模式**：T10 默认以暗色模式渲染（HTML 标签带 `class="dark"`），脚本调整为：若系统为浅色则移除 dark class，若系统为暗色则保留；原有 `.dark` 选择器和所有暗色值均正确

---

## 统计汇总

| 类别         | 修复数量 | 涉及文件                                                        |
| ------------ | -------- | --------------------------------------------------------------- |
| 字体加载修复 | 10       | T01–T10（全部）                                                 |
| 暗色模式修复 | 10       | T01–T10（T02/T08/T09 新增 `.dark` 块，其余新增自动检测脚本）    |
| 组件细节修复 | 3        | T07（toast-error 颜色）、T09（error-msg 颜色 + JS borderColor） |

### 字体修复详情

- **全部 10 个文件**：移除 `Inter` Google Fonts，改为 `Noto Serif SC`（正确中文衬线字体）
- **全部 10 个文件**：新增 Geist Sans（`geist@1.3.1`）和 Geist Mono CDN 链接
- CSS 中字体栈引用已正确（`Geist, Inter, system-ui` 用于 UI/标题，`Lora, "Noto Serif SC"` 用于正文）

### 暗色模式修复详情

- **T02、T08、T09**：原文件缺少 `.dark` CSS 变量块，新增标准暗色 token：`bg-primary: #1a1a18`，`text-primary: #ece9e1`，按钮反转
- **T01、T03、T04、T05、T06、T07、T10**：原有 `.dark` 选择器正确，补充 `prefers-color-scheme` 自动检测
- **T10**：特殊处理——默认暗色，系统浅色时自动切换回亮色

### 组件细节修复详情

- `error` 颜色统一为暖色 `#b85b44`（T07 toast-error，T09 error-msg 及 JS inline）
- 其余组件细节（border-radius: 7.5px、card shadow、背景色 `#faf9f5`、文字色 `#141413`）在各文件中已正确，无需改动
