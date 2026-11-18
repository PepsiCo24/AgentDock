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

test('V0.11 HIG-inspired UI exposes searchable sidebar and theme choices', () => {
  assert.match(html, /id="session-search"/);
  assert.match(html, /id="session-count"/);
  assert.match(html, /id="appearance-select"/);
  assert.match(html, /value="system"/);
  assert.match(html, /value="light"/);
  assert.match(html, /value="dark"/);
  assert.match(html, /href="\/apple-hig\.css"/);
  assert.match(js, /resolveAppearance/);
  assert.match(js, /filterSessions/);
  assert.match(js, /event\.key\.toLowerCase\(\) === 'k'/);
  assert.match(js, /aria-pressed/);
  assert.match(js, /aria-current/);
  const css = fs.readFileSync(path.resolve(here, '../public/apple-hig.css'), 'utf8');
  assert.match(css, /:root\[data-theme='light'\]/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /forced-colors: active/);
  assert.doesNotMatch(css, /fonts\.googleapis|sf-symbols|apple-logo/i);
});


test('V0.12 preserves live navigation DOM and gives search/file controls keyboard feedback', () => {
  assert.match(js, /function updateSessionButton\(/);
  assert.match(js, /sameIdOrder\(/);
  assert.match(js, /if \(same\) \{/);
  assert.match(js, /if \(ui\.avatar\.dataset\.agent !==/);
  assert.match(js, /sessionSearch\.addEventListener\('keydown'/);
  assert.match(js, /ui\.sessions\.addEventListener\('keydown'/);
  assert.match(js, /ui\.clearSessionSearch\.onclick/);
  assert.match(js, /fileLoading/);
  assert.match(js, /retry\.onclick = \(\) => void showPreview/);
  assert.match(html, /id="clear-session-search"/);
  assert.match(html, /id="file-count"/);
  assert.match(html, /aria-controls="session-list"/);
});
