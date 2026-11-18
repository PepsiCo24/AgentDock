import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Store, InputError, resolveProjectFile, within } from './core.mjs';
import { installedAgents, agentDiagnostics, Runner } from './agents.mjs';
import { worktreeChanges, worktreeFileDiff, worktreeFilePatch } from './worktrees.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, '../public');
const sampleRoot = path.resolve(here, '../examples/sample-project');
const APP_VERSION = '0.11.0';
const MAX_JSON_BYTES = 64 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 700 * 1024;
const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const safeMedia = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let exceeded = false;
    const parts = [];
    req.on('data', piece => {
      size += piece.length;
      if (size > limit) {
        exceeded = true;
        return;
      }
      if (!exceeded) parts.push(piece);
    });
    req.on('end', () => exceeded ? reject(new InputError('请求数据超过允许的大小', 413)) : resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const type = req.headers['content-type'] || '';
  if (!type.toLowerCase().startsWith('application/json')) throw new InputError('必须使用 application/json', 415);
  const buf = await readBody(req, MAX_JSON_BYTES);
  try {
    const parsed = JSON.parse(buf.toString('utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('not object');
    return parsed;
  } catch { throw new InputError('JSON 请求格式错误'); }
}

function safeFileName(name) {
  if (typeof name !== 'string' || name.length < 1 || name.length > 180 ||
    name === '.' || name === '..' || /[\\/\0-\x1f<>:"|?*]/.test(name)) {
    throw new InputError('无效文件名');
  }
  return name;
}

function uploadFile(project, fileName, data) {
  safeFileName(fileName);
  const root = fs.realpathSync(project.path);
  const uploadRoot = path.join(root, '.agentdock');
  fs.mkdirSync(uploadRoot, { recursive: true, mode: 0o700 });
  const realParent = fs.realpathSync(uploadRoot);
  if (!within(root, realParent)) throw new InputError('上传目录不安全', 403);
  const uploadDir = path.join(realParent, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
  const realDir = fs.realpathSync(uploadDir);
  if (!within(root, realDir)) throw new InputError('上传目录不安全', 403);
  const saved = `${randomUUID().slice(0, 8)}-${fileName}`;
  const absolute = path.join(realDir, saved);
  const fd = fs.openSync(absolute, 'wx', 0o600);
  try { fs.writeFileSync(fd, data); }
  finally { fs.closeSync(fd); }
  return { name: fileName, path: path.relative(root, absolute), size: data.length };
}

function previewFile(project, relPath) {
  const full = resolveProjectFile(project.path, relPath);
  const stat = fs.statSync(full);
  if (!stat.isFile()) throw new InputError('不能预览文件夹');
  const ext = path.extname(full).toLowerCase();
  if (safeMedia.has(ext)) {
    if (stat.size > MAX_UPLOAD_BYTES) throw new InputError('图片过大，无法预览', 413);
    return { kind: 'image', name: path.basename(full), size: stat.size };
  }
  if (stat.size > MAX_PREVIEW_BYTES) throw new InputError('文本文件太大，无法预览', 413);
  const bytes = fs.readFileSync(full);
  if (bytes.includes(0)) throw new InputError('当前暂不支持该二进制文件的预览');
  return { kind: 'text', name: path.basename(full), size: stat.size, content: bytes.toString('utf8') };
}

function revealFile(project, relPath) {
  const full = resolveProjectFile(project.path, relPath);
  let cmd, args;
  if (process.platform === 'darwin') [cmd, args] = ['open', ['-R', full]];
  else if (process.platform === 'win32') [cmd, args] = ['explorer.exe', [`/select,${full}`]];
  else [cmd, args] = ['xdg-open', [fs.statSync(full).isDirectory() ? full : path.dirname(full)]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true, shell: false });
  child.on('error', () => {});
  child.unref();
}

export function createApp({ dataDir, demoDelay, spawnImpl } = {}) {
  const store = new Store({ dataDir, sampleRoot });
  const runner = new Runner(store, { demoDelay, ...(spawnImpl ? { spawnImpl } : {}) });
  const token = randomBytes(32).toString('hex');
  const bootId = randomUUID();
  const server = http.createServer((req, res) => {
    // Strict host check prevents DNS-rebinding access to privileged local endpoints.
    const host = req.headers.host || '';
    const allowedHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    if (!allowedHost) return json(res, 403, { error: '只允许从本机访问 AgentDock' });
    const origin = req.headers.origin;
    if (origin && !new RegExp('^https?://(localhost|127\\.0\\.0\\.1)(:\\d+)?$').test(origin)) {
      return json(res, 403, { error: '跨站请求已被拒绝' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;

    async function dispatch() {
      if (!['GET', 'POST', 'PATCH'].includes(req.method)) throw new InputError('不支持的请求方式', 405);
      if (req.method !== 'GET' && req.headers['x-agentdock-token'] !== token) {
        throw new InputError('缺少本地会话安全令牌', 403);
      }
      if (req.method === 'GET' && pathname === '/api/bootstrap') {
        return json(res, 200, { token, agents: installedAgents(), projects: store.projects(), sessions: store.sessions(), bootId, version: APP_VERSION });
      }
      if (req.method === 'GET' && pathname === '/api/agents/diagnostics') return json(res, 200, agentDiagnostics());
      if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { status: 'ok', version: APP_VERSION });
      if (req.method === 'GET' && pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`event: ready\ndata: ${JSON.stringify({ bootId })}\n\n`);
        const listener = event => { if (!res.writableEnded) res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`); };
        runner.on('change', listener);
        const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 25000);
        res.on('close', () => { runner.off('change', listener); clearInterval(heartbeat); });
        heartbeat.unref?.();
        return;
      }
      if (req.method === 'POST' && pathname === '/api/projects') {
        const project = store.addProject(await readJson(req));
        runner.emit('change', { scope: 'catalog', action: 'project' });
        return json(res, 201, project);
      }
      if (req.method === 'POST' && pathname === '/api/sessions') {
        const session = store.addSession(await readJson(req));
        runner.emit('change', { scope: 'catalog', action: 'session' });
        return json(res, 201, session);
      }
      if (req.method === 'GET' && pathname === '/api/sessions') return json(res, 200, store.sessions());
      const runRoute = pathname.match(/^\/api\/sessions\/([0-9a-f-]+)\/runs(?:\/([0-9a-f-]+)\/retry)?$/i);
      if (runRoute) {
        if (req.method === 'GET' && !runRoute[2]) {
          return json(res, 200, store.runs(runRoute[1], {
            limit: Number(url.searchParams.get('limit') ?? 20),
            offset: Number(url.searchParams.get('offset') ?? 0)
          }));
        }
        if (req.method === 'POST' && runRoute[2]) {
          await readJson(req);
          return json(res, 202, runner.retry(runRoute[1], runRoute[2]));
        }
      }
      const sessionRoute = pathname.match(/^\/api\/sessions\/([0-9a-f-]+)(?:\/(messages|stop|approve|reject|reset-remote))?$/i);
      if (sessionRoute) {
        const id = sessionRoute[1];
        const action = sessionRoute[2];
        if (req.method === 'GET' && !action) return json(res, 200, store.sessionView(id));
        if (req.method === 'PATCH' && !action) {
          const data = await readJson(req);
          store.renameSession(store.session(id), data.title);
          runner.emit('change', { scope: 'catalog', action: 'rename', sessionId: id });
          return json(res, 200, store.sessionView(id));
        }
        if (req.method === 'POST' && action === 'messages') {
          const data = await readJson(req);
          return json(res, 202, runner.send(id, data.text, data.attachments || [], data.mode || 'plan', data.workspaceMode || 'project'));
        }
        if (req.method === 'POST' && action === 'stop') {
          await readJson(req);
          return json(res, 200, runner.stop(id));
        }
        if (req.method === 'POST' && action === 'reset-remote') {
          const data = await readJson(req);
          return json(res, 200, runner.resetRemote(id, data.expectedRemoteId));
        }
        if (req.method === 'POST' && action === 'approve') {
          const data = await readJson(req);
          return json(res, 200, runner.approve(id, data.jobId));
        }
        if (req.method === 'POST' && action === 'reject') {
          const data = await readJson(req);
          return json(res, 200, runner.reject(id, data.jobId));
        }
      }
      const workspaceRoute = pathname.match(/^\/api\/sessions\/([0-9a-f-]+)\/workspaces\/([0-9a-f-]+)\/(changes|diff|patch|reveal)$/i);
      if (workspaceRoute) {
        const session = store.session(workspaceRoute[1]);
        const workspace = (session.workspaces || []).find(w => w.id === workspaceRoute[2]);
        if (!workspace) throw new InputError('未找到该会话的隔离工作区', 404);
        const poolPath = path.join(store.dir, 'worktrees');
        if (!fs.existsSync(poolPath) || !fs.existsSync(workspace.path)) throw new InputError('工作区目录不存在', 404);
        const workspacePool = fs.realpathSync(poolPath);
        if (!within(workspacePool, fs.realpathSync(workspace.path)) || fs.realpathSync(workspace.path) !== workspace.path) {
          throw new InputError('工作区路径不安全', 403);
        }
        if (req.method === 'GET' && workspaceRoute[3] === 'changes') return json(res, 200, worktreeChanges(workspace));
        if (req.method === 'GET' && workspaceRoute[3] === 'diff') {
          return json(res, 200, worktreeFileDiff(workspace, url.searchParams.get('path')));
        }
        if (req.method === 'GET' && workspaceRoute[3] === 'patch') {
          const result = worktreeFilePatch(workspace, url.searchParams.get('path'));
          const name = path.basename(result.path).replace(/[\\"\r\n]/g, '_') + '.patch';
          res.writeHead(200, { 'Content-Type': 'text/x-diff; charset=utf-8', 'Cache-Control': 'no-store',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });
          return res.end(result.content);
        }
        if (req.method === 'POST' && workspaceRoute[3] === 'reveal') {
          await readJson(req);
          revealFile({ path: workspace.path }, '.');
          return json(res, 200, { opened: true });
        }
      }
      const projectRoute = pathname.match(/^\/api\/projects\/([0-9a-f-]+)\/(files|search|preview|raw|download|upload|reveal)$/i);
      if (projectRoute) {
        const project = store.project(projectRoute[1]);
        const action = projectRoute[2];
        const rel = url.searchParams.get('path') || '.';
        if (req.method === 'GET' && action === 'files') return json(res, 200, store.files(project.id, rel));
        if (req.method === 'GET' && action === 'search') return json(res, 200, store.searchFiles(project.id, url.searchParams.get('q') || ''));
        if (req.method === 'GET' && action === 'preview') return json(res, 200, previewFile(project, rel));
        if (req.method === 'GET' && action === 'raw') {
          const file = resolveProjectFile(project.path, rel);
          const ext = path.extname(file).toLowerCase();
          if (!safeMedia.has(ext) || !fs.statSync(file).isFile()) throw new InputError('仅支持图片预览', 415);
          if (fs.statSync(file).size > MAX_UPLOAD_BYTES) throw new InputError('图片过大', 413);
          res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-store', 'Content-Disposition': 'inline' });
          return fs.createReadStream(file).pipe(res);
        }
        if (req.method === 'GET' && action === 'download') {
          const file = resolveProjectFile(project.path, rel);
          const stat = fs.statSync(file);
          if (!stat.isFile()) throw new InputError('不能下载目录');
          if (stat.size > MAX_DOWNLOAD_BYTES) throw new InputError('文件超过下载大小限制', 413);
          const name = path.basename(file).replace(/[\\"\r\n]/g, '_');
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'Content-Length': stat.size });
          return fs.createReadStream(file).pipe(res);
        }
        if (req.method === 'POST' && action === 'upload') {
          if (req.headers['content-type'] !== 'application/octet-stream') throw new InputError('上传必须使用 application/octet-stream', 415);
          const body = await readBody(req, MAX_UPLOAD_BYTES);
          return json(res, 201, uploadFile(project, url.searchParams.get('name'), body));
        }
        if (req.method === 'POST' && action === 'reveal') {
          const data = await readJson(req);
          revealFile(project, data.path);
          return json(res, 200, { opened: true });
        }
      }
      if (req.method === 'GET' && (pathname === '/' || ['/app.js', '/ui-state.mjs', '/styles.css', '/apple-hig.css', '/appearance.mjs', '/favicon.svg', '/brands/codex.svg', '/brands/claude-code.svg', '/brands/antigravity.svg'].includes(pathname))) {
        const file = path.join(staticDir, pathname === '/' ? 'index.html' : pathname.slice(1));
        const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-store' });
        return fs.createReadStream(file).pipe(res);
      }
      return json(res, 404, { error: '未找到该接口' });
    }
    void dispatch().catch(err => {
      if (res.writableEnded || res.destroyed) return;
      const code = err instanceof InputError ? err.status : 500;
      if (code === 500) console.error('Request error:', err);
      json(res, code, { error: code === 500 ? '服务器内部错误，请查看终端日志' : err.message });
    });
  });
  return { server, store, runner };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535');
  const { server } = createApp();
  server.listen(port, '127.0.0.1', () => {
    console.log(`AgentDock V${APP_VERSION} is ready: http://127.0.0.1:${port}`);
    console.log('Local-only mode. Remote access is disabled by default.');
  });
}
