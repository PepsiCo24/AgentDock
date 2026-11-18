import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, InputError } from '../src/core.mjs';
import { Runner } from '../src/agents.mjs';
import { createApp } from '../src/server.mjs';
import { createIsolatedWorktree, worktreeFilePatch } from '../src/worktrees.mjs';

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-agent.mjs');
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw Error('test timed out'); await pause(12); }
}
function fixture(t, agentId = 'codex') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-v06-'));
  const store = new Store({ dataDir: path.join(root, 'data') });
  const project = store.addProject({ name: 'V06', path: root });
  const session = store.addSession({ agentId, projectId: project.id });
  const calls = [];
  const runner = new Runner(store, { demoDelay: 35, maxRunMs: 2000, spawnImpl: (cmd, args, options) => {
    calls.push({cmd, args}); return spawn(process.execPath, [fake, cmd, ...args], options);
  } });
  t.after(async () => {
    for (const id of new Set([...runner.active.keys(), ...runner.awaiting.keys()])) runner.stop(id);
    await until(() => runner.active.size === 0, 2000).catch(() => {});
    fs.rmSync(root, {recursive:true,force:true});
  });
  return { root, store, project, session, runner, calls };
}
function git(root, ...args) { return execFileSync('git', ['-C',root,...args], {encoding:'utf8'}); }
function worktree(t) {
  const {root,store} = fixture(t,'demo');
  git(root,'init','-q');
  git(root,'config','user.email','test@example.invalid');
  git(root,'config','user.name','Test');
  fs.writeFileSync(path.join(root,'README.md'),'before\n');
  git(root,'add','README.md'); git(root,'commit','-q','-m','baseline');
  // Worktree directory must be outside the Git project, matching production safety rules.
  const worktreeData = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-wt-v06-'));
  t.after(() => fs.rmSync(worktreeData, {recursive: true, force: true}));
  const wt = createIsolatedWorktree({projectRoot:root,dataDir:worktreeData,jobId:'fc162aea-8a77-4e64-8c10-c1ad9516a79d'});
  return {root,store,wt};
}
test('explicit remote reset retains history, rejects stale IDs and starts fresh', async t => {
  const {root,store,session,runner,calls} = fixture(t);
  runner.send(session.id,'initial');
  await until(() => session.lastRun?.outcome === 'completed');
  const previous = session.remoteId;
  assert.ok(previous);
  assert.throws(() => runner.resetRemote(session.id,'old-id'),InputError);
  const messages = session.messages.length;
  assert.equal(runner.resetRemote(session.id,previous).reset,true);
  assert.equal(session.remoteId,null);
  assert.equal(session.messages.length,messages);
  assert.equal(new Store({dataDir:path.join(root,'data')}).session(session.id).remoteId,null);
  runner.send(session.id,'next');
  await until(() => calls.length===2 && session.lastRun?.outcome==='completed');
  assert.ok(!calls[1].args.includes('resume'));
  assert.equal(store.runs(session.id).items[0].resumeMode,'new');
});
test('running or pending approval cannot reset a remote CLI context', async t => {
  const {session,runner} = fixture(t);
  session.remoteId='old';
  runner.send(session.id,'slow task');
  await until(() => session.status === 'running');
  assert.throws(() => runner.resetRemote(session.id,'old'),InputError);
  runner.stop(session.id);
  await until(() => session.status === 'stopped');
  runner.send(session.id,'edit something',[],'edit');
  assert.throws(() => runner.resetRemote(session.id,'old'),InputError);
});
test('failed resumed CLI run records warning and never auto-retries', async t => {
  const {session,store,runner,calls} = fixture(t,'claude');
  session.remoteId='old';
  runner.send(session.id,'Please fail');
  await until(() => session.lastRun?.outcome==='failed');
  assert.equal(store.runs(session.id).items[0].resumeWarning,true);
  await pause(50);
  assert.equal(calls.length,1);
});
test('bounded new-file text patch passes git apply check and leaves source untouched', t => {
  const {root,wt} = worktree(t);
  fs.writeFileSync(path.join(wt.path,'README.md'),'after\n');
  fs.writeFileSync(path.join(wt.path,'NEW.txt'),'hello\nworld\n');
  for (const f of ['README.md','NEW.txt']) {
    const patch = worktreeFilePatch(wt,f);
    assert.match(patch.content,/diff --git/);
    const check = spawnSync('git',['-C',root,'apply','--check','-'],{input:patch.content,encoding:'utf8'});
    assert.equal(check.status,0,check.stderr);
  }
  assert.equal(fs.readFileSync(path.join(root,'README.md'),'utf8'),'before\n');
  assert.ok(!fs.existsSync(path.join(root,'NEW.txt')));
});
test('patch export refuses symlink, binary and oversized files', t => {
  const {root,store,wt}=worktree(t);
  fs.writeFileSync(path.join(wt.path,'blob.bin'),Buffer.from([0,1]));
  fs.writeFileSync(path.join(wt.path,'big.txt'),'x'.repeat(40000));
  fs.writeFileSync(path.join(store.dir,'secret.txt'),'SECRET');
  fs.symlinkSync(path.join(store.dir,'secret.txt'),path.join(wt.path,'outside'));
  for(const f of ['blob.bin','big.txt','outside','../escaped']) assert.throws(()=>worktreeFilePatch(wt,f),InputError);
});
test('structured diagnostics do not inspect login or print environment secrets', () => {
  const file=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts/diagnose.mjs');
  const a=spawnSync(process.execPath,[file,'--json'],{encoding:'utf8',env:{...process.env,TEST_SECRET:'HIDE_ME'}} );
  assert.equal(a.status,0);
  const report=JSON.parse(a.stdout);
  assert.equal(report.authentication,'not-checked');
  assert.equal(report.compatibility,'not-verified');
  assert.equal(report.agents.length,4);
  assert.doesNotMatch(a.stdout,/HIDE_ME/);
});
test('reset HTTP requires token, current ID and idle session', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-http-v06-'));
  const app=createApp({dataDir:path.join(dir,'data'),demoDelay:50});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  t.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true})});
  const boot=await (await fetch(base+'/api/bootstrap')).json();
  assert.match(boot.bootId,/^[a-f0-9-]{36}$/);
  assert.equal(boot.version,'0.9.0');
  const project=app.store.addProject({name:'Demo',path:dir});
  const session=app.store.addSession({projectId:project.id,agentId:'codex'});
  session.remoteId='valid-id';app.store.save();
  const submit=(id,token=boot.token)=>fetch(base+'/api/sessions/'+session.id+'/reset-remote',{method:'POST',headers:{'Content-Type':'application/json','X-AgentDock-Token':token},body:JSON.stringify({expectedRemoteId:id})});
  assert.equal((await submit('valid-id','wrong')).status,403);
  assert.equal((await submit('wrong')).status,409);
  assert.equal((await submit('valid-id')).status,200);
  assert.equal(session.remoteId,null);
});
test('UI exposes explicit reset, patch export and connection state',()=>{
  const publicDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
  const html=fs.readFileSync(path.join(publicDir,'index.html'),'utf8');
  const js=fs.readFileSync(path.join(publicDir,'app.js'),'utf8');
  assert.match(html,/id="reset-cli-context"/);
  assert.match(html,/id="connection-state"/);
  assert.match(js,/resetRemote\.onclick/);
  assert.match(js,/workspace-patch-download/);
  assert.match(js,/events\.addEventListener\('ready'/);
});
