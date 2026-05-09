# UX 巡检 Checklist · 7 维 30 条

> 与 `docs/ralph-ux-loop-plan.md` 配套。
> 每张 U2.x 卡跑 `npm run audit:ux -- --page=<id>` 后，按这 30 条逐项核对，列 ≤ 5 个最严重问题修复。
> 一句话一条，便于 grep / diff。

---

## A. PWA（5 条）

| #   | 检查点                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A1  | manifest 解析无 warning（DevTools → Application → Manifest）；`name`/`short_name`/`icons`/`start_url`/`display`/`theme_color` 完整 |
| A2  | Service Worker 升级时浮"刷新"横幅，用户可控触发 `skipWaiting`                                                                      |
| A3  | 离线访问 `/` 能进 `/offline` 页（不是浏览器原生离线页）                                                                            |
| A4  | iOS 启动有 splash screen（`apple-touch-startup-image` 覆盖 6+ 主流分辨率）                                                         |
| A5  | A2HS 安装提示在桌面/Android 可触发；安装后 `display:standalone` 启动                                                               |

## B. Performance（5 条）

| #   | 检查点                                                                 |
| --- | ---------------------------------------------------------------------- |
| B1  | LCP（mobile slow 4G）< 2.5s；首屏不闪两次骨架                          |
| B2  | TBT < 200ms；JS 主路径 chunk < 150KB（gzip 后）                        |
| B3  | CLS < 0.1；字体 swap 用 `display:swap`/`optional` 不留 invisible flash |
| B4  | 列表页千条数据滚动 60fps；不一次性 toArray                             |
| B5  | 图片 / 字体 / icon 已删除未引用大资源；public/ 无 > 500KB 未用文件     |

## C. Accessibility（5 条）

| #   | 检查点                                                                            |
| --- | --------------------------------------------------------------------------------- |
| C1  | axe-core wcag2a/aa/21a/aa 0 critical/serious                                      |
| C2  | 全键盘可达：Tab 顺序合理，无焦点陷阱（modal 内除外）                              |
| C3  | `:focus-visible` 焦点环可见（橘红 2px 描边）                                      |
| C4  | 颜色对比 ≥ 4.5（正文）/ 3（大字 / 图标）；`--text-tertiary` 仅用于装饰            |
| C5  | 表单错误用 `aria-describedby` 关联，非纯红色提示；按钮有 `aria-label` 当只有 icon |

## D. Visual / 设计语言（5 条）

| #   | 检查点                                                                                           |
| --- | ------------------------------------------------------------------------------------------------ |
| D1  | 8px 网格：`padding/margin/gap` 都是 4 / 8 / 12 / 16 / 24 / 32 / 48 之一                          |
| D2  | 圆角统一：`--radius-sm 6px / --radius-md 8px / --radius-lg 12px / --radius-pill 999px`，无随机数 |
| D3  | 阴影统一：`--shadow-sm/md/lg`，不出现 inline 写死 `box-shadow:` 数值                             |
| D4  | 字号 5 档（xs/sm/md/lg/xl）+ 行距 3 档（compact/standard/relaxed）联动                           |
| D5  | 颜色不超出现有 token；正文用 `--text-body`，标题用 `--text-primary`，副文用 `--text-secondary`   |

## E. Mobile（4 条）

| #   | 检查点                                                                      |
| --- | --------------------------------------------------------------------------- |
| E1  | 触摸热区 ≥ 44×44px；TabBar / FAB / 关闭按钮全部达标                         |
| E2  | 安全区：`--safe-bottom` 统一管理；横屏 + 虚拟 home indicator 不偏移         |
| E3  | 键盘弹起不遮挡焦点输入框（iOS focus 后 `scrollIntoView({block:'center'})`） |
| E4  | 手势冲突：PullToRefresh 仅在根滚动触发；卡片左右滑用「角度阈值 + 锁轴」     |

## F. Desktop（3 条）

| #   | 检查点                                                                        |
| --- | ----------------------------------------------------------------------------- |
| F1  | 桌面双栏（≥ 960px）列宽可拖动；hover 状态明显（背景 / 描边 / shadow）         |
| F2  | 键盘快捷键：`Cmd/Ctrl+K` 命令面板、`/` 聚焦搜索、`g w/s/a/h` 切 tab、`?` 帮助 |
| F3  | Header 桌面态 search 仅条件 mount；不出现 hidden 仍可拿到焦点                 |

