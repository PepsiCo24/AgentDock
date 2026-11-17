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
