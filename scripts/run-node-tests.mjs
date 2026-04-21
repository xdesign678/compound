import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const libDir = path.join(root, 'lib');
const outDir = path.join(root, 'node_modules', '.cache', 'compound-node-tests');
const testFiles = readdirSync(libDir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => path.join('lib', name));

if (testFiles.length === 0) {
  console.log('No node-side tests found.');
  process.exit(0);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

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
    ...testFiles,
  ],
  {
    cwd: root,
    stdio: 'inherit',
  }
);

if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1);
}

const compiledTests = testFiles.map((file) => path.join(outDir, file.replace(/\.ts$/, '.js')));
const nodeTest = spawnSync(process.execPath, ['--test', ...compiledTests], {
  cwd: root,
  stdio: 'inherit',
});

process.exit(nodeTest.status ?? 1);
