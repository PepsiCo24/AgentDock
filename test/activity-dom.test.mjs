import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { activityWorkspaceKey, activityEventKey } from '../public/ui-state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, '../public/app.js'), 'utf8');
const start = source.indexOf('function renderActivity() {');
const end = source.indexOf('function runStatusText(status) {', start);
assert.ok(start >= 0 && end > start);

class Element {
  constructor(tag, className = '', text = '') {
    this.tag = tag;
    this.className = className;
    this.textContent = text;
    this.children = [];
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  querySelector(selector) {
    if (!selector.startsWith('.')) throw Error('Unsupported selector in test');
    const className = selector.slice(1);
    for (const child of this.children) {
      if (child.className?.split(' ').includes(className)) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }
}

function makeHarness() {
  const state = { session: null };
  const ui = { activityList: new Element('div'), runMetrics: new Element('div') };
  const context = {
    state, ui, activityWorkspaceKey, activityEventKey,
    node: (tag, cls, text) => new Element(tag, cls, text),
    clear: element => element.replaceChildren(),
    renderedActivityWorkspacesKey: null,
    renderedActivityEventsKey: null,
    toast: () => {}, api: async () => ({ changed: [] }),
    URL, encodeURIComponent
  };
  const render = vm.runInNewContext(source.slice(start, end) + '\nrenderActivity;', context);
  return { state, ui, render };
}

test('fresh empty session activity list initializes without throwing', () => {
  const app = makeHarness();
  app.render();
  assert.ok(app.ui.activityList.querySelector('.activity-events'));
  assert.equal(app.ui.runMetrics.textContent, '暂无执行记录');
});

test('streaming events retain expanded Git worktree review DOM', () => {
  const app = makeHarness();
  app.state.session = {
    id: 's1', status: 'running',
    workspaces: [{ id: 'w1', path: '/private/temp/w1' }],
    lastRun: { mode: 'edit', outcome: 'running', usage: { total_tokens: 3 } },
    activity: [{ at: '2026-11-19T00:00:00Z', label: '运行中', kind: 'status' }]
  };
  app.render();
  const summary = app.ui.activityList.querySelector('.workspace-summary');
  const eventFeed = app.ui.activityList.querySelector('.activity-events');
  assert.ok(summary && eventFeed);
  const expanded = new Element('div', 'workspace-changes');
  summary.append(expanded);
  const originalEvent = eventFeed.children[0];
  app.state.session = { ...app.state.session, lastRun: { mode: 'edit', outcome: 'running', usage: { total_tokens: 42 } } };
  app.render();
  assert.strictEqual(app.ui.activityList.querySelector('.workspace-summary'), summary);
  assert.strictEqual(app.ui.activityList.querySelector('.workspace-changes'), expanded);
  assert.strictEqual(eventFeed.children[0], originalEvent);
  assert.match(app.ui.runMetrics.textContent, /42/);
  app.state.session = {
    ...app.state.session,
    activity: [...app.state.session.activity, { at: '2026-11-19T00:00:01Z', label: '完成', kind: 'result' }]
  };
  app.render();
  assert.strictEqual(app.ui.activityList.querySelector('.workspace-changes'), expanded);
  assert.equal(eventFeed.children.length, 2);
  app.state.session = { ...app.state.session, id: 's2' };
  app.render();
  assert.notStrictEqual(app.ui.activityList.querySelector('.workspace-summary'), summary);
});
