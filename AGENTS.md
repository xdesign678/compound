# 仓库协作约定

- **以后所有修改一律直接在 `main` 分支上进行，不要新建分支，也不要走 PR 流程。**
- 开始工作前先确认当前分支是 `main`（`git rev-parse --abbrev-ref HEAD` 应返回 `main`）；若不在 `main`，先 `git checkout main` 再修改。
- 完成改动后直接 `git commit` 并 `git push origin main`，不要创建功能分支或 PR。
- 仅在用户明确要求时，才可以新建分支或开 PR。

## Build performance tracking

- 运行 `npm run build:measure`（即 `node scripts/measure-build.mjs`）来执行 `next build` 并记录耗时、`.next/cache` 命中情况以及 `.next/static` 产物大小。
- 指标会写入 `tmp/build-metrics.json`（已在 `.gitignore` 中忽略），脚本的退出码与 `next build` 保持一致。
- 在 GitHub Actions 中，`.next/cache` 通过 `actions/cache@v4` 按 `package-lock.json` 与源码哈希缓存，命中即可加速重复构建；指标文件会作为 `build-metrics` 产物上传，并写入当次 job 的 Step Summary。
