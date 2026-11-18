import { TextDecoder } from 'node:util';
/** UTF-8-safe bounded JSONL parser. Never echoes raw failed input. */
export class NdjsonDecoder {
  constructor(onValue, { maxLineBytes = 1024 * 1024 } = {}) {
    this.onValue = onValue;
    this.maxLineBytes = maxLineBytes;
    this.decoder = new TextDecoder('utf-8', { fatal: false });
    this.pending = '';
    this.valid = 0;
    this.malformed = 0;
  }
  write(chunk) {
    this.pending += this.decoder.decode(chunk, { stream: true });
    let position;
    while ((position = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, position).replace(/\r$/, '');
      this.pending = this.pending.slice(position + 1);
      this.parse(line);
    }
    if (Buffer.byteLength(this.pending, 'utf8') > this.maxLineBytes) {
      throw new Error('Agent 单条输出超过安全限制');
    }
  }
  parse(line) {
    if (!line.trim()) return;
    if (Buffer.byteLength(line, 'utf8') > this.maxLineBytes) throw new Error('Agent 单条输出超过安全限制');
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { this.malformed++; return; }
      this.valid++;
      this.onValue(parsed);
    } catch (err) {
      if (err instanceof SyntaxError) this.malformed++;
      else throw err;
    }
  }
  end() {
    this.pending += this.decoder.decode();
    if (this.pending) this.parse(this.pending.replace(/\r$/, ''));
    this.pending = '';
    return { valid: this.valid, malformed: this.malformed };
  }
}
