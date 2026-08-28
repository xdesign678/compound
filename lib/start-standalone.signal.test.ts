import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadStandalone() {
  const spec = pathToFileURL(path.join(process.cwd(), 'scripts/start-standalone.mjs')).href;
  // Keep this as a runtime ESM import so tsc's CJS emit cannot rewrite it to require().
  const importer = new Function('spec', 'return import(spec)') as (specifier: string) => Promise<{
    attachParentSignalForwarding: (options: {
      child: EventEmitter & { kill?: (signal: NodeJS.Signals) => void };
      parent?: EventEmitter;
      killChild?: (signal: NodeJS.Signals) => void;
      killParent?: (signal: NodeJS.Signals) => void;
      exitParent?: (code: number) => void;
    }) => {
      forwarded: () => boolean;
      forward: (signal: NodeJS.Signals) => boolean;
      dispose: () => void;
    };
    isStandaloneMain: (argv1?: string, moduleUrl?: string) => boolean;
  }>;
  return importer(spec);
}

test('parent forwards SIGTERM once and ignores a second SIGTERM', async () => {
  const { attachParentSignalForwarding } = await loadStandalone();
  const parent = new EventEmitter();
  const child = new EventEmitter();
  const childKills: NodeJS.Signals[] = [];
  const parentKills: NodeJS.Signals[] = [];
  const parentExits: number[] = [];

  const bridge = attachParentSignalForwarding({
    child,
    parent,
    killChild: (signal) => childKills.push(signal),
    killParent: (signal) => parentKills.push(signal),
    exitParent: (code) => parentExits.push(code),
  });

  parent.emit('SIGTERM');
  parent.emit('SIGTERM');
  parent.emit('SIGINT');

  assert.deepEqual(childKills, ['SIGTERM']);
  assert.equal(bridge.forwarded(), true);
  assert.deepEqual(parentKills, []);
  assert.deepEqual(parentExits, []);
  bridge.dispose();
});

test('parent mirrors child exit code without re-forwarding', async () => {
  const { attachParentSignalForwarding } = await loadStandalone();
  const parent = new EventEmitter();
  const child = new EventEmitter();
  const childKills: NodeJS.Signals[] = [];
  const parentExits: number[] = [];

  const bridge = attachParentSignalForwarding({
    child,
    parent,
    killChild: (signal) => childKills.push(signal),
    killParent: () => {
      throw new Error('must not kill parent on code exit');
    },
    exitParent: (code) => parentExits.push(code),
  });

  child.emit('exit', 7, null);
  assert.deepEqual(parentExits, [7]);
  assert.deepEqual(childKills, []);
  parent.emit('SIGTERM');
  assert.deepEqual(childKills, [], 'listeners removed after child exit');
  bridge.dispose();
});

test('parent mirrors child signal exit', async () => {
  const { attachParentSignalForwarding } = await loadStandalone();
  const parent = new EventEmitter();
  const child = new EventEmitter();
  const parentKills: NodeJS.Signals[] = [];

  const bridge = attachParentSignalForwarding({
    child,
    parent,
    killChild: () => {
      throw new Error('must not kill child on child-exit');
    },
    killParent: (signal) => parentKills.push(signal),
    exitParent: () => {
      throw new Error('must not exitParent on signal');
    },
  });

  child.emit('exit', null, 'SIGTERM');
  assert.deepEqual(parentKills, ['SIGTERM']);
  bridge.dispose();
});

test('isStandaloneMain detects the real script path', async () => {
  const { isStandaloneMain } = await loadStandalone();
  const script = path.join(process.cwd(), 'scripts/start-standalone.mjs');
  assert.equal(isStandaloneMain(script, pathToFileURL(script).href), true);
  assert.equal(isStandaloneMain('/tmp/other.mjs', pathToFileURL(script).href), false);
});
