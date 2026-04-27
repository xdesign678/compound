import ts from 'typescript';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sourceRoots = ['app', 'components', 'lib', 'scripts'];
const outDir = path.join(root, 'tmp');
const jsonPath = path.join(outDir, 'quality-metrics.json');
const markdownPath = path.join(outDir, 'quality-metrics.md');
const thresholds = {
  maxComplexity: Number(process.env.COMPOUND_MAX_COMPLEXITY ?? 120),
  minMaintainability: Number(process.env.COMPOUND_MIN_MAINTAINABILITY ?? 0),
  minAverageMaintainability: Number(process.env.COMPOUND_MIN_AVG_MAINTAINABILITY ?? 30),
};

const files = sourceRoots.flatMap((dir) => walk(path.join(root, dir))).sort();
const metrics = files.map(analyzeFile);
const totals = metrics.reduce(
  (acc, file) => {
    acc.files += 1;
    acc.lines += file.lines;
    acc.functions += file.functions;
    acc.complexity += file.complexity;
    acc.commentLines += file.commentLines;
    acc.maintainability += file.maintainability;
    acc.maxComplexity = Math.max(acc.maxComplexity, file.maxFunctionComplexity);
    return acc;
  },
  {
    files: 0,
    lines: 0,
    functions: 0,
    complexity: 0,
    commentLines: 0,
    maintainability: 0,
    maxComplexity: 0,
  },
);
totals.averageComplexity = round(totals.functions === 0 ? 0 : totals.complexity / totals.functions);
totals.averageMaintainability = round(
  metrics.length === 0 ? 100 : totals.maintainability / metrics.length,
);
totals.commentRatio = round(totals.lines === 0 ? 0 : (totals.commentLines / totals.lines) * 100);

const report = {
  tool: 'compound quality metrics',
  scope: sourceRoots,
  thresholds,
  totals,
  files: metrics.sort(
    (a, b) =>
      b.maxFunctionComplexity - a.maxFunctionComplexity ||
      a.maintainability - b.maintainability ||
      a.path.localeCompare(b.path),
  ),
};

