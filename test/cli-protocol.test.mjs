import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, InputError } from '../src/core.mjs';
import { Runner, buildInvocation, interpretEvent, validatedRemoteId } from '../src/agents.mjs';

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-agent.mjs');
const delay = n => new Promise(resolve => setTimeout(resolve, n));
async function waitUntil(check, ms = 3000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('test timed out');
    await delay(15);
  }
}
function init(t, agentId = 'claude') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-cli-v05-'));
  const store = new Store({ dataDir: path.join(dir, 'data') });
  const p = store.addProject({ name: 'CLI', path: dir });
  const session = store.addSession({ agentId, projectId: p.id });
  const calls = [];
  const runner = new Runner(store, { demoDelay: 15, maxRunMs: 1200,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args });
      return spawn(process.execPath, [fake, command, ...args], options);
    }
  });
  t.after(async () => {
    for (const id of runner.active.keys()) runner.stop(id);
    await waitUntil(() => runner.active.size === 0, 3000).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store, session, calls, runner };
}

test('Codex, Claude and Antigravity use specific resume parameter contracts', () => {
  const expected = {
    codex: ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', 'resume', 'valid-session', '-'],
    claude: ['-p', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', '--permission-mode', 'plan', '--resume', 'valid-session', 'task'],
    antigravity: ['-p', 'task', '--output-format', 'stream-json', '--mode', 'plan', '--conversation', 'valid-session']
  };
  for (const agentId of Object.keys(expected)) {
    assert.deepEqual(buildInvocation({ agentId, remoteId: 'valid-session' }, '/tmp', 'task').args, expected[agentId]);
  }
});

test('rejects malformed session IDs before they become command line options', () => {
  for (const remoteId of ['--dangerously-skip-permissions', 'newline\nflag', '../escape', 'session token', 'x'.repeat(130)]) {
    assert.throws(() => validatedRemoteId(remoteId), InputError);
    assert.throws(() => buildInvocation({ agentId: 'codex', remoteId }, '/tmp', 'task'), InputError);
  }
  assert.equal(validatedRemoteId('550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000');
});

test('Claude text_delta is streamed without surfacing raw tool payload', () => {
  const partial = interpretEvent('claude', { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } } });
  assert.deepEqual(partial, { remoteId: null, append: '你好', partial: true });
  const secret = interpretEvent('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'DO_NOT_LEAK_SECRET' } }] } });
  assert.doesNotMatch(JSON.stringify(secret), /DO_NOT_LEAK_SECRET/);
  const injected = interpretEvent('codex', { type: 'item.started', item: { type: 'DO_NOT_LEAK_SECRET', command: 'private' } });
  assert.doesNotMatch(JSON.stringify(injected), /DO_NOT_LEAK_SECRET|private/);
});

test('Antigravity reads token cache_read_tokens and redacts unknown tools', () => {
  const step = interpretEvent('antigravity', { event: 'step_update', step_update: { step_type: 'PRIVATE_COMMAND', state: 'DONE', usage: { cache_read_tokens: 10, input_tokens: 20, ignored: 'secret' } } });
  assert.equal(step.activity, 'Agent 步骤 · 完成');
  assert.deepEqual(step.usage, { cache_read_tokens: 10, input_tokens: 20 });
  assert.doesNotMatch(JSON.stringify(step), /PRIVATE_COMMAND|secret/);
});

test('a second real CLI job resumes previous CLI ID and records lineage', async t => {
  const { store, runner, session, calls } = init(t, 'codex');
  const first = runner.send(session.id, 'initial');
  await waitUntil(() => store.runs(session.id).items.find(x => x.id === first.jobId)?.status === 'completed');
  const second = runner.send(session.id, 'follow-up');
  await waitUntil(() => store.runs(session.id).items.find(x => x.id === second.jobId)?.status === 'completed');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].args.includes('resume'));
  assert.ok(calls[1].args.includes('fake-codex-session'));
  const record = store.runs(session.id).items[0];
  assert.equal(record.resumeMode, 'resume');
  assert.equal(record.resumedFrom, 'fake-codex-session');
  assert.equal(record.remoteId, 'fake-codex-session');
});

test('partial-stream Claude events remain readable and do not duplicate final text', async t => {
  const { runner, session } = init(t, 'claude');
  runner.send(session.id, 'partial-stream');
  await waitUntil(() => session.lastRun?.outcome === 'completed');
  const text = session.messages.find(x => x.role === 'assistant')?.text;
  assert.equal(text, 'Claude partial 你好🙂 complete');
  assert.doesNotMatch(JSON.stringify(session.activity), /VERY_PRIVATE_COMMAND/);
});

test('a successful subprocess with only init event is treated as protocol failure', async t => {
  const { runner, session } = init(t, 'claude');
  runner.send(session.id, 'init-only');
  await waitUntil(() => session.status === 'failed');
  assert.match(session.messages.find(x => x.role === 'system')?.text || '', /完整的可识别任务结果/);
});

test('a successful subprocess with non-NDJSON stdout is treated as protocol failure', async t => {
  const { runner, session } = init(t, 'codex');
  runner.send(session.id, 'invalid-json');
  await waitUntil(() => session.status === 'failed');
  assert.equal(session.lastRun.outcome, 'failed');
  assert.doesNotMatch(JSON.stringify(session.activity), /VERY_PRIVATE_COMMAND/);
});
