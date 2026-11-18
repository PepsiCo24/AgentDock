import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.mjs';

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-agent.mjs');
async function setup(t, appOptions = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-http-'));
  const root = path.join(dir, 'project');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'README.md'), '# Hello from tests\n');
  const { server, store, runner } = createApp({ dataDir: path.join(dir, 'data'), demoDelay: 100, ...appOptions });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const project = store.addProject({ name: 'HTTP tests', path: root });
  t.after(async () => {
    for (const id of runner.active.keys()) runner.stop(id);
    for (let n = 0; n < 100 && runner.active.size; n++) await new Promise(resolve => setTimeout(resolve, 5));
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
  const post = async (route, data, token = bootstrap.token) => {
    const r = await fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AgentDock-Token': token }, body: JSON.stringify(data) });
    return { status: r.status, json: await r.json() };
  };
  return { root, base, project, bootstrap, post, store, runner };
}

test('Serves frontend and rejects unauthorized writes / invalid Host', async t => {
  const { base, post } = await setup(t);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /AgentDock/);
  assert.equal((await post('/api/sessions', {}, 'bad')).status, 403);
  const unsafeStatus = await new Promise((resolve, reject) => {
    const r = http.request(base + '/api/health', { headers: { Host: 'evil.example' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    r.on('error', reject); r.end();
  });
  assert.equal(unsafeStatus, 403);
  const cross = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
});

test('Sessions, messages, file browser and preview APIs', async t => {
  const { base, project, post } = await setup(t);
  const created = await post('/api/sessions', { projectId: project.id, agentId: 'demo' });
  assert.equal(created.status, 201);
  const sid = created.json.id;
  const sent = await post(`/api/sessions/${sid}/messages`, { text: 'Hello' });
  assert.equal(sent.status, 202);
  const files = await fetch(`${base}/api/projects/${project.id}/files`);
  assert.equal(files.status, 200);
  assert.ok((await files.json()).some(f => f.name === 'README.md'));
  const preview = await fetch(`${base}/api/projects/${project.id}/preview?path=README.md`);
  assert.equal((await preview.json()).content, '# Hello from tests\n');
  const breakout = await fetch(`${base}/api/projects/${project.id}/preview?path=..%2F..%2Fetc%2Fpasswd`);
  assert.equal(breakout.status, 403);
  const data = await (await fetch(`${base}/api/sessions/${sid}`)).json();
  assert.equal(data.messages[0].text, 'Hello');
});

test('File uploads are scoped, size-limited and safely named', async t => {
  const { base, project, bootstrap, root } = await setup(t);
  const upload = (name, body) => fetch(`${base}/api/projects/${project.id}/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-AgentDock-Token': bootstrap.token }, body
  });
  const valid = await upload('meeting.txt', Buffer.from('meeting notes'));
  assert.equal(valid.status, 201);
  const uploaded = await valid.json();
  assert.ok(uploaded.path.startsWith('.agentdock/uploads/'));
  assert.equal(fs.readFileSync(path.join(root, uploaded.path), 'utf8'), 'meeting notes');
  const bad = await upload('../escape.txt', Buffer.from('x'));
  assert.equal(bad.status, 400);
  const tooBig = await upload('big.bin', Buffer.alloc(10 * 1024 * 1024 + 1));
  assert.equal(tooBig.status, 413);
  const outside = path.join(root, '.agentdock2');
  fs.mkdirSync(outside);
  assert.equal(fs.existsSync(path.join(outside, 'escape.txt')), false);
});

test('Symlinked upload directory outside project is rejected', async t => {
  const { base, root, project, bootstrap } = await setup(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(root, '.agentdock'));
  const r = await fetch(`${base}/api/projects/${project.id}/upload?name=file.txt`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-AgentDock-Token': bootstrap.token }, body: 'payload'
  });
  assert.equal(r.status, 403);
  assert.equal(fs.readdirSync(outside).length, 0);
});


test('Write tasks require one-time approval; invalid job ID cannot bypass', async t => {
  const { base, project, post } = await setup(t);
  const created = await post('/api/sessions', { projectId: project.id, agentId: 'demo' });
  const sid = created.json.id;
  const job = await post(`/api/sessions/${sid}/messages`, { text: 'Edit README', mode: 'edit' });
  assert.equal(job.status, 202);
  const view = await (await fetch(`${base}/api/sessions/${sid}`)).json();
  assert.equal(view.status, 'awaiting_approval');
  assert.equal(view.messages.filter(m => m.role === 'assistant').length, 0);
  assert.equal('queue' in view, false); // No queued prompt contents are exposed by GET.
  const reject = await post(`/api/sessions/${sid}/approve`, { jobId: 'wrong' });
  assert.equal(reject.status, 409);
  const approve = await post(`/api/sessions/${sid}/approve`, { jobId: view.pendingApproval.id });
  assert.equal(approve.status, 200);
  assert.equal((await post(`/api/sessions/${sid}/approve`, { jobId: view.pendingApproval.id })).status, 409);
  await new Promise(resolve => setTimeout(resolve, 130));
  const done = await (await fetch(`${base}/api/sessions/${sid}`)).json();
  assert.equal(done.lastRun.mode, 'edit');
  assert.equal(done.lastRun.outcome, 'completed');
});

test('Rejection and stop of pending edit are safe', async t => {
  const { base, project, post } = await setup(t);
  const created = await post('/api/sessions', { projectId: project.id, agentId: 'demo' });
  const sid = created.json.id;
  await post(`/api/sessions/${sid}/messages`, { text: 'Edit some files', mode: 'edit' });
  const view = await (await fetch(`${base}/api/sessions/${sid}`)).json();
  assert.equal((await post(`/api/sessions/${sid}/reject`, { jobId: view.pendingApproval.id })).status, 200);
  await post(`/api/sessions/${sid}/messages`, { text: 'Edit again', mode: 'edit' });
  assert.equal((await post(`/api/sessions/${sid}/stop`, {})).json.stopped, true);
  assert.equal((await (await fetch(`${base}/api/sessions/${sid}`)).json()).status, 'stopped');
});

test('File search and downloads are project-scoped', async t => {
  const { base, project, root } = await setup(t);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'readme-local.txt'), 'download sample');
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.git', 'readme-secret.txt'), 'private');
  const search = await fetch(`${base}/api/projects/${project.id}/search?q=readme`);
  const results = await search.json();
  assert.equal(search.status, 200);
  assert.ok(results.some(x => x.path.includes('readme-local')));
  assert.ok(!results.some(x => x.path.includes('readme-secret')));
  const download = await fetch(`${base}/api/projects/${project.id}/download?path=src%2Freadme-local.txt`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'download sample');
  assert.match(download.headers.get('content-disposition'), /attachment/);
  const escape = await fetch(`${base}/api/projects/${project.id}/download?path=..%2F..%2Fetc%2Fpasswd`);
  assert.equal(escape.status, 403);
});

test('Mode validation refuses unknown execution mode', async t => {
  const { project, post } = await setup(t);
  const created = await post('/api/sessions', { projectId: project.id, agentId: 'demo' });
  const r = await post(`/api/sessions/${created.json.id}/messages`, { text: 'Hi', mode: 'unrestricted' });
  assert.equal(r.status, 400);
});

test('CLI diagnostics endpoint returns capabilities without filesystem paths or auth claims', async t => {
  const { base } = await setup(t);
  const r = await fetch(`${base}/api/agents/diagnostics`);
  assert.equal(r.status, 200);
  const checks = await r.json();
  assert.equal(checks.length, 4);
  assert.ok(checks.some(c => c.id === 'demo' && c.installed && c.auth === 'not-required'));
  assert.ok(checks.filter(c => c.id !== 'demo').every(c => c.auth === 'not-checked'));
  assert.ok(checks.every(c => !('path' in c) && !('env' in c)));
});

test('worktree API refuses unrelated session references and invalid workspace mode', async t => {
  const { base, project, post } = await setup(t);
  const a = await post('/api/sessions', { agentId: 'demo', projectId: project.id });
  const b = await post('/api/sessions', { agentId: 'demo', projectId: project.id });
  const bad = await post(`/api/sessions/${a.json.id}/messages`, { text: 'read only', mode: 'plan', workspaceMode: 'worktree' });
  assert.equal(bad.status, 400);
  const other = await fetch(`${base}/api/sessions/${b.json.id}/workspaces/a4e6e13f-faed-42a0-a49b-2349acbf082a/changes`);
  assert.equal(other.status, 404);
});


test('approved worktree task exposes scoped changes API and source checkout remains unchanged', async t => {
  const { base, project, root, post } = await setup(t);
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', 'README.md']);
  execFileSync('git', ['-C', root, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'initial']);
  const a = await post('/api/sessions', { agentId: 'demo', projectId: project.id });
  const b = await post('/api/sessions', { agentId: 'demo', projectId: project.id });
  assert.equal(a.status, 201);
  const queued = await post(`/api/sessions/${a.json.id}/messages`, { text: 'safe edit', mode: 'edit', workspaceMode: 'worktree' });
  assert.equal(queued.status, 202);
  const awaiting = await (await fetch(`${base}/api/sessions/${a.json.id}`)).json();
  assert.equal(awaiting.pendingApproval.workspaceMode, 'worktree');
  assert.equal((await post(`/api/sessions/${a.json.id}/approve`, { jobId: awaiting.pendingApproval.id })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 140));
  const done = await (await fetch(`${base}/api/sessions/${a.json.id}`)).json();
  assert.equal(done.status, 'idle');
  assert.equal(done.workspaces.length, 1);
  const workspaceId = done.workspaces[0].id;
  const changed = await fetch(`${base}/api/sessions/${a.json.id}/workspaces/${workspaceId}/changes`);
  assert.equal(changed.status, 200);
  assert.deepEqual((await changed.json()).changed, []);
  const unauthorizedSession = await fetch(`${base}/api/sessions/${b.json.id}/workspaces/${workspaceId}/changes`);
  assert.equal(unauthorizedSession.status, 404);
  assert.equal((await post(`/api/sessions/${a.json.id}/workspaces/${workspaceId}/reveal`, {}, 'wrong')).status, 403);
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), '# Hello from tests\n');
});

const sleep = time => new Promise(resolve => setTimeout(resolve, time));
async function waitFor(check, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for HTTP state');
    await sleep(18);
  }
}

test('Run history API paginates, redacts queued prompts and requires explicit approval', async t => {
  const { base, project, post, store } = await setup(t);
  const { json: session } = await post('/api/sessions', { projectId: project.id, agentId: 'demo' });
  const a = await post(`/api/sessions/${session.id}/messages`, { text: 'Change sample', mode: 'edit' });
  assert.equal(a.status, 202);
  const r1 = await (await fetch(`${base}/api/sessions/${session.id}/runs?limit=1`)).json();
  assert.equal(r1.total, 1);
  assert.equal(r1.items[0].status, 'awaiting_approval');
  assert.equal(r1.items[0].retryable, false);
  assert.equal('queue' in (await (await fetch(`${base}/api/sessions/${session.id}`)).json()), false);
  assert.equal((await post(`/api/sessions/${session.id}/runs/${a.json.jobId}/retry`, {})).status, 409);
  const reject = await post(`/api/sessions/${session.id}/reject`, { jobId: a.json.jobId });
  assert.equal(reject.status, 200);
  assert.equal(store.runs(session.id).items[0].status, 'rejected');
  assert.equal((await (await fetch(`${base}/api/sessions/${session.id}/runs?limit=99`)).status), 400);
  const b = await post(`/api/sessions/${session.id}/messages`, { text: 'Read sample' });
  await waitFor(() => store.runs(session.id).items.find(r => r.id === b.json.jobId)?.status === 'completed');
  const pg2 = await (await fetch(`${base}/api/sessions/${session.id}/runs?limit=1&offset=1`)).json();
  assert.equal(pg2.items[0].id, a.json.jobId);
});

test('Retry API re-approves a failing CLI edit and refuses stale token', async t => {
  const spawnImpl = (command, args, options) => spawn(process.execPath, [fake, command, ...args], options);
  const { base, project, post, store } = await setup(t, { spawnImpl });
  const { json: session } = await post('/api/sessions', { projectId: project.id, agentId: 'claude' });
  const a = await post(`/api/sessions/${session.id}/messages`, { text: 'Please fail', mode: 'edit' });
  assert.equal((await post(`/api/sessions/${session.id}/approve`, { jobId: a.json.jobId })).status, 200);
  await waitFor(() => store.runs(session.id).items[0].status === 'failed');
  assert.equal((await post(`/api/sessions/${session.id}/runs/${a.json.jobId}/retry`, {}, 'bad')).status, 403);
  assert.equal(store.runs(session.id).total, 1);
  const b = await post(`/api/sessions/${session.id}/runs/${a.json.jobId}/retry`, {});
  assert.equal(b.status, 202);
  assert.notEqual(b.json.jobId, a.json.jobId);
  assert.equal(store.runs(session.id).items[0].status, 'awaiting_approval');
  assert.equal(store.runs(session.id).items[0].approvedAt, null);
  assert.equal((await post(`/api/sessions/${session.id}/reject`, { jobId: b.json.jobId })).status, 200);
  assert.equal(store.runs(session.id).items[0].status, 'rejected');
});

test('Per-file diff API is read-only, bounds file types and rejects unrelated paths', async t => {
  const { root, base, project, post, store } = await setup(t);
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', 'README.md']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Tester', '-c', 'user.email=test@example.com', 'commit', '-qm', 'initial']);
  const { json: session } = await post('/api/sessions', { projectId: project.id, agentId: 'demo' });
  const { json: job } = await post(`/api/sessions/${session.id}/messages`, { text: 'Edit in worktree', mode: 'edit', workspaceMode: 'worktree' });
  assert.equal((await post(`/api/sessions/${session.id}/approve`, { jobId: job.jobId })).status, 200);
  await waitFor(() => store.session(session.id).lastRun?.outcome === 'completed');
  const workspace = store.session(session.id).workspaces[0];
  fs.writeFileSync(path.join(workspace.path, 'README.md'), 'updated worktree only\n');
  fs.writeFileSync(path.join(workspace.path, 'new.txt'), 'created by agent\n');
  const route = `${base}/api/sessions/${session.id}/workspaces/${workspace.id}`;
  const changes = await (await fetch(`${route}/changes`)).json();
  assert.ok(changes.changed.some(x => x.path === 'new.txt'));
  const diff = await (await fetch(`${route}/diff?path=README.md`)).json();
  assert.equal(diff.kind, 'text');
  assert.match(diff.content, /updated worktree only/);
  const untracked = await (await fetch(`${route}/diff?path=new.txt`)).json();
  assert.match(untracked.content, /created by agent/);
  assert.equal((await fetch(`${route}/diff?path=..%2F..%2Fsecret`)).status, 404);
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), '# Hello from tests\n');
});

test('V0.6 bootstrap includes a process identity that changes after restart', async t => {
  const a = await setup(t);
  assert.equal(a.bootstrap.version, '0.10.0');
  assert.match(a.bootstrap.bootId, /^[0-9a-f-]{36}$/);
  const b = await setup(t);
  assert.notEqual(a.bootstrap.bootId, b.bootstrap.bootId);
  const health = await (await fetch(`${a.base}/api/health`)).json();
  assert.equal(health.version, '0.10.0');
});

test('SSE announces boot ID and broadcasts session/project catalog mutations across windows', async t => {
  const { base, bootstrap, post, project } = await setup(t);
  const controller = new AbortController();
  const events = await fetch(`${base}/api/events`, { signal: controller.signal });
  assert.equal(events.status, 200);
  const reader = events.body.getReader();
  t.after(() => controller.abort());
  let text = '';
  const readUntil = async predicate => {
    const expire = Date.now() + 2500;
    while (!predicate(text)) {
      if (Date.now() > expire) throw new Error('timed out waiting for SSE event');
      const { done, value } = await reader.read();
      if (done) throw new Error('SSE stream ended early');
      text += Buffer.from(value).toString('utf8');
    }
  };
  await readUntil(buffer => buffer.includes('event: ready\n') && buffer.includes(bootstrap.bootId));
  const created = await post('/api/sessions', { agentId: 'demo', projectId: project.id });
  assert.equal(created.status, 201);
  await readUntil(buffer => buffer.includes('"scope":"catalog","action":"session"'));
  const updated = await fetch(`${base}/api/sessions/${created.json.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-AgentDock-Token': bootstrap.token },
    body: JSON.stringify({ title: 'Renamed in second window' })
  });
  assert.equal(updated.status, 200);
  await readUntil(buffer => buffer.includes('"scope":"catalog","action":"rename"'));
  controller.abort();
});


test('remote CLI reset HTTP endpoint rejects stale tokens, stale IDs and active tasks', async t => {
  const { base, project, post, store, runner } = await setup(t, {
    spawnImpl: (cmd, args, options) => spawn(process.execPath, [fake, cmd, ...args], options)
  });
  const created = await post('/api/sessions', { projectId: project.id, agentId: 'codex' });
  const sid = created.json.id;
  const session = store.session(sid);
  assert.equal((await post(`/api/sessions/${sid}/reset-remote`, { expectedRemoteId: 'old' })).status, 409);
  await post(`/api/sessions/${sid}/messages`, { text: 'initial' });
  for (let i = 0; i < 150 && session.status !== 'idle'; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(session.remoteId, 'fake-codex-session');
  assert.equal((await post(`/api/sessions/${sid}/reset-remote`, { expectedRemoteId: session.remoteId }, 'wrong')).status, 403);
  assert.equal((await post(`/api/sessions/${sid}/reset-remote`, { expectedRemoteId: 'stale-id' })).status, 409);
  const prior = session.messages.length;
  const result = await post(`/api/sessions/${sid}/reset-remote`, { expectedRemoteId: session.remoteId });
  assert.equal(result.status, 200);
  assert.equal(result.json.remoteId, null);
  assert.equal(session.remoteId, null);
  assert.equal(session.messages.length, prior, 'app history must be preserved');
  assert.equal((await post(`/api/sessions/${sid}/reset-remote`, { expectedRemoteId: 'fake-codex-session' })).status, 409);
  session.remoteId = 'restored';
  await post(`/api/sessions/${sid}/messages`, { text: 'slow task' });
  for (let i = 0; i < 150 && session.status !== 'running'; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(session.status, 'running');
  assert.equal((await post(`/api/sessions/${sid}/reset-remote`, { expectedRemoteId: 'restored' })).status, 409);
  runner.stop(sid);
});

test('HTTP worktree patch export is text-only, bounded and read-only', async t => {
  const { base, project, root, store, post } = await setup(t);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: root });
  const created = await post('/api/sessions', { projectId: project.id, agentId: 'demo' });
  const sid = created.json.id;
  const { createIsolatedWorktree } = await import('../src/worktrees.mjs');
  const workspace = createIsolatedWorktree({ projectRoot: root, dataDir: store.dir, jobId: 'd9416c5c-2fd3-4d53-9109-2e8e95d9dc5b' });
  const session = store.session(sid);
  session.workspaces.push(workspace);
  store.save();
  fs.writeFileSync(path.join(workspace.path, 'new.txt'), 'hello\n');
  const url = `${base}/api/sessions/${sid}/workspaces/${workspace.id}/patch?path=new.txt`;
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  assert.match(res.headers.get('content-type'), /text\/x-diff/);
  const content = await res.text();
  assert.match(content, /new file mode 100644/);
  assert.equal(fs.existsSync(path.join(root, 'new.txt')), false);
  const invalid = await fetch(`${base}/api/sessions/${sid}/workspaces/${workspace.id}/patch?path=..%2F..%2Fpasswd`);
  assert.ok([403, 404].includes(invalid.status));
  fs.writeFileSync(path.join(workspace.path, 'raw.bin'), Buffer.from([0, 1]));
  assert.equal((await fetch(`${base}/api/sessions/${sid}/workspaces/${workspace.id}/patch?path=raw.bin`)).status, 422);
});

test('UI helper module is served from same-origin for frontend imports', async t => {
  const { base } = await setup(t);
  const r = await fetch(`${base}/ui-state.mjs`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/javascript/);
  assert.match(await r.text(), /function startupSelection/);
  assert.equal((await fetch(`${base}/ui-state.mjs/extra`)).status, 404);
});

test('disconnected SSE clients release their server-side change listener', async t => {
  const { base, runner } = await setup(t);
  const start = runner.listenerCount('change');
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  await reader.read();
  assert.equal(runner.listenerCount('change'), start + 1);
  controller.abort();
  for (let i = 0; i < 70 && runner.listenerCount('change') !== start; i++) {
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  assert.equal(runner.listenerCount('change'), start);
});

test('V0.9 local provider logos are SVG-only and prevent arbitrary file access', async t => {
  const { base } = await setup(t);
  for (const name of ['codex.svg', 'claude-code.svg', 'antigravity.svg']) {
    const response = await fetch(base + '/brands/' + name);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^image\/svg\+xml/);
    assert.match(response.headers.get('content-security-policy') || '', /img-src 'self'/);
    const body = await response.text();
    assert.match(body, /<svg[^>]+viewBox=/);
    assert.doesNotMatch(body, /<(script|foreignObject|iframe)\b|\bonload\s*=/i);
  }
  assert.equal((await fetch(base + '/brands/unknown.svg')).status, 404);
});
