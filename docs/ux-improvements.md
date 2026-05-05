# 体验优化待办计划

> 最后更新：2026-05-06
> 来源：一次「体验向」全面巡检的产出
> 范围：覆盖性能 / 首屏 / 交互 / 错误反馈 / 移动端 / 桌面端 / 可访问性 / 编辑器 / PWA

每条任务给出问题位置 + 改进方向，按 **影响最直接 → 隐性退化** 排序。

---

## 已完成 ✅

- [x] **Toast 错误反馈支持一键重试**（commit `0f585a4`）
  - `lib/store.ts` 新增 `showErrorToast(text, retry?, retryLabel?)`
  - `components/Toast.tsx` 渲染 `.toast-retry` 按钮，重试中锁住
  - 接入主要失败入口：摄入笔记、归档答案、启动修复、启动深度检查、自动归类、Lint 体检、选段建页

---

## P0 · 高优 · 还没动

### 1. 列表虚拟化 + 干掉冗余 `toArray()`

| 位置                               | 问题                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `components/views/LibraryView.tsx` | `getDb().concepts.orderBy('updatedAt').reverse().toArray()` 一次性把全部概念塞进内存，再 `slice(0, visibleCount)` |
| `components/views/SourcesView.tsx` | 同上 + `conceptCountBySource` 对每条 source 都 `where('sources').equals(id).count()`，N+1                         |
| `components/views/RecapView.tsx`   | `getDb().concepts.toArray()` 全量加载                                                                             |
| `components/views/HealthView.tsx`  | `concepts.toArray()` 全量加载                                                                                     |
| `components/views/WikiView.tsx`    | 同时存在 `concepts`(分页) + `totalConceptCount` + `allConceptsForReview`(全量) + `totalMatches` 四个 useLiveQuery |

**改进方向**

- 列表用 `limit + offset` 分页加载；或引入 `react-window` 做虚拟列表。
- `unreviewedCount` 改成 `concepts.where('reviewed').equals(0).count()` 或服务端预聚合，不要再 `toArray`。
- `conceptCountBySource` 改成一次 `concepts.toArray()` 后建 `Map<sourceId, number>`，或服务端 snapshot 提前算好。
- 把 review 计数下沉到 store 单独维护；或者用 dexie 索引 + `count()` 查。

### 2. 摄入 / 长任务任务中心

| 位置                         | 问题                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `components/IngestModal.tsx` | 用户提交后 `close()` + `showToast('AI 正在分析...', loading=true)`，整个流程是单条阻塞 toast |
| `lib/store.ts` 单 slot toast | 多次摄入并行时后一条 toast 直接覆盖前一条                                                    |

**改进方向**

落到一个全局「任务中心」：右下角浮窗显示当前所有 ingest / lint / repair / categorize 的状态、进度、失败重试。失败时保留原始输入，让用户一键重做。

### 3. 离线 / 断网状态

| 位置                | 问题                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 整个 app            | 没有任何 `online/offline` 监听 + 全局横幅提示                                                                    |
| `lib/api-client.ts` | catch 后统一抛 `网络连接失败`，但用户不知道是「整体断网」还是「单次请求失败」                                    |
| `public/sw.js`      | navigation 失败时 `caches.match('/')` 拿到的是缓存版本，看起来仿佛一切正常但是数据卡住，没有 offline fallback 页 |

**改进方向**

- 监听 `navigator.onLine`，离线时所有写操作（ingest / lint / repair）显式 disable，并在顶栏显示「离线模式 · 仅本地查看」。
- 增加 `/offline` 页用于 SW 兜底。

---

## P1 · 中优

### 4. 视图懒加载首切顿挫

`app/page.tsx` 全部视图都 `dynamic(..., { ssr: false })` 且没有 prefetch。第一次切 Tab 必须下 chunk → 出现明显空白/骨架闪烁。

**改进方向**