mkdirSync(outDir, { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(markdownPath, renderMarkdown(report));

const complexFiles = report.files.filter(
  (file) => file.maxFunctionComplexity > thresholds.maxComplexity,
);
const hardToMaintainFiles = report.files.filter(
  (file) => file.maintainability < thresholds.minMaintainability,
);
const averageMaintainabilityFailed =
  report.totals.averageMaintainability < thresholds.minAverageMaintainability;

if (complexFiles.length > 0 || hardToMaintainFiles.length > 0 || averageMaintainabilityFailed) {
  for (const file of complexFiles) {
    console.error(
      `Complexity gate failed: ${file.path} max complexity ${file.maxFunctionComplexity} exceeds ${thresholds.maxComplexity}.`,
    );
  }
  for (const file of hardToMaintainFiles) {
    console.error(
      `Maintainability gate failed: ${file.path} score ${file.maintainability} is below ${thresholds.minMaintainability}.`,
    );
  }
  if (averageMaintainabilityFailed) {
    console.error(
      `Maintainability gate failed: average score ${report.totals.averageMaintainability} is below ${thresholds.minAverageMaintainability}.`,
    );
  }
  process.exit(1);
}

console.log(
  `Quality metrics passed: ${totals.files} files, max complexity ${totals.maxComplexity}, average maintainability ${totals.averageMaintainability}.`,
);

function walk(dir) {
  if (!exists(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (['node_modules', '.next', 'tmp', 'coverage'].includes(entry)) return [];
      return walk(fullPath);
    }
    if (!/\.(mjs|js|ts|tsx)$/.test(entry)) return [];
    if (/\.test\.(ts|tsx|js)$/.test(entry)) return [];
    if (/\.d\.ts$/.test(entry)) return [];
    return [fullPath];
  });
}

function exists(filePath) {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function analyzeFile(filePath) {
  const code = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    code,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const state = {
    path: path.relative(root, filePath),
    lines: countLines(code),
    commentLines: countCommentLines(code),
    functions: 0,
    complexity: 0,
    maxFunctionComplexity: 0,
    maintainability: 0,
  };

  visit(sourceFile, state);
  state.maintainability = calculateMaintainability(code, state);
  return state;
}

function visit(node, state) {
  if (isFunctionLike(node)) {
    const complexity = calculateComplexity(node);
    state.functions += 1;
    state.complexity += complexity;
    state.maxFunctionComplexity = Math.max(state.maxFunctionComplexity, complexity);
  }

  ts.forEachChild(node, (child) => visit(child, state));
}

function calculateComplexity(node) {
  let complexity = 1;
  const scan = (child) => {
    if (
      ts.isIfStatement(child) ||
      ts.isForStatement(child) ||
      ts.isForInStatement(child) ||
      ts.isForOfStatement(child) ||
      ts.isWhileStatement(child) ||
      ts.isDoStatement(child) ||
      ts.isCaseClause(child) ||
      ts.isConditionalExpression(child) ||
      ts.isCatchClause(child)
    ) {
      complexity += 1;
    }

    if (ts.isBinaryExpression(child)) {
      const operator = child.operatorToken.kind;
      if (
        operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.BarBarToken
      ) {
        complexity += 1;
      }
    }

    ts.forEachChild(child, scan);
  };
  ts.forEachChild(node, scan);
  return complexity;
}

function calculateMaintainability(code, state) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    code,
  );
  let tokenCount = 0;
  let operatorCount = 0;
  let operandCount = 0;
  const uniqueOperators = new Set();
  const uniqueOperands = new Set();

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.WhitespaceTrivia || token === ts.SyntaxKind.NewLineTrivia) continue;
    tokenCount += 1;
    const text = scanner.getTokenText();
    if (isOperatorToken(token)) {
      operatorCount += 1;
      uniqueOperators.add(text);
    } else {
      operandCount += 1;
      uniqueOperands.add(text);
    }
  }

  const vocabulary = Math.max(1, uniqueOperators.size + uniqueOperands.size);
  const length = Math.max(1, operatorCount + operandCount || tokenCount);
  const volume = length * Math.log2(vocabulary);
  const loc = Math.max(1, state.lines);
  const commentPercent = Math.min(100, (state.commentLines / loc) * 100);
  const maintainability =
    171 -
    5.2 * Math.log(Math.max(1, volume)) -
    0.23 * Math.max(1, state.complexity) -
    16.2 * Math.log(loc) +
    50 * Math.sin(Math.sqrt(2.4 * commentPercent));

  return round(Math.max(0, Math.min(100, (maintainability * 100) / 171)));
}

function countLines(code) {
  return code.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function countCommentLines(code) {
  return code.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
  }).length;
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function isOperatorToken(token) {
  return (
    (token >= ts.SyntaxKind.FirstBinaryOperator && token <= ts.SyntaxKind.LastBinaryOperator) ||
    token === ts.SyntaxKind.QuestionToken ||
    token === ts.SyntaxKind.ColonToken ||
    token === ts.SyntaxKind.DotToken ||
    token === ts.SyntaxKind.DotDotDotToken ||
    token === ts.SyntaxKind.EqualsGreaterThanToken
  );
}

function renderMarkdown(report) {
  const riskiest = report.files
    .slice(0, 20)
    .map(
      (file) =>
        `| ${file.path} | ${file.maxFunctionComplexity} | ${file.maintainability} | ${file.functions} | ${file.lines} |`,
    )
    .join('\n');

  return `# Code Quality Metrics

Scope: ${report.scope.join(', ')}

| Metric | Value |
| --- | ---: |
| Files scanned | ${report.totals.files} |
| Source lines | ${report.totals.lines} |
| Functions scanned | ${report.totals.functions} |
| Max function complexity | ${report.totals.maxComplexity} |
| Average function complexity | ${report.totals.averageComplexity} |
| Average maintainability | ${report.totals.averageMaintainability} |
| Comment ratio | ${report.totals.commentRatio}% |
| Complexity gate | <= ${report.thresholds.maxComplexity} |
| File maintainability gate | >= ${report.thresholds.minMaintainability} |
| Average maintainability gate | >= ${report.thresholds.minAverageMaintainability} |

## Highest-risk files

| File | Max complexity | Maintainability | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
${riskiest}
`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
