# Code quality metrics

The repository tracks code quality with two local commands that also run in CI.

| Command                   | What it measures                                                                         | Output                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run test:coverage`   | Node-side test coverage for `lib/*.ts` modules                                           | `tmp/coverage/coverage-summary.json`, `tmp/coverage/coverage-summary.md` |
| `npm run quality:metrics` | Function complexity and maintainability across `app`, `components`, `lib`, and `scripts` | `tmp/quality-metrics.json`, `tmp/quality-metrics.md`                     |

The default gates are intentionally modest so the checks can start tracking the current codebase without blocking normal work on day one:

| Gate                            |                               Default |
| ------------------------------- | ------------------------------------: |
| Line coverage                   |      `COMPOUND_COVERAGE_MIN_LINES=30` |
| Max function complexity         |         `COMPOUND_MAX_COMPLEXITY=120` |
| Minimum file maintainability    |      `COMPOUND_MIN_MAINTAINABILITY=0` |
| Minimum average maintainability | `COMPOUND_MIN_AVG_MAINTAINABILITY=30` |

CI uploads both reports as artifacts and writes the Markdown summaries into the GitHub Actions step summary, so regressions are visible without opening local files.
