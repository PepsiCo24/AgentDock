import test from 'node:test';
import assert from 'node:assert/strict';
import { startupSelection, uploadSlots, isCurrentFileView, conversationRenderKey, acceptsInternalDrag, sameIdOrder } from '../public/ui-state.mjs';

const projects = [{ id: 'p1' }, { id: 'p2' }];
const agents = [{ id: 'demo' }, { id: 'codex' }, { id: 'claude' }];
const sessions = [
  { id: 's1', projectId: 'p1', agentId: 'codex' },
  { id: 's2', projectId: 'p2', agentId: 'claude' }
];
const state = args => startupSelection({ projects, agents, sessions, ...args });

test('fresh startup reuses existing session rather than creating an extra Demo session', () => {
  assert.deepEqual(state({}), { projectId: 'p1', agentId: 'codex', sessionId: 's1' });
});
test('explicit session query beats tab-local last selection', () => {
  assert.deepEqual(state({ requestedSessionId: 's2', saved: { sessionId: 's1' } }),
    { projectId: 'p2', agentId: 'claude', sessionId: 's2' });
});
test('a stale session query falls back to a valid stored session', () => {
  assert.equal(state({ requestedSessionId: 'removed', saved: { sessionId: 's1' } }).sessionId, 's1');
});
test('stored Agent selection without a session is preserved', () => {
  const selection = state({ saved: { projectId: 'p2', agentId: 'codex', sessionId: null } });
  assert.deepEqual(selection, { projectId: 'p2', agentId: 'codex', sessionId: null });
});
test('first load with no session chooses demo, but creates nothing in pure UI state', () => {
  const selection = state({ sessions: [] });
  assert.deepEqual(selection, { projectId: 'p1', agentId: 'demo', sessionId: null });
});
test('invalid restored IDs cannot select a removed project or unsupported agent', () => {
  const choice = state({ saved: { projectId: 'bad', agentId: 'fake', sessionId: 'bad' } });
  assert.equal(choice.projectId, 'p1');
  assert.equal(choice.agentId, 'demo');
  assert.equal(choice.sessionId, null);
});
test('attachment slots never exceed 12 nor go negative', () => {
  assert.equal(uploadSlots(0, 13), 12);
  assert.equal(uploadSlots(11, 6), 1);
  assert.equal(uploadSlots(12, 6), 0);
  assert.equal(uploadSlots(99, 1), 0);
  assert.equal(uploadSlots(2, -1), 0);
});
test('stale project, directory or search responses are not considered current', () => {
  const request = { projectId: 'p1', directory: 'src', query: '' };
  assert.equal(isCurrentFileView(request, request), true);
  assert.equal(isCurrentFileView(request, { ...request, projectId: 'p2' }), false);
  assert.equal(isCurrentFileView(request, { ...request, directory: 'test' }), false);
  assert.equal(isCurrentFileView(request, { ...request, query: 'README' }), false);
});

test('conversation fingerprint is stable for streaming drafts and detects message changes', () => {
  const run = { id: 's1', status: 'running', messages: [{ id: 'm1', text: 'hello' }], draft: 'foo' };
  assert.equal(conversationRenderKey(run), conversationRenderKey({ ...run, draft: 'foo bar' }));
  assert.notEqual(conversationRenderKey(run), conversationRenderKey({ ...run, status: 'idle' }));
  assert.notEqual(conversationRenderKey(run), conversationRenderKey({ ...run, messages: [...run.messages, { id: 'm2' }] }));
  assert.notEqual(conversationRenderKey(run), conversationRenderKey({ ...run, id: 's2' }));
  assert.equal(conversationRenderKey(null), null);
});

test('dragging a file across projects cannot reuse its relative file name', () => {
  assert.equal(acceptsInternalDrag('p1', 'p1'), true);
  assert.equal(acceptsInternalDrag('p1', 'p2'), false);
  assert.equal(acceptsInternalDrag('', 'p1'), false);
  assert.equal(acceptsInternalDrag(undefined, 'p1'), false);
});


test('sameIdOrder avoids unnecessary rerenders but detects catalog changes', () => {
  assert.equal(sameIdOrder(['a', 'b'], ['a', 'b']), true);
  assert.equal(sameIdOrder(['a', 'b'], ['b', 'a']), false);
  assert.equal(sameIdOrder(['a'], ['a', 'b']), false);
  assert.equal(sameIdOrder([], []), true);
  assert.equal(sameIdOrder(null, []), false);
});
