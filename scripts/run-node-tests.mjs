import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.cwd();
const libDir = path.join(root, 'lib');
const outDir = path.join(root, 'node_modules', '.cache', 'compound-node-tests');
const coverageDir = path.join(root, 'tmp', 'coverage');
const coverageRawDir = path.join(coverageDir, 'v8');
const coverageSummaryPath = path.join(coverageDir, 'coverage-summary.json');
const coverageMarkdownPath = path.join(coverageDir, 'coverage-summary.md');
const coverageEnabled = process.argv.includes('--coverage');
const testFiles = readdirSync(libDir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => path.join('lib', name));
const sourceFiles = coverageEnabled
  ? readdirSync(libDir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .sort()
      .map((name) => path.join('lib', name))
  : [];

if (testFiles.length === 0) {
  console.log('No node-side tests found.');
  process.exit(0);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
if (coverageEnabled) {
  rmSync(coverageDir, { recursive: true, force: true });
  mkdirSync(coverageRawDir, { recursive: true });
}

const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const tsc = spawnSync(
  npxBin,
  [
    'tsc',
    '--outDir',
    outDir,
    '--rootDir',
    '.',
    '--module',
    'commonjs',
    '--moduleResolution',
    'node',
    '--target',
    'es2022',
    '--lib',
    'es2022,dom',
    '--esModuleInterop',
    '--skipLibCheck',
    ...sourceFiles,
    ...testFiles,
  ],
  {
    cwd: root,
    stdio: 'inherit',
  },
);

if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1);
}

const compiledTests = testFiles.map((file) => path.join(outDir, file.replace(/\.ts$/, '.js')));
const nodeArgs = ['--test'];
if (coverageEnabled) {
  nodeArgs.push(
    '--experimental-test-coverage',
    `--test-coverage-include=${path.join(outDir, 'lib', '*.js')}`,
    `--test-coverage-exclude=${path.join(outDir, 'lib', '*.test.js')}`,
  );
}
nodeArgs.push(...compiledTests);

const nodeTest = spawnSync(process.execPath, nodeArgs, {
  cwd: root,
  stdio: 'inherit',
  env: coverageEnabled
    ? {
        ...process.env,
        NODE_V8_COVERAGE: coverageRawDir,
      }
    : process.env,
});

if (nodeTest.status !== 0) {
  process.exit(nodeTest.status ?? 1);
}

if (coverageEnabled) {
  writeCoverageSummary(sourceFiles);
}

process.exit(0);

function writeCoverageSummary(sourceFiles) {
  const compiledSources = sourceFiles.map((file) =>
    path.join(outDir, file.replace(/\.ts$/, '.js')),
  );
  const coverageByUrl = new Map();

  for (const fileName of readdirSync(coverageRawDir)) {
    if (!fileName.endsWith('.json')) continue;
    const raw = JSON.parse(readFileSync(path.join(coverageRawDir, fileName), 'utf8'));
    for (const entry of raw.result ?? []) {
      if (!entry.url.startsWith('file://')) continue;
      const filePath = fileURLToPath(entry.url);
      if (
        !filePath.startsWith(path.join(outDir, 'lib') + path.sep) ||
        filePath.endsWith('.test.js')
      ) {
        continue;
      }
      coverageByUrl.set(pathToFileURL(filePath).href, entry);
    }
  }

  const files = compiledSources.map((compiledPath) => {
    const sourcePath = path
      .relative(root, compiledPath)
      .replace(/^node_modules\/\.cache\/compound-node-tests\//, '')
      .replace(/\.js$/, '.ts');
    const code = readFileSync(compiledPath, 'utf8');
    const executableLines = getExecutableLines(code);
    const coveredLines = new Set();
    const coverage = coverageByUrl.get(pathToFileURL(compiledPath).href);
    if (coverage) {
      const uncoveredLines = new Set();
      for (const fn of coverage.functions ?? []) {
        for (const range of fn.ranges ?? []) {
          const target = range.count > 0 ? coveredLines : uncoveredLines;
          for (const line of linesForRange(code, range.startOffset, range.endOffset)) {
            if (executableLines.has(line)) target.add(line);
          }
        }
      }
      for (const line of uncoveredLines) {
        coveredLines.delete(line);
      }
    }

    return {
      path: sourcePath,
      lines: executableLines.size,
      coveredLines: coveredLines.size,
      pct:
        executableLines.size === 0 ? 100 : round((coveredLines.size / executableLines.size) * 100),
    };
  });

  const totals = files.reduce(
    (acc, file) => {
      acc.lines += file.lines;
      acc.coveredLines += file.coveredLines;
      return acc;
    },
    { lines: 0, coveredLines: 0 },
  );
  totals.pct = totals.lines === 0 ? 100 : round((totals.coveredLines / totals.lines) * 100);

  const summary = {
    tool: 'node:test + V8 coverage',
    scope: 'lib/*.ts node-side modules',
    thresholds: {
      lines: Number(process.env.COMPOUND_COVERAGE_MIN_LINES ?? 30),
    },
    totals,
    files: files.sort((a, b) => a.pct - b.pct || a.path.localeCompare(b.path)),
  };

  mkdirSync(coverageDir, { recursive: true });
  writeFileSync(coverageSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(coverageMarkdownPath, renderCoverageMarkdown(summary));

  if (summary.totals.pct < summary.thresholds.lines) {
    console.error(
      `Coverage gate failed: line coverage ${summary.totals.pct}% is below ${summary.thresholds.lines}%.`,
    );
    process.exit(1);
  }
}

function getExecutableLines(code) {
  const executable = new Set();
  const lines = code.split(/\r?\n/);
  let inBlockComment = false;
  lines.forEach((raw, index) => {
    let line = raw.trim();
    if (!line) return;
    if (inBlockComment) {
      if (line.includes('*/')) {
        inBlockComment = false;
        line = line.slice(line.indexOf('*/') + 2).trim();
      } else {
        return;
      }
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      return;
    }
    if (line.startsWith('//')) return;
    if (line === '{' || line === '}' || line === '};' || line === ');') return;
    executable.add(index + 1);
  });
  return executable;
}

function linesForRange(code, startOffset, endOffset) {
  const lines = new Set();
  let line = 1;
  for (let index = 0; index < code.length; index += 1) {
    if (index >= startOffset && index < endOffset) {
      lines.add(line);
    }
    if (code[index] === '\n') line += 1;
  }
  return lines;
}

function renderCoverageMarkdown(summary) {
  const rows = summary.files
    .slice(0, 20)
    .map((file) => `| ${file.path} | ${file.pct}% | ${file.coveredLines}/${file.lines} |`)
    .join('\n');

  return `# Code Coverage Summary

Scope: ${summary.scope}

| Metric | Value |
| --- | ---: |
| Line coverage | ${summary.totals.pct}% |
| Covered lines | ${summary.totals.coveredLines}/${summary.totals.lines} |
| Minimum line gate | ${summary.thresholds.lines}% |

## Lowest-covered files

| File | Lines | Covered |
| --- | ---: | ---: |
${rows}
`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