- 用户 hover/focus tab 时 `import()` 预热。
- 或对 Wiki / Library / Sources 这三个高频视图改为静态导入。

### 5. 首屏 / 字体加载

| 位置                                 | 问题                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `app/layout.tsx`                     | 同时 `next/font/google` 加载 4 套字体（Inter / JetBrains Mono / Lora / Noto Serif SC），后两个对中文界面影响明显 |
| `public/icon-ai.png`、`icon-ai2.png` | 各 ~830KB+ 直接放 public，但代码里没引用                                                                         |
| `app/page.tsx` `mounted` 双重骨架    | bootShell（骨架） → mounted 后再次渲染骨架 → 再渲染数据，闪烁两次                                                |
| `public/sw.js` cache name            | 用 `compound-v8` 手填版本号，每次升级容易忘记 bump                                                               |

**改进方向**

- 拆成「正文主用 1 套 + 标题 1 套」，把 Lora 和 Noto Serif SC 中的一种用 `display:'optional'` 或彻底去掉。
- 删除未引用的大图，或改用 `next/image` 引导式加载。
- `if (!ready) { return renderPrimaryView(...) }` 直接给骨架一次。
- cache name 拼上 `process.env.NEXT_PUBLIC_BUILD_ID` 或文件 hash。

### 6. 错误文案 / Toast 体验

| 位置                                             | 问题                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `IngestModal`、`AskView`、`ConceptDetail` 等多处 | 把后端 message 截前 80/160 字符塞进 toast，用户看到 `请求失败 (502)` 这种内容毫无操作建议     |
| `lib/store.ts` 单 slot toast                     | 多条 toast 不能堆叠，loading toast 被后续 toast 覆盖                                          |
| `components/Prose.tsx`                           | 遇到无效 wiki-link 直接 `showToast(未找到 "xxx", isError)`，连点几次会触发多个红色 toast 闪烁 |

**改进方向**

- 统一封装：`error code → 友好文案 + 操作 (重试/打开设置/查看日志)`。
- Toast 队列：成功/错误可堆叠，loading 单独 slot。
- 对相同错误做 dedupe / debounce。

### 7. 富文本 / 编辑器

| 位置                                   | 问题                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `components/views/SourceDetail.tsx`    | 用 `document.execCommand`（已弃用）做加粗/标题/列表，浏览器实现差异大                                                   |
| `htmlToMarkdown` 自己实现的 DOM 序列化 | 容易和真实 markdown 偏差（如代码块内嵌套）                                                                              |
| `components/NoteEditor.tsx`            | "第一行 = 标题"耦合进 onDone，使用 `lines.slice(firstIdx + 1)` 推断正文，但最终又用 `trimmed` 全文当 body，逻辑上易出错 |
| `NoteEditor` 草稿 key                  | 单 slot，写第二条笔记时第一条草稿被覆盖                                                                                 |

**改进方向**

- 引入轻量编辑器（tiptap / lexical / milkdown），或者把所见即所得退化成纯 markdown + Live Preview。
- NoteEditor 显式拆 title 输入；草稿按 id 多 slot 保存。

### 8. 桌面端命令面板 + 快捷键

桌面端是知识库的核心入口，但目前完全没有快捷键支持。

**改进方向**

- 全局命令面板 `Cmd/Ctrl + K`：搜索概念、跳转、新建笔记。
- `/`：聚焦搜索；`g w/s/a/h`：切 Tab；`?`：打开帮助；`n`：新建。
- 桌面双栏（`shouldShowDesktopDetail`）支持「列宽可拖动」。
- Library 选中分类 + 右侧列表的关联视图增加「点选概念时高亮所属分类」。

### 9. 空态 / Onboarding 引导

