import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(here, '../public/index.html'), 'utf8');
const js = fs.readFileSync(path.resolve(here, '../public/app.js'), 'utf8');

test('all statically referenced interface IDs exist in HTML', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const references = [...js.matchAll(/\bq\(['"]#([A-Za-z][A-Za-z0-9_-]*)['"]\)/g)].map(match => match[1]);
  assert.ok(references.length >= 35);
  assert.deepEqual([...new Set(references.filter(id => !ids.has(id)))], []);
  assert.equal(ids.size, [...html.matchAll(/\bid="([^"]+)"/g)].length, 'HTML IDs should be unique');
});

test('history and Git changes use text nodes, never arbitrary HTML injection', () => {
  assert.match(js, /function renderHistory\(/);
  assert.match(js, /function loadHistory\(/);
  assert.match(js, /workspace-change-file/);
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.doesNotMatch(js, /insertAdjacentHTML\s*\(/);
});

test('V0.6 multi-window status and agent activity timeline have safe UI contracts', () => {
  assert.match(html, /id="connection-state"/);
  assert.ok(html.includes('v' + appVersion.split('.').slice(0, 2).join('.')), 'UI version should match package.json');
  assert.match(js, /events\.addEventListener\('ready'/);
  assert.match(js, /requestRefresh\(payload\.scope === 'catalog'\)/);
  assert.match(js, /session\?\.activity \|\| \[\]/);
  assert.doesNotMatch(js, /eval\s*\(/);
});


test('CLI reset and patch export are explicit UI actions', () => {
  assert.match(html, /id="reset-cli-context"/);
  assert.match(js, /resetRemote\.onclick/);
  assert.match(js, /expectedRemoteId/);
  assert.match(js, /workspace-patch-download/);
  assert.match(js, /\/patch\?path=/);
});

test('V0.7 navigation, mobile panels and async submission guards are present', () => {
  assert.match(html, /id="toggle-sidebar"/);
  assert.match(html, /id="mobile-backdrop"/);
  assert.match(js, /startupSelection\(/);
  assert.match(js, /let sending = false/);
  assert.match(js, /if \(sending \|\| !state\.session/);
  assert.match(js, /ticket !== viewEpoch/);
  assert.match(js, /ticket !== fileEpoch/);
  assert.match(js, /ticket !== previewEpoch/);
  assert.match(js, /uploadSlots\(/);
  assert.match(js, /sessionDrafts/);
});

test('V0.9 provider marks and empty-session action are safe', () => {
  assert.match(js, /BRAND_ASSETS/);
  assert.match(js, /applyBrandMark/);
  assert.match(js, /welcome-action/);
  assert.match(js, /agentVendor/);
  assert.doesNotMatch(js, /insertAdjacentHTML\s*\(/);
});

test('V0.10 duplicate-submission guards, retained streaming DOM and mobile drawers', () => {
  assert.match(js, /if \(creatingSession\) return;/);
  assert.match(js, /if \(addingProject\) return;/);
  assert.match(js, /key === renderedConversationKey/);
  assert.match(js, /conversationRenderKey/);
  assert.match(js, /acceptsInternalDrag/);
  assert.match(html, /aria-controls="inspector"/);
  assert.match(html, /aria-controls="project-sidebar"/);
  assert.match(js, /closeMobilePanels/);
});
