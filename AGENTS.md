# 仓库协作约定

- 默认不要新建分支。未得到用户明确要求时，直接在当前分支上修改。
- 只有在改动范围很大，或当前工作区状态复杂、直接修改可能误伤现有内容时，才先说明原因，再建议新建分支。

## Build performance tracking

- 运行 `npm run build:measure`（即 `node scripts/measure-build.mjs`）来执行 `next build` 并记录耗时、`.next/cache` 命中情况以及 `.next/static` 产物大小。
- 指标会写入 `tmp/build-metrics.json`（已在 `.gitignore` 中忽略），脚本的退出码与 `next build` 保持一致。
- 在 GitHub Actions 中，`.next/cache` 通过 `actions/cache@v4` 按 `package-lock.json` 与源码哈希缓存，命中即可加速重复构建；指标文件会作为 `build-metrics` 产物上传，并写入当次 job 的 Step Summary。