| 位置                     | 问题                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `app/page.tsx` 自动 seed | 第一次进入自动 `bulkPut` SEED\_\*，但用户既看不到"这是示例"，也没法一键清空示例切换到空 Wiki |
| 各视图空态               | Library 空态只让用户去点 +                                                                   |
| 设置入口                 | Settings → 数据 选项很丰富，但首次用户找不到入口（汉堡按钮里）                               |

**改进方向**

- 进入空库时弹一个引导卡 → "导入示例 / 从 Obsidian 导入 / 从 GitHub 同步 / 直接开始"。
- 空态补"先连 GitHub / 一键导入示例 / 粘贴一段网页"三选一。

### 10. 移动端 / iOS 细节

| 位置                              | 问题                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ViewportObserver.tsx` | textarea `focus` 后没有 `scrollIntoView({block:'center'})`，iOS 上键盘上来时焦点经常被遮挡                                                          |
| `tabbar` / `.fab` 安全区          | 用 `env(safe-area-inset-bottom)`，但 `.fab` 用了 `bottom: calc(72px + env(safe-area-inset-bottom))` —— iPad 横屏 + 虚拟 home indicator 下偏移会过大 |
| `components/PullToRefresh.tsx`    | 在 `<textarea>`/可滚动列表中触发，因为 `onTouchStart` 看 `el.scrollTop`，但当用户在 modal 内手指下拉，全局 listener 仍会响应                        |
| `components/views/RecapView.tsx`  | 阻止纵向滚动逻辑只判断 `Math.abs(dx) >= Math.abs(dy)`，斜向滑容易被误判                                                                             |

**改进方向**

- 焦点滚到中心。
- 安全区合并为 CSS 变量统一管理。
- PullToRefresh 判断 `if (!isRootScroll) return`。
- Recap 用「角度阈值 + 锁轴」模式。

### 11. 交互细节 / 动效

| 位置                                         | 问题                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `components/views/RecapView.tsx`             | 拖动中没限制 `pointer-events`，左右滑过程中点击会触发"深入阅读"按钮                                     |
| `components/SwipeBack.tsx`                   | 触发条件 `dx > MIN_DISTANCE (60)` 较低，结合 iOS 系统侧滑容易冲突                                       |
| `components/PullToRefresh.tsx`               | 触发完成后强制 600ms 隐藏指示器，但 `onRefresh` 是异步的——用户看到指示器消失却数据还没回来              |
| `components/Header.tsx`                      | `header-search-btn` 用 `is-visible` class 切显示，但 hover/focus 在 `aria-hidden=true` 时仍可能拿到焦点 |
| `components/IngestModal.tsx`                 | 不响应 `Escape` 关闭；`SettingsDrawer` 响应。键盘体验不一致                                             |
| `components/views/AskView.tsx`               | inline `@` 触发 lookup 没缓存，用户长输入会反复打 dexie                                                 |
| `components/TabBar.tsx` 中间 + 按钮          | `wiki/sources` 视图右下角又放了 FAB。两套入口指向同一个 modal                                           |
| 选区气泡（`SourceDetail` / `ConceptDetail`） | 在窄屏被裁切，且不响应 `keyboard-only` 用户                                                             |

**改进方向**

- 拖动中给子节点加 `pointer-events:none`。
- SwipeBack 放宽到 80px + 增加 `velocity` 判断。
- PullToRefresh `await onRefresh()` 完成后再隐藏。
- Header search 按条件 mount。
- 所有 modal 统一响应 `Escape`。
- Ask 输入用 LRU/swr 缓存 mention lookup。
- 桌面端去掉 FAB 或合并入口。
- 选区气泡支持键盘触发。

### 12. 滚动恢复 / 回退体感

| 位置                                      | 问题                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `LibraryView` / `SourcesView` `scrollTop` | 通过 store 持久化，但跳到详情页再返回时 `useLayoutEffect` 仅在 `concepts` 第一次到位时恢复一次；如果 dexie 触发二次 update，会跳回 |
| `components/views/AskView.tsx`            | 每次 `history.length` 变就 `scrollTop = scrollHeight`，但用户向上翻历史时也会被强行拉到底                                          |

**改进方向**

- 保存 scrollTop 后用 `IntersectionObserver` 找到当前看到的卡片 id，恢复时锚定 id 而不是像素。
- AskView 只在「在底部 50px 内」时才自动跟随。

### 13. 详情页选区监听重复绑定

`ConceptDetail` / `SourceDetail` 都监听 `selectionchange + scroll`：两个详情页同时挂载（桌面双栏）会有重复绑定。

**改进方向**

提取成共享 hook + 单实例。

---

## P2 · 打磨

### 14. 可访问性 / 键盘

| 位置                                      | 问题                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| 若干 div 充当 button                      | `recap-entry-card`、`a-title` (innerHTML) 等没有 `role="button"` / `tabindex` |
| `SettingsDrawer` 移动端 segmented control | 只有视觉文字，缺 `role="tab"` / `aria-controls`                               |
| 颜色对比                                  | `var(--text-tertiary)` 在浅色背景上对比度临界                                 |
| `.fab`                                    | 没有 focus-visible 状态                                                       |
| prose 嵌入英文段                          | 缺 `lang="en"`，朗读体验差                                                    |

### 15. 视觉 / 节奏

- 字号档位 5 档 + 行距 5 档共享同一组变量；用户调成"大字号 + 紧凑行距"会粘在一起。可以让两个值之间存在最低留白联动。
- 列表骨架卡只有"标题/卡片/卡片"三块固定形状，可按视图差异化（Library 网格 / Sources 列表 / Ask 对话）。
- `WikiView` 顶部"刚更新"分组只有标题不带数量，可以加角标 `(3)`。
- Library 二级 chip 有 chevron icon 但点击后箭头不变方向，少了一个微反馈。

### 16. 国际化 / 文案

- 整套 UI 是中文硬编码，未来要英文需要大改。
- 顶部 brand "X WIKI" 与文档说的 "Compound" 不一致。
- 错误文案里的「请稍后再试」太多次，缺乏具体可执行步骤（"打开设置 / 切换模型 / 查看 /sync 日志"）。

### 17. 安全 / 隐私

- LLM 配置（含 apiKey）存 `localStorage`，登出/共用电脑时残留。
  - 设置里加"清除本地 LLM 凭据"按钮（DataTab 大概率有，可检查是否显眼）。
  - 默认把 apiKey 存到 sessionStorage，在 GeneralTab 可勾选"记住"。
- `lib/format.ts` 中 marked 设置 `breaks:false`，对国内用户的 markdown 习惯（无空行换行）不太友好，可以提供"严格 / 宽松"切换。

---

## 推荐落地顺序

| 顺序      | 任务                         | 风险  | 预期收益               |
| --------- | ---------------------------- | ----- | ---------------------- |
| ✅ 已完成 | Toast 错误重试               | 低    | 即时                   |
| 1         | 桌面端命令面板 + 快捷键 (#8) | 低    | 桌面体验立即上一个台阶 |
| 2         | 离线 / 断网提示 (#3)         | 低    | 用户安全感             |
| 3         | 视图预热 + 字体精简 (#4 #5)  | 低    | 首屏更顺               |
| 4         | 空态 Onboarding (#9)         | 中    | 留存关键               |
| 5         | 任务中心 (#2)                | 中    | 重塑长任务体验         |
| 6         | 列表虚拟化 (#1)              | 中-高 | 1k 概念后必须          |
| 7         | 编辑器替换 (#7)              | 高    | 长期债务               |

---

## 备忘

- 全程在 `main` 直接提交（参见 `AGENTS.md`），不开 PR。
- 每项较大改动后立即 `npm run typecheck && npm run lint && npm run test` 再 commit。
- 改动若涉及 `app/api/**`，记得 `npm run docs:api` 同步 API 文档。
