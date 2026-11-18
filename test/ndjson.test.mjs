import test from 'node:test';
import assert from 'node:assert/strict';
import { NdjsonDecoder } from '../src/ndjson.mjs';

test('decoder preserves UTF-8 characters split across chunks and CRLF', () => {
  const rows = [];
  const decoder = new NdjsonDecoder(value => rows.push(value));
  const bytes = Buffer.from('{"text":"你好🙂"}\r\n{"count":2}\n', 'utf8');
  for (let i = 0; i < bytes.length; i += 3) decoder.write(bytes.subarray(i, i + 3));
  assert.deepEqual(decoder.end(), { valid: 2, malformed: 0 });
  assert.deepEqual(rows, [{ text: '你好🙂' }, { count: 2 }]);
});

test('decoder rejects oversized lines without leaking content', () => {
  const decoder = new NdjsonDecoder(() => {}, { maxLineBytes: 12 });
  assert.throws(() => decoder.write(Buffer.from('{"secret":"SUPER_SECRET"}')), /安全限制/);
});

test('decoder ignores invalid NDJSON and accepts trailing event without newline', () => {
  const rows = [];
  const decoder = new NdjsonDecoder(value => rows.push(value));
  decoder.write(Buffer.from('warning secret content\n{"ok":true}'));
  assert.deepEqual(decoder.end(), { valid: 1, malformed: 1 });
  assert.deepEqual(rows, [{ ok: true }]);
});
