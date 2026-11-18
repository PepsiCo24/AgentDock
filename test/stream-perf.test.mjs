import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Store } from '../src/core.mjs';
import { Runner } from '../src/agents.mjs';

const delay = ms => new Promise(r => setTimeout(r, ms));
test('high-volume CLI token stream is coalesced without dropping final response', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-v07-stream-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const store = new Store({ dataDir: path.join(home, 'data') });
  const project = store.addProject({ name: 'Work', path: home });
  const session = store.addSession({ projectId: project.id, agentId: 'claude' });
  let saves = 0;
  const original = store.save.bind(store);
  store.save = () => { saves++; return original(); };
  let changes = 0;
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.kill = () => true;
    queueMicrotask(() => {
      const event = value => child.stdout.write(JSON.stringify(value) + '\n');
      event({ type: 'system', subtype: 'init', session_id: 'mock-session' });
      for (let i = 0; i < 160; i++) {
        event({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } });
      }
      event({ type: 'result', session_id: 'mock-session', result: 'x'.repeat(160), is_error: false });
      child.stdout.end();
      child.exitCode = 0;
      child.emit('close', 0);
    });
    return child;
  };
  const runner = new Runner(store, { spawnImpl });
  runner.on('change', () => { changes++; });
  runner.send(session.id, 'Write a plan');
  for (let i = 0; i < 150 && session.lastRun?.outcome !== 'completed'; i++) await delay(10);
  assert.equal(session.lastRun?.outcome, 'completed');
  assert.equal(session.messages.find(m => m.role === 'assistant')?.text, 'x'.repeat(160));
  assert.ok(saves < 50, `expected bounded persistence operations, got ${saves}`);
  assert.ok(changes < 50, `expected bounded SSE events, got ${changes}`);
  assert.equal(store.session(session.id).draft, '');
});
