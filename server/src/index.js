import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractJson, probe, publicStatus, runClaude } from './claude.js';
import { preprocessPrompt, reanchorPrompt, reviewPrompt } from './prompts.js';
import { createWatcher } from './watcher.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.env.PORT || 5179);
const HOST = process.env.HOST || '127.0.0.1';
const WATCH_DIR = resolve(process.env.WATCH_DIR || join(ROOT, 'roteiros'));
const CACHE_DIR = join(ROOT, '.cache', 'preprocess');
const WEB_DIST = join(ROOT, 'web', 'dist');
const MODEL_FAST = process.env.CLAUDE_MODEL_FAST || 'haiku';
const MODEL_MAIN = process.env.CLAUDE_MODEL || undefined;
const MAX_BODY = 2 * 1024 * 1024;

mkdirSync(CACHE_DIR, { recursive: true });

const sseClients = new Set();
const inflightPreprocess = new Map();

const watcher = createWatcher(WATCH_DIR, (name) => {
  broadcast({ type: 'changed', name });
  broadcast({ type: 'files', files: watcher.list() });
});

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('payload muito grande'), { status: 413 });
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function claudeFailure(res, r) {
  send(res, r.code === 'busy' ? 409 : 503, { ok: false, code: r.code, message: r.message, claude: publicStatus() });
}

async function handlePreprocess(req, res) {
  const { markdown } = await readBody(req);
  if (typeof markdown !== 'string' || !markdown.trim()) return send(res, 400, { ok: false, code: 'bad_request' });

  const hash = createHash('sha256').update(markdown).digest('hex');
  const file = join(CACHE_DIR, `${hash}.json`);
  if (existsSync(file)) return send(res, 200, { ok: true, cached: true, hash, data: JSON.parse(readFileSync(file, 'utf8')) });

  let job = inflightPreprocess.get(hash);
  if (!job) {
    job = (async () => {
      const r = await runClaude(preprocessPrompt(markdown), { timeoutMs: 180_000, model: MODEL_MAIN });
      if (!r.ok) return r;
      try {
        const data = sanitizePreprocess(extractJson(r.text));
        writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
        return { ok: true, data };
      } catch (e) {
        return { ok: false, code: 'bad_output', message: e.message };
      }
    })().finally(() => inflightPreprocess.delete(hash));
    inflightPreprocess.set(hash, job);
  }
  const r = await job;
  if (!r.ok) return claudeFailure(res, r);
  send(res, 200, { ok: true, cached: false, hash, data: r.data });
}

function sanitizePreprocess(raw) {
  const sections = Array.isArray(raw.sections)
    ? raw.sections.map((s) => ({ title: String(s?.title ?? ''), estimatedSeconds: Math.max(0, Number(s?.estimatedSeconds) || 0) }))
    : [];
  const aliases = {};
  if (raw.aliases && typeof raw.aliases === 'object') {
    for (const [term, list] of Object.entries(raw.aliases)) {
      if (!Array.isArray(list)) continue;
      const clean = list.map((v) => String(v).toLowerCase().trim()).filter(Boolean).slice(0, 8);
      if (clean.length) aliases[term] = clean;
    }
  }
  const cues = Array.isArray(raw.cues) ? raw.cues.map(String).filter((c) => c.trim().length > 1) : [];
  return { sections, aliases, cues };
}

async function handleReanchor(req, res) {
  const { transcript, lines } = await readBody(req);
  if (typeof transcript !== 'string' || !Array.isArray(lines)) return send(res, 400, { ok: false, code: 'bad_request' });
  const r = await runClaude(reanchorPrompt({ transcript, lines }), { lane: 'reanchor', timeoutMs: 30_000, model: MODEL_FAST });
  if (!r.ok) return claudeFailure(res, r);
  try {
    const j = extractJson(r.text);
    const index = Number.isInteger(j.index) ? j.index : null;
    send(res, 200, { ok: true, index, confidence: Number(j.confidence) || 0, durationMs: r.durationMs });
  } catch (e) {
    send(res, 502, { ok: false, code: 'bad_output', message: e.message });
  }
}

async function handleReview(req, res) {
  const { segments, sentences } = await readBody(req);
  if (!Array.isArray(segments) || !Array.isArray(sentences)) return send(res, 400, { ok: false, code: 'bad_request' });
  const r = await runClaude(reviewPrompt({ segments, sentences }), { lane: 'review', timeoutMs: 240_000, model: MODEL_MAIN });
  if (!r.ok) return claudeFailure(res, r);
  try {
    send(res, 200, { ok: true, data: extractJson(r.text) });
  } catch (e) {
    send(res, 502, { ok: false, code: 'bad_output', message: e.message });
  }
}

function handleEvents(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify({ type: 'files', files: watcher.list() })}\n\n`);
  sseClients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png' };

function serveStatic(req, res, pathname) {
  if (!existsSync(WEB_DIST)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Front não compilado. Use `npm run dev` (Vite em :5173) ou `npm run build`.');
  }
  let file = normalize(join(WEB_DIST, decodeURIComponent(pathname)));
  if (!file.startsWith(WEB_DIST) || !existsSync(file) || pathname === '/') file = join(WEB_DIST, 'index.html');
  res.writeHead(200, { 'content-type': `${MIME[extname(file)] ?? 'application/octet-stream'}; charset=utf-8` });
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url ?? '/', `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return send(res, 200, { ok: true, claude: publicStatus(), watchDir: WATCH_DIR });
    }
    if (req.method === 'POST' && pathname === '/api/claude/probe') return send(res, 200, { ok: true, claude: await probe() });
    if (req.method === 'POST' && pathname === '/api/preprocess') return await handlePreprocess(req, res);
    if (req.method === 'POST' && pathname === '/api/reanchor') return await handleReanchor(req, res);
    if (req.method === 'POST' && pathname === '/api/review') return await handleReview(req, res);
    if (req.method === 'GET' && pathname === '/api/files') return send(res, 200, { ok: true, dir: WATCH_DIR, files: watcher.list() });
    if (req.method === 'GET' && pathname === '/api/file') {
      const full = watcher.resolve(searchParams.get('name'));
      if (!full) return send(res, 404, { ok: false, code: 'not_found' });
      return send(res, 200, { ok: true, name: searchParams.get('name'), content: readFileSync(full, 'utf8') });
    }
    if (req.method === 'GET' && pathname === '/api/events') return handleEvents(req, res);
    if (pathname.startsWith('/api/')) return send(res, 404, { ok: false, code: 'not_found' });
    if (req.method === 'GET') return serveStatic(req, res, pathname);
    send(res, 405, { ok: false });
  } catch (e) {
    send(res, e.status ?? 500, { ok: false, code: 'server_error', message: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[prompter] API em http://${HOST}:${PORT}  |  pasta monitorada: ${WATCH_DIR}`);
  probe().then((s) => {
    console.log(s.installed ? `[claude] CLI encontrado (${s.version}) — extras de IA habilitados` : '[claude] CLI não encontrado — app segue sem IA');
  });
});

process.on('SIGINT', () => {
  watcher.close();
  process.exit(0);
});
