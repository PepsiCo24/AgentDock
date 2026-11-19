import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/app.js'), 'utf8');
const headerStart = source.indexOf('function renderHeader() {');
const headerEnd = source.indexOf('function createMessage(', headerStart);
const approvalStart = source.indexOf('async function submitApproval(');
const approvalEnd = source.indexOf('function bindUI()', approvalStart);
assert.ok(headerStart >= 0 && headerEnd > headerStart && approvalStart >= 0 && approvalEnd > approvalStart);

function element() {
  return {
    style: {}, dataset: {}, textContent: '', value: '', checked: false,
    disabled: false, hidden: false, title: '', placeholder: '',
    setAttribute(name, value) { this[name] = String(value); }
  };
}
function harness() {
  const ids = new Map();
  const q = selector => {
    if (!ids.has(selector)) ids.set(selector, element());
    return ids.get(selector);
  };
  const ui = {
    avatar: element(), title: element(), subtitle: element(),
    resetRemote: element(), stop: element(), queue: element(),
    approvalPanel: element(), approvalSummary: element(),
    worktree: element(), mode: element(), composer: element(), send: element()
  };
  ui.avatar.dataset.agent = 'demo';
  ui.mode.value = 'plan';
  const state = {
    projectId: 'p1',
    session: { id: 's1', status: 'queued', queueLength: 1, agentId: 'demo', remoteId: null }
  };
  const calls = [];
  const pending = [];
  const notifications = [];
  let refreshes = 0;
  const context = {
    state, ui, q, sending: false, uploading: false, creatingSession: false,
    approvalBusy: false, stopping: false, stopRequestedFor: null,
    agent: () => ({ id: 'demo', installed: true, color: '#abcdef', name: 'Demo' }),
    agentVendor: () => 'Local', statusText: s => s?.status || 'none',
    applyBrandMark: (avatar, id) => { avatar.dataset.agent = id; },
    api: (route, opts) => {
      calls.push({ route, opts });
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    toast: value => notifications.push(value), requestRefresh: () => { refreshes += 1; }
  };
  const funcs = vm.runInNewContext(
    source.slice(headerStart, headerEnd) + '\n' + source.slice(approvalStart, approvalEnd) +
      '\n({renderHeader, submitApproval, stopCurrentTask})', context);
  return { state, ui, q, calls, pending, notifications, context, funcs,
    get refreshes() { return refreshes; } };
}

test('queued task is cancellable from header, with state-specific label', async () => {
  const app = harness();
  app.funcs.renderHeader();
  assert.equal(app.ui.stop.hidden, false);
  assert.match(app.ui.stop.textContent, /取消排队/);
  assert.equal(app.ui.queue.textContent, '排队 1');
  const first = app.funcs.stopCurrentTask();
  const second = app.funcs.stopCurrentTask();
  assert.equal(app.calls.length, 1, 'duplicate click should not send two cancellation requests');
  assert.match(app.calls[0].route, /\/stop$/);
  assert.equal(app.ui.stop.disabled, true);
  app.pending[0].resolve({ stopped: true });
  await Promise.all([first, second]);
  assert.equal(app.state.session.status, 'stopped');
  assert.equal(app.state.session.queueLength, 0);
  assert.equal(app.ui.stop.hidden, true);
  assert.equal(app.refreshes, 1);
  assert.ok(app.notifications.some(message => /已取消/.test(message)));
});

test('approval and rejection share a single in-flight guard and stale approval cannot replay', async () => {
  const app = harness();
  app.state.session.status = 'awaiting_approval';
  app.state.session.pendingApproval = { id: 'job-1', summary: 'Modify source file' };
  app.funcs.renderHeader();
  assert.match(app.ui.stop.textContent, /撤回任务/);
  const first = app.funcs.submitApproval('approve');
  const second = app.funcs.submitApproval('reject');
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].opts.data.jobId, 'job-1');
  assert.equal(app.q('#approve-task').disabled, true);
  assert.equal(app.q('#reject-task').disabled, true);
  app.pending[0].resolve({ started: false, queued: true });
  await Promise.all([first, second]);
  assert.equal(app.state.session.pendingApproval, null);
  assert.equal(app.state.session.status, 'queued');
  assert.equal(app.q('#approve-task').disabled, false);
  await app.funcs.submitApproval('approve');
  assert.equal(app.calls.length, 1);
  assert.equal(app.refreshes, 1);
});

test('failed approval releases UI guard while keeping the original approval visible', async () => {
  const app = harness();
  app.state.session.status = 'awaiting_approval';
  app.state.session.pendingApproval = { id: 'job-2', summary: 'Write file' };
  const result = app.funcs.submitApproval('reject');
  app.pending[0].reject(new Error('Network unreachable'));
  await result;
  assert.equal(app.state.session.status, 'awaiting_approval');
  assert.equal(app.state.session.pendingApproval.id, 'job-2');
  assert.equal(app.q('#reject-task').disabled, false);
  assert.ok(app.notifications.includes('Network unreachable'));
});

test('running stop request remains disabled until state leaves running', async () => {
  const app = harness();
  app.state.session.status = 'running';
  app.funcs.renderHeader();
  assert.match(app.ui.stop.textContent, /停止任务/);
  const result = app.funcs.stopCurrentTask();
  app.pending[0].resolve({ stopped: true });
  await result;
  assert.equal(app.state.session.status, 'running', 'do not incorrectly claim a live process has already exited');
  assert.equal(app.ui.stop.disabled, true);
  app.state.session.status = 'stopped';
  app.funcs.renderHeader();
  assert.equal(app.ui.stop.hidden, true);
  assert.equal(app.context.stopRequestedFor, null);
});
