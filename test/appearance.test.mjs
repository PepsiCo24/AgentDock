import test from 'node:test';
import assert from 'node:assert/strict';
import { APPEARANCES, normalizeAppearance, resolveAppearance, filterSessions } from '../public/appearance.mjs';

test('appearance choices are bounded and untrusted values fall back to system', () => {
  assert.deepEqual(APPEARANCES, ['system', 'light', 'dark']);
  assert.equal(normalizeAppearance('light'), 'light');
  assert.equal(normalizeAppearance('dark'), 'dark');
  assert.equal(normalizeAppearance('garbage'), 'system');
  assert.equal(normalizeAppearance(null), 'system');
});

test('system appearance reflects the OS without overwriting explicit choices', () => {
  assert.equal(resolveAppearance('system', true), 'dark');
  assert.equal(resolveAppearance('system', false), 'light');
  assert.equal(resolveAppearance('light', true), 'light');
  assert.equal(resolveAppearance('dark', false), 'dark');
  assert.equal(resolveAppearance(undefined, true), 'dark');
});

test('case-insensitive scoped session search does not mutate the original list', () => {
  const original = [
    { id: '1', title: 'React Component' },
    { id: '2', title: '修复前端导航' },
    { id: '3', title: 'Backend CI' },
  ];
  const matches = filterSessions(original, '  REACT ');
  assert.deepEqual(matches.map(x => x.id), ['1']);
  assert.deepEqual(filterSessions(original, '导航').map(x => x.id), ['2']);
  assert.deepEqual(filterSessions(original, 'missing'), []);
  assert.equal(filterSessions(original, ''), original);
  assert.equal(original.length, 3);
});

test('session titles can be absent without raising an exception', () => {
  assert.deepEqual(filterSessions([{ id: 'a' }, { id: 'b', title: null }], 'foo'), []);
});
