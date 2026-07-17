import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const root = process.cwd();
const standaloneDir = path.join(root, '.next', 'standalone');
const serverPath = path.join(standaloneDir, 'server.js');
if (!existsSync(serverPath)) {
  process.stderr.write('Standalone build not found. Run npm run build first.\n');
  process.exit(1);
}

if (existsSync(path.join(root, 'public'))) {
  cpSync(path.join(root, 'public'), path.join(standaloneDir, 'public'), { recursive: true });
}
if (existsSync(path.join(root, '.next', 'static'))) {
  cpSync(path.join(root, '.next', 'static'), path.join(standaloneDir, '.next', 'static'), {
    recursive: true,
  });
}

const child = spawn(process.execPath, ['server.js'], {
  cwd: standaloneDir,
  env: {
    ...process.env,
    PORT: process.env.PORT || '3000',
    HOSTNAME: process.env.HOSTNAME || '0.0.0.0',
  },
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
