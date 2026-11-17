// Test-only process that emulates the public NDJSON event categories of each CLI.
// It does not contact model services, write files or load credentials.
const agent = process.argv[2];
const args = process.argv.slice(3);
const prompt = agent === 'codex' ? await new Promise(resolve => {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { text += chunk; });
  process.stdin.on('end', () => resolve(text));
}) : args.join(' ');
const send = data => process.stdout.write(`${JSON.stringify(data)}\n`);
const slow = prompt.includes('slow');
const fail = prompt.includes('fail');
if (agent === 'codex') {
  send({ type: 'thread.started', thread_id: 'fake-codex-session' });
  send({ type: 'item.started', item: { type: 'command_execution', command: 'PRIVATE_TOKEN_SHOULD_NOT_LEAK' } });
  if (!slow) send({ type: 'item.completed', item: { type: 'agent_message', text: 'Codex simulated answer' } });
  send({ type: 'turn.completed', usage: { input_tokens: 30, output_tokens: 15, cached_input_tokens: 12 } });
} else if (agent === 'claude') {
  send({ type: 'system', subtype: 'init', session_id: 'fake-claude-session' });
  send({ type: 'assistant', session_id: 'fake-claude-session', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'PRIVATE_TOKEN_SHOULD_NOT_LEAK' } }] } });
  if (!slow) send({ type: 'result', session_id: 'fake-claude-session', result: 'Claude simulated answer', is_error: fail, usage: { input_tokens: 40, output_tokens: 20 } });
} else if (agent === 'agy') {
  send({ event: 'init', conversation_id: 'fake-agy-session' });
  send({ event: 'step_update', step_update: { step_type: 'run_command', state: 'DONE', input: 'PRIVATE_TOKEN_SHOULD_NOT_LEAK' } });
  if (!slow) send({ event: 'result', result: { conversation_id: 'fake-agy-session', status: fail ? 'ERROR' : 'SUCCESS', response: 'Antigravity simulated answer', usage: { input_tokens: 50, output_tokens: 25 } } });
}
if (slow) { setInterval(() => {}, 500); }
else { if (fail) process.exitCode = 2; }
