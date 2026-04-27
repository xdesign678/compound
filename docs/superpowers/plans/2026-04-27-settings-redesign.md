# 设置页重构（分 Tab + 字号调整）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将设置页从单长列表重构为 3 Tab 响应式布局（桌面端左右分栏 / 移动端分段控制），并新增 5 档正文字号调整功能。

**Architecture:** Zustand store 新增 `fontSize` 状态，通过 CSS 变量 `--prose-font-size` 驱动 `.prose` 和 `.source-editor-content` 的字号。SettingsDrawer 拆分为壳子 + 3 个 Tab 子组件。桌面端 ≥768px 使用左侧导航列表，移动端使用分段控制。

**Tech Stack:** React 18 / Next.js 15 / Zustand 5 / CSS 变量 / localStorage

**Spec:** `docs/superpowers/specs/2026-04-27-settings-redesign-design.md`

---

## 文件结构

| 文件                                       | 操作 | 职责                                                                                     |
| ------------------------------------------ | ---- | ---------------------------------------------------------------------------------------- |
| `lib/store.ts`                             | 修改 | 新增 `FontSize` 类型、`fontSize` 状态、`setFontSize`、`hydrateFontSize`、`FONT_SIZE_MAP` |
| `app/globals.css`                          | 修改 | 新增 `--prose-font-size` CSS 变量；`.prose`、`.source-editor-content` 引用该变量         |
| `app/layout.tsx`                           | 修改 | `<head>` 防闪烁脚本中增加字号恢复                                                        |
| `app/page.tsx`                             | 修改 | 顶层 effect 调用 `hydrateFontSize()`                                                     |
| `components/settings/FontSizeSelector.tsx` | 新建 | 5 档预设按钮组组件                                                                       |
| `components/settings/GeneralTab.tsx`       | 新建 | 通用 Tab：颜色模式 + 字号 + 首页样式                                                     |
| `components/settings/ModelTab.tsx`         | 新建 | 模型 Tab：LLM 配置 + 访问保护                                                            |
| `components/settings/DataTab.tsx`          | 新建 | 数据 Tab：Wiki 维护 + 数据管理                                                           |
| `components/SettingsDrawer.tsx`            | 重写 | 壳子：overlay + header + 响应式 Tab 导航 + 渲染当前 Tab                                  |

---

### Task 1: Zustand store 新增字号状态

**Files:**

- Modify: `lib/store.ts`

- [ ] **Step 1: 在 store.ts 顶部新增 FontSize 类型和映射常量**

在 `export type ColorMode = 'light' | 'dark' | 'system';` 下方添加：

```typescript
export type FontSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export const FONT_SIZE_MAP: Record<FontSize, { label: string; px: number }> = {
  xs: { label: '小', px: 14 },
  sm: { label: '较小', px: 15 },
  md: { label: '中', px: 16 },
  lg: { label: '较大', px: 18 },
  xl: { label: '大', px: 20 },
};
```

- [ ] **Step 2: 新增 readStoredFontSize 辅助函数和 applyFontSize 函数**

在 `function applyColorMode(mode: ColorMode)` 上方添加：

```typescript
function readStoredFontSize(): FontSize {
  if (typeof window === 'undefined') return 'md';
  const raw = localStorage.getItem('compound_font_size');
  if (raw && raw in FONT_SIZE_MAP) return raw as FontSize;
  return 'md';
}

function applyFontSize(size: FontSize) {
  if (typeof window === 'undefined') return;
  const px = FONT_SIZE_MAP[size].px;
  document.documentElement.style.setProperty('--prose-font-size', `${px}px`);
}
```

- [ ] **Step 3: 在 AppState 接口中新增字号字段和方法**

在 `colorMode: ColorMode;` 行下方添加：

```typescript
fontSize: FontSize;
```

在 `hydrateColorMode: () => void;` 行下方添加：

```typescript
setFontSize: (size: FontSize) => void;
hydrateFontSize: () => void;
```