## G. State（错误 / 空 / 加载 / 离线）（3 条）

| #   | 检查点                                                                                     |
| --- | ------------------------------------------------------------------------------------------ |
| G1  | 空态：插画 / 一句话引导 / 一个 CTA；不是裸文字"暂无数据"                                   |
| G2  | 加载态：骨架卡按视图差异化；不是单一三块灰条                                               |
| G3  | 错误态：HTTP status → 友好文案 + 操作建议（重试 / 切模型 / 看日志），相同错误 dedupe（2s） |

---

## Surface 适用特例

| Surface                    | 特例                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| `wiki` / `library`         | 允许桌面右侧详情空态，但必须有标题、说明和下一步动作线索。           |
| `sources` / `sourceDetail` | 资料元信息可低强调，但正文、时间、类型、来源 badge 仍需满足 C4。     |
| `ask` / `commandPalette`   | 搜索框和组合框必须用键盘闭环验证，不能只依赖鼠标点击截图。           |
| `ingestModal`              | 文件选择器的浏览器原生按钮不纳入视觉一致性，但外层触发和错误态纳入。 |
| `githubSync`               | 未配置凭据时可展示配置缺失态，但 CTA、阶段列表和错误建议必须完整。   |
| `obsidianImport`           | 本地文件权限由浏览器控制，空态和文件队列仍按 G1/G2 检查。            |
| `settings*`                | 危险操作可用红/橘强调，但必须同时有文字、边框或图标区分。            |
| `activity` / `health`      | 统计颜色只能补充状态，状态含义必须可从文字或图标读出。               |
| `sync` / `review`          | 运营页可信息密度更高，但分组、焦点和移动端折叠仍按 C2/E1/F1 检查。   |
| `recap`                    | 手势卡片必须保留可点击后备路径，不能只依赖滑动完成主操作。           |
| `offline`                  | 离线页不得调用在线接口才能显示核心文案、返回入口或恢复建议。         |

---

## Lighthouse / axe rule ↔ checklist 映射

| Lighthouse / axe rule                         | 对应  |
| --------------------------------------------- | ----- |
| `installable-manifest`                        | A1    |
| `splash-screen`                               | A4    |
| `service-worker`                              | A2/A3 |
| `apple-touch-icon`                            | A4    |
| `themed-omnibox`                              | A1    |
| `largest-contentful-paint`                    | B1    |
| `total-blocking-time`                         | B2    |
| `cumulative-layout-shift`                     | B3    |
| `unused-css-rules` / `font-display`           | B5    |
| `tap-targets`                                 | E1    |
| `viewport`                                    | E2    |
| `color-contrast`                              | C4    |
| `aria-required-attr` / `aria-valid-attr`      | C5    |
| `aria-allowed-attr` / `aria-roles`            | C5    |
| `button-name` / `link-name`                   | C5    |
| `image-alt` / `svg-img-alt`                   | C5/G1 |
| `label` / `select-name` / `input-button-name` | C5    |
| `focus-order-semantics` / `tabindex`          | C2    |
| `landmark-one-main` / `region`                | C2/F1 |
| `heading-order`                               | D4/G1 |
| `duplicate-id` / `duplicate-id-aria`          | C5    |
| `nested-interactive`                          | C2/C5 |
| `scrollable-region-focusable`                 | C2/F1 |
| `html-has-lang` / `valid-lang`                | A1/C5 |

---

## 报告填写格式（agent 在 audit 后输出）

```
=== Audit: U2.03 SourcesView ===
Lighthouse  PWA: 92  A11y: 88  BestPractices: 91
axe         critical: 0   serious: 2   moderate: 5
Visual diff mobile: 0.3%   desktop: 0.5%

Top 5 issues to fix this round:
1. [C4] axe color-contrast: .source-meta-time uses --text-tertiary on hover bg → ratio 2.4:1
2. [G2] loading skeleton 用了通用三块条；该改成 source-row 形状
3. [D1] .source-row padding 使用 14px，应改 16px
4. [E1] 删除按钮 32×32px，应 ≥ 44×44px
5. [G1] 空态只有一行字"暂无资料"，缺 CTA

Backlog (this surface, defer):
- [B5] 列表项用 emoji 代替 icon——影响多页，独立卡
- [F1] 桌面双栏列宽不可拖动——全局问题，独立卡
```

输出到 commit body 的"Top 5 fixes"段，便于 review 历史轨迹。
