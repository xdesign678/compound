# Profiling

Compound has three local profiling paths: Node CPU profiles for build-time
work, Clinic.js flame graphs for the production server, and Node heap profiles
for memory pressure. Outputs are written under `tmp/profiles/`, which is
ignored by Git.

## Build CPU profile

Run:

```bash
npm run profile:build
```

This runs `scripts/measure-build.mjs` with Node's `--cpu-prof` enabled. It
still produces `tmp/build-metrics.json` and additionally writes `.cpuprofile`
files under `tmp/profiles/build/`. Open those files in Chrome DevTools when
`next build` slows down or a dependency/config change causes build-time CPU
spikes.

## Server flame graph

First build the app, then run:

```bash
npm run build
npm run profile:server
```

Open the app or run a small load test against `http://localhost:3000`, reproduce
the slow path, then stop the process with `Ctrl+C`. Clinic.js will write the
server flame graph under `tmp/profiles/server/`. This is the preferred runtime
profile for slow API routes, sync jobs, or expensive page rendering.

## Build heap profile

Run:

```bash
npm run profile:heap:build
```

This runs the measured build with Node's `--heap-prof` enabled and writes
`.heapprofile` files under `tmp/profiles/heap/`. Open those files in Chrome
DevTools or another V8 heap viewer when memory usage grows unexpectedly during
builds.

## Drift check

Run:

```bash
npm run validate:profiling
```

The validator confirms that the profiling dependency, npm scripts, docs and
ignored output paths still line up. `npm run check` runs it automatically.