- [ ] **Step 4: 在 store 实现中新增初始值和方法**

在 `colorMode: 'light',` 行下方添加：

```typescript
fontSize: 'md',
```

在 `hydrateColorMode` 实现下方添加：

```typescript
setFontSize: (size) => {
  localStorage.setItem('compound_font_size', size);
  applyFontSize(size);
  set({ fontSize: size });
},
hydrateFontSize: () => {
  const size = readStoredFontSize();
  applyFontSize(size);
  set({ fontSize: size });
},
```

- [ ] **Step 5: 运行类型检查确认无误**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无 store.ts 相关错误

- [ ] **Step 6: Commit**

```bash
git add lib/store.ts
git commit -m "feat(store): add fontSize state with 5 presets and localStorage persistence"
```

---

### Task 2: CSS 变量和字号样式

**Files:**

- Modify: `app/globals.css`

- [ ] **Step 1: 在 :root 中声明 --prose-font-size 变量**

在 `app/globals.css` 的 `:root {` 块中（找到其他 `--` 变量附近），添加：

```css
--prose-font-size: 16px;
```

- [ ] **Step 2: 修改 .prose 基础字号，使用 CSS 变量**

找到第 857 行附近的 `.prose` 规则：

```css
.prose {
  font-family: var(--font-reading);
  font-size: 17px;
  line-height: var(--leading-relaxed);
```

将 `font-size: 17px;` 改为：

```css
font-size: var(--prose-font-size, 16px);
```

- [ ] **Step 3: 修改 .prose h2、h3、code 用 calc() 基于变量缩放**

注意：`.prose h1` 不需要修改，因为 Markdown 正文中极少出现 h1（概念页标题是页面级 `<h1>`，不在 `.prose` 内）。如果需要，可在 `.concept-body-prose h1` 中添加，但目前 spec 的作用范围不要求。

找到第 944 行附近的 `.prose h2` 规则，将 `font-size: 24px;` 改为：

```css
font-size: calc(var(--prose-font-size, 16px) * 1.5);
```

找到第 952 行附近的 `.prose h3` 规则，将 `font-size: 18px;` 改为：

```css
font-size: calc(var(--prose-font-size, 16px) * 1.25);
```

找到第 967 行附近的 `.prose code` 规则，将 `font-size: 13.5px;` 改为：

```css
font-size: calc(var(--prose-font-size, 16px) * 0.875);
```

- [ ] **Step 4: 修改 .source-editor-content 字号使用 CSS 变量**

找到第 1373 行附近的 `.source-editor-content` 规则，将 `font-size: 17px;` 改为：

```css
font-size: var(--prose-font-size, 16px);
```

- [ ] **Step 5: 修改第 4293 行附近的重复 prose 样式声明**

找到第 4293 行附近的：

```css
.prose,
.note-editor-content,
.msg-user,
.msg-ai-body {
  font-family: var(--font-reading);
  font-size: 17px;
```

将 `font-size: 17px;` 改为：

```css
font-size: var(--prose-font-size, 16px);
```

- [ ] **Step 6: 运行构建确认 CSS 无语法错误**

Run: `npx next build 2>&1 | tail -5`
Expected: 构建成功

- [ ] **Step 7: Commit**

```bash
git add app/globals.css
git commit -m "feat(css): wire prose and editor font-size to --prose-font-size CSS variable"
```

---

### Task 3: 防闪烁脚本和初始化

**Files:**

- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: 在 layout.tsx 的 head 防闪烁脚本中加入字号恢复**

找到 `app/layout.tsx` 第 81 行的 `dangerouslySetInnerHTML` 内联脚本，在 `} catch(e) {}` 之前插入字号恢复逻辑。完整脚本变为：

