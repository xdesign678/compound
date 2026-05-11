---
name: output-webpage
description: Use when the user asks to output a webpage, generate HTML, make a plan/report/summary into a readable visual page, create an HTML preview, publish a static page, find or verify a Zeabur preview URL, or says 输出网页, 生成网页, 做成HTML, 网页预览, 可视化网页, 推送到 GitHub, Zeabur 预览, Zeabur 地址.
---

# Output Webpage

Turn a plan, report, summary, audit result, or long agent output into a polished static webpage that a non-technical reader can understand on a phone.

## Defaults

- Audience: non-technical reader unless the user names another audience.
- Language: write the generated page content, headings, explanations, and final delivery summary in Chinese by default. Use another language only when the user explicitly asks for it.
- Design: use `claude-design-style` for warm, restrained, reading-focused HTML/CSS.
- Target: if the repo has `public/`, publish `public/<slug>.html`; otherwise use `docs/<slug>.html`.
- Delivery: for Git repos, commit the generated page; push when the user asked for GitHub, online preview, Zeabur, or a shareable link.
- Zeabur: when Zeabur is requested, run the Zeabur URL discovery/deploy flow below. Do not stop at "the repo does not mention a Zeabur URL" until those checks have been attempted.
- Zeabur default gate: if this skill is used for a repo that already has a discoverable Zeabur/live host, treat live deployment verification as required by default, even if the user only said "输出网页" or "用网页生成技能". Skip this gate only when the user explicitly says local-only, no deploy, no push, or no online preview.

## Workflow

1. **Load design guidance**
   - Read `claude-design-style/SKILL.md` before writing page CSS.
   - Use its reading-page pattern: warm cream background, serif body copy, sans headings/UI, subtle borders, restrained motion, no decorative blobs.

2. **Collect source material**
   - Read the plan/report/source file or summarize the current conversation output.
   - If the request refers to "刚才那个结果" and no artifact is named, inspect recent commits/docs before asking.
   - Extract: conclusion, why it matters, what changed, evidence/validation, risks, next steps, links or commit hashes.

3. **Rewrite for readability**
   - Lead with the plain conclusion.
   - Explain technical terms the first time they appear.
   - Prefer "这意味着..." and "你可以这样理解..." style explanations over raw implementation jargon.
   - Keep visible page copy in Chinese by default, including navigation labels, section titles, summaries, captions, and status text.
   - Do not leave English placeholder copy in the finished page unless it is a command, file path, product name, commit hash, or quoted source text.
   - Keep evidence concrete: commands run, files produced, screenshots, commits, deployed URL.

4. **Build the page**
   - For standalone HTML, start from `assets/readable-page-template.html`.
   - Include a sticky or top navigation with anchor jumps.
   - Use mobile-first layout, safe-area padding, readable line length, horizontal scrolling only for unavoidable tables.
   - Use cards only for repeated items or evidence blocks; do not nest cards.
   - Add sections in this order unless the source strongly suggests another structure:
     1. 一句话结论
     2. 为什么重要
     3. 做了什么
     4. 怎么证明
     5. 风险和注意事项
     6. 下一步

5. **Validate locally**
   - Open the page in a browser or with Playwright.
   - Check mobile and desktop widths.
   - Verify nav anchors jump correctly, text does not overlap, tables/buttons fit, and the page is not visually blank.
   - If the repo has a normal gate for static docs/pages, run it. For Next repos, also run the relevant `npm run` checks when the page is under app-served paths.

6. **Commit, push, deploy, and preview**
   - Run `git status --short` first and protect unrelated user changes.
   - Stage only files created or modified for this webpage.
   - Commit with a message like `docs: publish <topic> preview page`.
   - Push when online preview was requested or expected.
   - Before final reply, decide whether the Zeabur default gate applies. If a Zeabur host is discoverable in the repo or known from the current task, it applies.
   - If Zeabur or another deployment URL is known, probe the live URL after push and do not claim deployment until it responds with the new page title/content.
   - Do not send the final answer with only a local file path when the Zeabur default gate applies. The final answer must include either a verified live URL or the exact blocker that prevented verification.

7. **Zeabur URL discovery and deployment**
   - First search repo-local sources for an existing Zeabur URL or deployment note: `README*`, `docs/`, `package.json`, `Dockerfile`, `nginx.conf`, `.github/`, `.codex/`, `.agents/`, and public HTML files. Useful patterns: `zeabur`, `zeabur.app`, `ZEABUR`, `deploy`, `deployment`, `domain`, `PUBLIC_URL`, `APP_URL`.
   - If a URL is found, derive the expected page path from the published HTML path, then probe it with `curl -I` and a normal GET.
   - After a push, poll the expected live page for the new title or a unique content string before declaring success. Try at least 3 times with short waits if the host initially serves stale content.
   - If the bare path is stale or cached, also try a cache-busting query such as `?v=<short-commit-sha>` and verify that URL if it serves the new content.
   - If no URL is found, try the official Zeabur CLI before asking the user:
     - `npx zeabur@latest deployment get`
     - `npx zeabur@latest service ls`
     - `npx zeabur@latest deployment log -t=build`
     - `npx zeabur@latest deployment log -t=runtime`
   - If the user explicitly asked to deploy to Zeabur and the current repo is the deployable service, run `npx zeabur@latest deploy` when CLI authentication is available. Capture the service URL printed by the CLI and verify the generated page on that URL.
   - If the CLI requires login, token, project selection, or service selection, report exactly which command reached that point and ask for the Zeabur service URL or permission/credentials to complete `npx zeabur@latest auth login --token <token>`.
   - If the CLI fails in a headless shell with `xdg-open` or `failed to open browser`, do not stop immediately. First continue with any repo-discovered URL, GitHub deployment metadata if available, and direct `curl` polling of the expected page.
   - Treat `524`, timeout, stale title, or missing page content as "deployment not verified yet". Check `deployment get` and logs, retry after a short wait, and report the latest observed status instead of claiming success.

## Quality Checklist

- The first viewport says what the page is and why it matters.
- A phone reader can understand the story without reading code.
- Navigation anchors are visible and useful.
- Technical proof is present but not overwhelming.
- The design follows `claude-design-style` and avoids generic SaaS/dashboard styling.
- If a Zeabur host is discoverable, the live URL has been probed after push and matched against the new page title or unique content.
- Zeabur requests include either a verified live URL, the captured CLI service URL plus current deployment status, or a clear list of attempted discovery commands and the missing auth/URL needed.
- Final response includes the local file path, commit hash, pushed branch, and live preview URL if verified.

## Git Safety

- Never revert unrelated dirty files.
- Never include secrets, tokens, or private environment values in the page.
- If the working tree is dirty, mention that only the webpage files were staged.
- If live deployment is delayed, report the pushed commit and the last checked URL/status instead of pretending it is live.
- If Zeabur auth is unavailable, do not invent a URL. Exhaust repo search and safe CLI status commands first, then ask for the URL or auth path.
