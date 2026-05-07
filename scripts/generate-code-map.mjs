import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['app', 'components', 'lib', 'scripts'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function toRepoPath(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function resolveLocalImport(fromFile, specifier, allFiles) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const base = specifier.startsWith('@/')
    ? path.join(ROOT, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...Array.from(EXTENSIONS, (ext) => `${base}${ext}`),
    ...Array.from(EXTENSIONS, (ext) => path.join(base, `index${ext}`)),
  ];
  return candidates.find((candidate) => allFiles.has(candidate)) ?? null;
}

function extractImports(content) {
  const specs = new Set();
  const patterns = [
    /import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      specs.add(match[1]);
      match = pattern.exec(content);
    }
  }
  return Array.from(specs);
}

const files = SCAN_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))).sort();
const allFiles = new Set(files);
const edges = [];
const nodeStats = new Map(files.map((file) => [file, { imports: 0, importedBy: 0 }]));

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  for (const specifier of extractImports(content)) {
    const target = resolveLocalImport(file, specifier, allFiles);
    if (!target) continue;
    edges.push([file, target]);
    nodeStats.get(file).imports += 1;
    nodeStats.get(target).importedBy += 1;
  }
}

const topImported = Array.from(nodeStats.entries())
  .sort(
    (a, b) => b[1].importedBy - a[1].importedBy || toRepoPath(a[0]).localeCompare(toRepoPath(b[0])),
  )
  .slice(0, 30);

const byArea = new Map();
for (const file of files) {
  const area = toRepoPath(file).split('/')[0];
  const stat = byArea.get(area) ?? { files: 0, imports: 0, importedBy: 0 };
  const node = nodeStats.get(file);
  stat.files += 1;
  stat.imports += node.imports;
  stat.importedBy += node.importedBy;
  byArea.set(area, stat);
}

const lines = [
  '# Compound Code Map',
  '',
  `Generated at: ${new Date().toISOString()}`,
  '',
  `Files scanned: ${files.length}`,
  `Local import edges: ${edges.length}`,
  '',
  '## Areas',
  '',
  '| Area | Files | Outgoing imports | Incoming imports |',
  '| --- | ---: | ---: | ---: |',
  ...Array.from(byArea.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([area, stat]) => `| ${area} | ${stat.files} | ${stat.imports} | ${stat.importedBy} |`),
  '',
  '## Most Referenced Files',
  '',
  '| File | Imported by | Imports |',
  '| --- | ---: | ---: |',
  ...topImported.map(
    ([file, stat]) => `| \`${toRepoPath(file)}\` | ${stat.importedBy} | ${stat.imports} |`,
  ),
  '',
  '## Boundary Notes',
  '',
  '- Server-only modules should stay behind `app/api/**` route handlers.',
  '- Client views should prefer `lib/api-client.ts` and browser-safe modules.',
  '- Use this map as a navigation aid before broad refactors.',
  '',
];

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/code-map.md'), `${lines.join('\n')}\n`);
console.log(`Wrote docs/code-map.md (${files.length} files, ${edges.length} edges)`);