```javascript
`
  try {
    var theme = localStorage.getItem('compound_theme');
    if (theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
    var fs = localStorage.getItem('compound_font_size');
    var fsMap = {xs:14,sm:15,md:16,lg:18,xl:20};
    if (fs && fsMap[fs]) {
      document.documentElement.style.setProperty('--prose-font-size', fsMap[fs] + 'px');
    }
  } catch(e) {}
`;
```

- [ ] **Step 2: 在 page.tsx 的顶层 effect 中调用 hydrateFontSize**

找到 `app/page.tsx` 第 92 行附近的 `hydrateHomeStyle();`，在其下方添加一行：

首先在第 82 行附近的 store hooks 中新增：

```typescript
const hydrateFontSize = useAppStore((s) => s.hydrateFontSize);
```

然后在 `useEffect` 中 `hydrateHomeStyle();` 行后面添加：

```typescript
hydrateFontSize();
```

并把 `hydrateFontSize` 加入 effect 的依赖数组 `[hydrateHomeStyle, hydrateFontSize]`。

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/page.tsx
git commit -m "feat: add font-size FOUC prevention and hydration on mount"
```

---

### Task 4: FontSizeSelector 组件

**Files:**

- Create: `components/settings/FontSizeSelector.tsx`

- [ ] **Step 1: 创建 components/settings/ 目录**

Run: `mkdir -p components/settings`

- [ ] **Step 2: 创建 FontSizeSelector.tsx**

```tsx
'use client';

import { useAppStore, FONT_SIZE_MAP, type FontSize } from '@/lib/store';

const FONT_SIZES: FontSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

export function FontSizeSelector() {
  const fontSize = useAppStore((s) => s.fontSize);
  const setFontSize = useAppStore((s) => s.setFontSize);

  return (
    <div className="settings-segmented settings-segmented-five">
      {FONT_SIZES.map((size) => (
        <button
          key={size}
          className={fontSize === size ? 'active' : ''}
          onClick={() => setFontSize(size)}
          aria-label={`字号: ${FONT_SIZE_MAP[size].label}`}
          style={{ fontSize: `${Math.max(11, FONT_SIZE_MAP[size].px - 4)}px` }}
        >
          {FONT_SIZE_MAP[size].label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 在 globals.css 中添加 .settings-segmented-five 样式**

在 `.settings-segmented-three` 规则下方添加：

```css
.settings-segmented-five {
  grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
}
```

- [ ] **Step 4: 运行类型检查**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add components/settings/FontSizeSelector.tsx app/globals.css
git commit -m "feat: create FontSizeSelector preset button group component"
```

---

### Task 5: GeneralTab 组件

**Files:**

- Create: `components/settings/GeneralTab.tsx`

- [ ] **Step 1: 创建 GeneralTab.tsx**

这个组件提取了原 SettingsDrawer 中的颜色模式和首页样式控件，加入字号选择器。

```tsx
'use client';

import { useAppStore, type ColorMode } from '@/lib/store';
import { FontSizeSelector } from './FontSizeSelector';

export function GeneralTab() {
  const homeStyle = useAppStore((s) => s.homeStyle);
  const setHomeStyle = useAppStore((s) => s.setHomeStyle);
  const colorMode = useAppStore((s) => s.colorMode);
  const setColorMode = useAppStore((s) => s.setColorMode);

  return (
    <div className="settings-tab-content">
      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">颜色模式</div>
          <div className="settings-card-desc">浅色、深色或跟随系统</div>
        </div>
        <div className="settings-segmented settings-segmented-three">
          {(['light', 'dark', 'system'] as ColorMode[]).map((mode) => (
            <button
              key={mode}
              className={colorMode === mode ? 'active' : ''}
              onClick={() => setColorMode(mode)}
            >
              {mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '系统'}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">正文字号</div>
          <div className="settings-card-desc">调整 Wiki 和资料详情页阅读字号</div>
        </div>
        <FontSizeSelector />
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">首页样式</div>
          <div className="settings-card-desc">动态流或分类知识库</div>
        </div>
        <div className="settings-segmented">
          <button
            className={homeStyle === 'feed' ? 'active' : ''}
            onClick={() => setHomeStyle('feed')}
          >
            动态流
          </button>
          <button
            className={homeStyle === 'library' ? 'active' : ''}
            onClick={() => setHomeStyle('library')}
          >
            知识库
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 运行类型检查**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add components/settings/GeneralTab.tsx
git commit -m "feat: create GeneralTab with color mode, font size, and home style"
```

---

### Task 6: ModelTab 组件

**Files:**

- Create: `components/settings/ModelTab.tsx`

- [ ] **Step 1: 创建 ModelTab.tsx**

从原 SettingsDrawer 中提取 LLM 配置和访问保护部分。这两个功能的状态和逻辑保持不变，仅迁移到独立文件。

```tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import {
  fetchCustomModels,
  getLlmConfig,
  modelLabel,
  PRESET_MODELS,
  rememberCustomModelOnServer,
  saveLlmConfig,
} from '@/lib/llm-config';
import { clearAdminToken, getAdminToken, saveAdminToken } from '@/lib/admin-auth-client';
import type { LlmConfig } from '@/lib/types';
import { Icon } from '../Icons';

export function ModelTab() {
  const showToast = useAppStore((s) => s.showToast);

  const [llmConfig, setLlmConfig] = useState<LlmConfig>({});
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [llmAdvancedExpanded, setLlmAdvancedExpanded] = useState(false);
  const [llmSaved, setLlmSaved] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [adminSaved, setAdminSaved] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    setLlmConfig(getLlmConfig());
    setAdminToken(getAdminToken());
    void fetchCustomModels()
      .then(setCustomModels)
      .catch(() => setCustomModels([]));
    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);

  async function saveLlm() {
    saveLlmConfig(llmConfig);
    const model = llmConfig.model?.trim();
    if (model) {
      const models = await rememberCustomModelOnServer(model).catch(() => customModels);
      setCustomModels(models);
    }
    setLlmSaved(true);
    safeTimeout(() => setLlmSaved(false), 2000);
  }

  function saveAdmin() {
    saveAdminToken(adminToken);
    setAdminSaved(true);
    safeTimeout(() => setAdminSaved(false), 2000);
  }

  function clearAdmin() {
    clearAdminToken();
    setAdminToken('');
    setAdminSaved(true);
    safeTimeout(() => setAdminSaved(false), 2000);
  }

  return (
    <div className="settings-tab-content">
      {/* LLM 配置 */}
      <div className="settings-card-head">
        <div className="settings-card-icon">
          <Icon.Sparkle />
        </div>
        <div>
          <div className="settings-card-title">LLM 配置</div>
          <div className="settings-card-desc">
            默认使用 Zeabur 服务端配置；可临时覆盖当前浏览器的模型。
          </div>
        </div>
      </div>

      <div className="settings-fields">
        <label className="settings-field">
          <span>模型</span>
          <input
            type="text"
            placeholder="anthropic/claude-sonnet-4.6"
            value={llmConfig.model || ''}
            onChange={(e) => setLlmConfig((c) => ({ ...c, model: e.target.value }))}
          />
        </label>

        <div className="settings-preset-row">
          {[...PRESET_MODELS.map((item) => item.value), ...customModels].map((model) => (
            <button
              key={model}
              className={`settings-preset${llmConfig.model === model ? ' active' : ''}`}
              title={model}
              onClick={() => setLlmConfig((c) => ({ ...c, model }))}
            >
              {modelLabel(model)}
            </button>
          ))}
        </div>

        <div className="settings-advanced-block">
          <button
            className="settings-inline-toggle"
            type="button"
            aria-expanded={llmAdvancedExpanded}
            onClick={() => setLlmAdvancedExpanded((value) => !value)}
          >
            <span>高级配置</span>
            <span>{llmAdvancedExpanded ? '收起' : '展开'}</span>
          </button>

          {!llmAdvancedExpanded && (
            <div className="settings-inline-note">API Key 与 API URL 默认跟随服务端配置。</div>
          )}

          {llmAdvancedExpanded && (
            <>
              <label className="settings-field">
                <span>API Key</span>
                <input
                  type="password"
                  placeholder="sk-... 或 OpenRouter key"
                  value={llmConfig.apiKey || ''}
                  onChange={(e) => setLlmConfig((c) => ({ ...c, apiKey: e.target.value }))}
                />
              </label>

              <label className="settings-field">
                <span>
                  API URL <em>可选</em>
                </span>
                <input
                  type="text"
                  placeholder="https://openrouter.ai/api/v1/chat/completions"
                  value={llmConfig.apiUrl || ''}
                  onChange={(e) => setLlmConfig((c) => ({ ...c, apiUrl: e.target.value }))}
                />
              </label>
            </>
          )}
        </div>

        <button className="modal-btn primary settings-primary-action" onClick={saveLlm}>
          {llmSaved ? '已保存 ✓' : '保存配置'}
        </button>
      </div>

      {/* 访问保护 */}
      <div className="settings-tab-divider" />

      <div className="settings-card-head">
        <div className="settings-card-icon">
          <Icon.Settings />
        </div>
        <div>
          <div className="settings-card-title">访问保护</div>
          <div className="settings-card-desc">
            服务端开启 ADMIN_TOKEN 后，在这里保存同一个密钥。
          </div>
        </div>
      </div>

      <div className="settings-fields">
        <label className="settings-field">
          <span>Admin Token</span>
          <input
            type="password"
            placeholder="与服务端 ADMIN_TOKEN 保持一致"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
          />
        </label>

        <div className="settings-action-row">
          <button className="modal-btn primary" onClick={saveAdmin}>
            {adminSaved ? '已保存 ✓' : '保存访问密钥'}
          </button>
          <button className="modal-btn settings-secondary-action" onClick={clearAdmin}>
            清除
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 在 globals.css 中添加 .settings-tab-divider 样式**

在 `.settings-tool-row-flat` 规则下方添加：

```css
.settings-tab-divider {
  height: 1px;
  background: var(--border-section);
  margin: 16px 0;
}
```

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add components/settings/ModelTab.tsx app/globals.css
git commit -m "feat: create ModelTab with LLM config and admin token"
```

---

### Task 7: DataTab 组件

**Files:**

- Create: `components/settings/DataTab.tsx`

- [ ] **Step 1: 创建 DataTab.tsx**

从原 SettingsDrawer 中提取 Wiki 维护和数据管理部分。

```tsx
'use client';

import { useState, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppStore } from '@/lib/store';
import { lintWiki } from '@/lib/api-client';
import { getDb } from '@/lib/db';
import { SEED_SOURCES, SEED_CONCEPTS, SEED_ACTIVITY } from '@/lib/seed';
import type { LintResponse } from '@/lib/types';
import { Icon } from '../Icons';

export function DataTab({ onClose }: { onClose: () => void }) {
  const openConcept = useAppStore((s) => s.openConcept);
  const showToast = useAppStore((s) => s.showToast);
  const hideToast = useAppStore((s) => s.hideToast);
  const clearFresh = useAppStore((s) => s.clearFresh);

  const [lintResult, setLintResult] = useState<LintResponse | null>(null);
  const [lintLoading, setLintLoading] = useState(false);
  const [confirming, setConfirming] = useState<'seed' | 'clear' | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  async function handleLint() {
    setLintLoading(true);
    setLintResult(null);
    showToast('AI 正在体检 Wiki...', true);
    try {
      const res = await lintWiki();
      setLintResult(res);
      showToast(
        res.findings.length === 0 ? 'Wiki 结构健康' : `发现 ${res.findings.length} 处建议`,
        false,
      );
      safeTimeout(() => hideToast(), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`体检失败: ${msg}`, false, true);
    } finally {
      setLintLoading(false);
    }
  }

  async function loadSeed() {
    const db = getDb();
    await db.sources.bulkPut(SEED_SOURCES);
    await db.concepts.bulkPut(SEED_CONCEPTS);
    await db.activity.bulkPut(SEED_ACTIVITY);
    setConfirming(null);
    onClose();
    showToast('示例 Wiki 已载入 · 9 个概念, 5 份资料', false);
    setTimeout(() => hideToast(), 3000);
  }

  async function clearAll() {
    const db = getDb();
    await db.sources.clear();
    await db.concepts.clear();
    await db.activity.clear();
    await db.askHistory.clear();
    clearFresh();
    setLintResult(null);
    setConfirming(null);
    onClose();
    showToast('已清空所有数据', false);
    safeTimeout(() => hideToast(), 2500);
  }

  return (
    <div className="settings-tab-content">
      {/* Wiki 维护 */}
      <div className="settings-card-head">
        <div className="settings-card-icon">
          <Icon.Lint />
        </div>
        <div>
          <div className="settings-card-title">Wiki 维护</div>
          <div className="settings-card-desc">体检结构问题，找出矛盾和缺失链接。</div>
        </div>
      </div>

      <div className="settings-tool-row settings-card-head-adjacent">
        <div>
          <div className="settings-tool-title">Lint · Wiki 体检</div>
          <div className="settings-card-desc">找出矛盾、孤立页和缺失链接</div>
        </div>
        <button className="modal-btn primary" onClick={handleLint} disabled={lintLoading}>
          {lintLoading ? '体检中...' : '运行 Lint'}
        </button>
      </div>

      {lintResult && (
        <div className="settings-lint-results">
          {lintResult.findings.length === 0 ? (
            <div className="settings-lint-empty">未发现问题 · Wiki 结构健康</div>
          ) : (
            lintResult.findings.map((f, idx) => (
              <div
                key={idx}
                className={`settings-lint-finding${idx === lintResult.findings.length - 1 ? ' last' : ''}`}
              >
                <div className="settings-lint-finding-type">
                  {f.type === 'contradiction'
                    ? '矛盾'
                    : f.type === 'orphan'
                      ? '孤立'
                      : f.type === 'missing-link'
                        ? '缺失链接'
                        : '重复'}
                </div>
                <div className="settings-lint-finding-msg">{f.message}</div>
                <div className="settings-lint-finding-chips">
                  {f.conceptIds.map((cid) => (
                    <ConceptChip
                      key={cid}
                      id={cid}
                      onClick={() => {
                        onClose();
                        openConcept(cid);
                      }}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 数据管理 */}
      <div className="settings-tab-divider" />

      <div className="settings-card-head">
        <div className="settings-card-icon">
          <Icon.Trash />
        </div>
        <div>
          <div className="settings-card-title">数据管理</div>
          <div className="settings-card-desc">
            示例数据可随时载入；清空会删除本机资料、概念和问答记录。
          </div>
        </div>
      </div>

      {confirming === 'seed' ? (
        <div className="settings-confirm-block">
          <p className="modal-desc">
            载入 9 个示例概念页 + 5 份资料(围绕 Karpathy LLM Wiki 主题)? 会添加到你现有 Wiki。
          </p>
          <button className="modal-btn primary" onClick={loadSeed}>
            确认载入
          </button>
          <button
            className="modal-btn"
            style={{ marginTop: 6 }}
            onClick={() => setConfirming(null)}
          >
            取消
          </button>
        </div>
      ) : confirming === 'clear' ? (
        <div className="settings-confirm-block settings-confirm-danger">
          <p className="modal-desc" style={{ color: 'var(--brand-clay)' }}>
            确认清空所有资料、概念页、问答记录和活动日志? 本操作不可撤销。
          </p>
          <button
            className="modal-btn primary"
            style={{ background: 'var(--brand-clay)' }}
            onClick={clearAll}
          >
            确认清空
          </button>
          <button
            className="modal-btn"
            style={{ marginTop: 6 }}
            onClick={() => setConfirming(null)}
          >
            取消
          </button>
        </div>
      ) : (
        <div className="settings-data-actions">
          <button
            className="modal-btn settings-secondary-action"
            onClick={() => setConfirming('seed')}
          >
            载入示例 Wiki
          </button>
          <button className="modal-btn danger" onClick={() => setConfirming('clear')}>
            清空所有数据
          </button>
        </div>
      )}
    </div>
  );
}

function ConceptChip({ id, onClick }: { id: string; onClick: () => void }) {
  const concept = useLiveQuery(async () => getDb().concepts.get(id), [id]);
  if (!concept) return null;
  return (
    <button onClick={onClick} className="settings-concept-chip">
      {concept.title}
    </button>
  );
}
```

- [ ] **Step 2: 在 globals.css 中添加 DataTab 相关辅助样式**

在 `.settings-tab-divider` 下方添加：

```css
.settings-tab-content {
  padding: 4px 0 0;
}
.settings-card-head-adjacent {
  border-top: none;
  padding-top: 0;
}
.settings-lint-results {
  padding: 10px 0;
  border-top: 1px solid var(--border-section);
}
.settings-lint-empty {
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 13px;
}
.settings-lint-finding {
  padding: 10px 0;
  border-bottom: 1px solid var(--border-section);
}
.settings-lint-finding.last {
  border-bottom: none;
}
.settings-lint-finding-type {
  font-family: var(--font-sans);
  font-size: 11px;
  color: var(--brand-clay);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}
.settings-lint-finding-msg {
  font-family: var(--font-sans);
  font-size: 13.5px;
  color: var(--text-primary);
  margin-bottom: 6px;
}
.settings-lint-finding-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.settings-concept-chip {
  background: var(--bg-muted);
  padding: 4px 10px;
  border-radius: 6px;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--text-primary);
  border: none;
  cursor: pointer;
}
.settings-confirm-block {
  padding: 4px 0;
}
.settings-confirm-danger {
  padding: 14px;
  border: 1px solid rgba(201, 100, 66, 0.34);
  border-radius: 8px;
  background: rgba(201, 100, 66, 0.06);
}
.settings-data-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
}
```

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add components/settings/DataTab.tsx app/globals.css
git commit -m "feat: create DataTab with wiki lint and data management"
```

---

### Task 8: 重写 SettingsDrawer 壳子（响应式 Tab 导航）

**Files:**

- Rewrite: `components/SettingsDrawer.tsx`

- [ ] **Step 1: 重写 SettingsDrawer.tsx**

```tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { GeneralTab } from './settings/GeneralTab';
import { ModelTab } from './settings/ModelTab';
import { DataTab } from './settings/DataTab';

export type SettingsTabId = 'general' | 'model' | 'data';

const TABS: { id: SettingsTabId; label: string; icon: string }[] = [
  { id: 'general', label: '通用', icon: '🎨' },
  { id: 'model', label: '模型', icon: '✨' },
  { id: 'data', label: '数据', icon: '🗄️' },
];

export function SettingsDrawer() {
  const isOpen = useAppStore((s) => s.settingsOpen);
  const close = useAppStore((s) => s.closeSettings);
  const hydrateColorMode = useAppStore((s) => s.hydrateColorMode);

  const [activeTab, setActiveTab] = useState<SettingsTabId>('general');
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hydrateColorMode();
  }, [hydrateColorMode]);

  useEffect(() => {
    const el = modalRef.current;
    if (!el || !isOpen) return;
    el.focus({ preventScroll: true });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = el.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close]);

  return (
    <div className={`modal-overlay ${isOpen ? 'visible' : ''}`} onClick={close}>
      <div
        className="modal settings-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-drawer-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-handle" />

        {/* Header */}
        <div className="settings-hero">
          <div>
            <div className="settings-kicker">Compound 设置</div>
            <h3 id="settings-drawer-title">设置</h3>
          </div>
          <button className="settings-close-btn" onClick={close} aria-label="关闭设置">
            关闭
          </button>
        </div>

        {/* 响应式导航 + 内容 */}
        <div className="settings-layout">
          {/* 桌面端侧栏导航（≥768px 显示） */}
          <nav className="settings-sidebar" role="tablist" aria-label="设置分类">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`settings-sidebar-item${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="settings-sidebar-icon">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="settings-main">
            {/* 移动端分段控制（<768px 显示） */}
            <div className="settings-mobile-tabs">
              <div className="settings-segmented settings-segmented-three">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    className={activeTab === tab.id ? 'active' : ''}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab 内容 */}
            <div className="settings-panel">
              {activeTab === 'general' && <GeneralTab />}
              {activeTab === 'model' && <ModelTab />}
              {activeTab === 'data' && <DataTab onClose={close} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 在 globals.css 中添加响应式布局样式**

在 `.settings-data-actions` 规则块下方添加：

```css
/* Settings responsive layout */
.settings-layout {
  display: flex;
  flex-direction: column;
}
.settings-sidebar {
  display: none;
}
.settings-mobile-tabs {
  margin-bottom: 10px;
}
.settings-main {
  flex: 1;
  min-width: 0;
}
.settings-panel {
  padding: 0;
}

/* Desktop: sidebar + content */
@media (min-width: 768px) {
  .settings-modal {
    max-width: 640px;
  }
  .settings-layout {
    flex-direction: row;
    gap: 0;
    min-height: 380px;
  }
  .settings-sidebar {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 140px;
    flex-shrink: 0;
    padding: 0 6px 0 0;
    border-right: 1px solid var(--border-section);
    margin-right: 16px;
  }
  .settings-sidebar-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    width: 100%;
  }
  .settings-sidebar-item:hover {
    background: var(--bg-muted);
  }
  .settings-sidebar-item.active {
    background: var(--bg-muted);
    color: var(--text-primary);
    font-weight: 650;
  }
  .settings-sidebar-icon {
    font-size: 14px;
    width: 20px;
    text-align: center;
  }
  .settings-mobile-tabs {
    display: none;
  }
}
```

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add components/SettingsDrawer.tsx app/globals.css
git commit -m "feat: rewrite SettingsDrawer with responsive 3-tab layout"
```

---

### Task 9: 清理和验证

**Files:**

- Review: all modified files

- [ ] **Step 1: 删除 SettingsDrawer.tsx 中已不需要的旧 inline-style 常量 S**

确认新的 SettingsDrawer.tsx 不再引用常量 `S`。由于 Task 8 是完全重写，旧的 `S` 对象和 `ConceptChip` 辅助组件已经被移除。确认文件中不再有 `const S = {` 块。

- [ ] **Step 2: 运行完整类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 运行所有测试**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 4: 运行构建**

Run: `npx next build 2>&1 | tail -10`
Expected: 构建成功

- [ ] **Step 5: 手动验证清单**

在浏览器中验证以下功能：

1. 打开设置页 → 默认显示「通用」Tab
2. 切换到「模型」Tab → LLM 配置和访问保护正常显示
3. 切换到「数据」Tab → Lint 按钮和数据管理正常显示
4. 在「通用」Tab 中切换字号 → 关闭设置 → 打开任意概念详情页 → 正文字号已变化
5. 在「通用」Tab 中切换字号 → 关闭设置 → 打开任意资料详情页 → 编辑器字号已变化
6. 刷新页面后字号偏好仍然生效（无闪烁）
7. 颜色模式切换仍正常
8. 首页样式切换仍正常
9. 缩小浏览器窗口到 <768px → 导航变为分段控制
10. 放大浏览器窗口到 ≥768px → 导航变为左右分栏

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: cleanup and verify settings redesign"
```
