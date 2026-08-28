import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Parent-process signal bridge for `next start` standalone.
 * Forwards SIGTERM/SIGINT to the child once, then mirrors the child's exit
 * (code or signal) so supervisors still see the original termination.
 */
export function attachParentSignalForwarding(options) {
  const child = options.child;
  const parent = options.parent ?? process;
  const killChild =
    options.killChild ??
    ((signal) => {
      child.kill(signal);
    });
  const killParent =
    options.killParent ??
    ((signal) => {
      process.kill(process.pid, signal);
    });
  const exitParent =
    options.exitParent ??
    ((code) => {
      process.exit(code);
    });

  let forwarded = false;
  const forward = (signal) => {
    if (forwarded) return false;
    forwarded = true;
    killChild(signal);
    return true;
  };

  const onTerm = () => {
    forward('SIGTERM');
  };
  const onInt = () => {
    forward('SIGINT');
  };
  parent.on('SIGTERM', onTerm);
  parent.on('SIGINT', onInt);

  const onChildExit = (code, signal) => {
    parent.off('SIGTERM', onTerm);
    parent.off('SIGINT', onInt);
    if (signal) killParent(signal);
    else exitParent(code ?? 1);
  };
  child.on('exit', onChildExit);

  return {
    forwarded: () => forwarded,
    forward,
    dispose() {
      parent.off('SIGTERM', onTerm);
      parent.off('SIGINT', onInt);
      child.off('exit', onChildExit);
    },
  };
}

export function isStandaloneMain(argv1 = process.argv[1], moduleUrl = import.meta.url) {
  if (!argv1) return false;
  try {
    return pathToFileURL(path.resolve(argv1)).href === moduleUrl;
  } catch {
    return false;
  }
}

function startStandalone() {
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
  attachParentSignalForwarding({ child });
}

if (isStandaloneMain()) {
  startStandalone();
}
