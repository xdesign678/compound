# Skill 文档问题（供人工审查）

## Issue 1: CSS 暗色模式顺序 Bug

**发现轮次**: Round 1
**影响测试**: T01, T03, T04, T06, T07, T10
**严重程度**: 高（暗色模式完全失效）

### 问题描述

技能生成的所有含暗色模式的测试 HTML 文件均存在相同结构：

```css
/* 错误顺序 */
.dark {
  --bg-primary: #1a1a18;
  /* ... 其他暗色变量 */
}
:root {
  --bg-primary: #faf9f5;
  /* ... 其他浅色变量 */
}
```

`.dark` 选择器（class，优先级 0,1,0）定义在 `:root` 伪类（优先级 0,1,0）之前。由于两者优先级相同，CSS 层叠规则下后者（`:root`）覆盖前者（`.dark`）。即使 `<html>` 元素有 `dark` class，CSS 变量仍然是浅色值。

### 验证方式

```javascript
// 添加 dark class 后
document.documentElement.classList.add('dark');
getComputedStyle(document.documentElement).getPropertyValue('--bg-primary');
// 返回 "#faf9f5" 而非 "#1a1a18" → 证明 .dark 未生效
```

### 建议修复

方案 A（推荐）：将 `.dark` 块移到 `:root` 之后

```css
:root {
  --bg-primary: #faf9f5;
}
.dark {
  --bg-primary: #1a1a18;
}
```

方案 B：提升 `.dark` 优先级

```css
html.dark {
  --bg-primary: #1a1a18;
}
```

### 影响

- D1 暗色模式评分在所有受影响测试中均标记为 SKIP
- 暗色模式功能性完全失效，用户体验断裂
