# 内部审计归档

这些 HTML 报告和截图原先放在 `public/`，随后又进过 git 跟踪目录，生产环境仍可被匿名读取。
它们只用于内部复盘，不属于产品静态资源，已从当前跟踪树移除。

- 本目录不进入 Next.js `public/` 部署产物。
- 副本只保留在本机忽略的 `.swarm/runs/` 归档中，不随仓库公开。
- 旧 URL（如 `/ux-audit.html`、`/compound-audit-20260512.html`）应变为 404。
- `public/workbox-7144475a.js` 与 `public/swe-worker-development.js` 仍保留，待旧客户端 Service Worker 兼容验证后再清理。
