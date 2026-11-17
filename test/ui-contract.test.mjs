import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
