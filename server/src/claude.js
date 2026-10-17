import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IS_WIN = process.platform === 'win32';
const BIN = process.env.CLAUDE_BIN || 'claude';
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.CLAUDE_RATE_LIMIT_COOLDOWN_MS || 15 * 60_000);
const RECHECK_MS = 60_000;

// cwd neutro: evita que o CLI carregue CLAUDE.md/hooks do projeto do usuário.
const SANDBOX = join(tmpdir(), 'prompter-mchiodi-claude');
mkdirSync(SANDBOX, { recursive: true });

// Com shell (Windows, para aceitar claude.cmd) o argumento vazio precisa ir entre aspas.
const EMPTY_ARG = IS_WIN ? '""' : '';
const BASE_ARGS = process.env.CLAUDE_ARGS
  ? process.env.CLAUDE_ARGS.split(' ').filter(Boolean)
  : [
      '-p',
      '--output-format', 'json',
      '--tools', EMPTY_ARG,
      '--strict-mcp-config',
      '--setting-sources', 'local',
      '--no-session-persistence',
    ];

const status = {
  installed: null,
  version: null,
  auth: 'unknown',
  limitedUntil: 0,
  checkedAt: 0,
  lastError: null,
  lastOkAt: null,
};

const busyLanes = new Set();

function childEnv() {
  const env = { ...process.env };
  // Requisito: só login de assinatura do CLI. Nunca deixar chave de API vazar para o processo.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

function fail(code, message) {
  status.lastError = { code, message, at: Date.now() };
  if (code === 'not_installed') status.installed = false;
  if (code === 'not_logged_in') status.auth = 'missing';
  if (code === 'rate_limited') status.limitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  status.checkedAt = Date.now();
  return { ok: false, code, message };
}

function killTree(child) {
  if (!child.pid) return;
  if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGKILL');
}

function exec(args, { input, timeoutMs }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(BIN, args, { cwd: SANDBOX, env: childEnv(), shell: IS_WIN, windowsHide: true });
    } catch (e) {
      resolve({ spawnError: e });
      return;
    }
    let out = '';
    let err = '';
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      killTree(child);
      finish({ timedOut: true, out, err });
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => finish({ spawnError: e, out, err }));
    child.on('close', (code) => finish({ code, out, err }));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

function looksNotInstalled(r) {
  if (r.spawnError) return r.spawnError.code === 'ENOENT';
  return r.code === 9009 || r.code === 127 || /not recognized|não é reconhecido|command not found/i.test(r.err);
}

function parseResult(out) {
  const trimmed = out.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const lastLine = trimmed.split('\n').reverse().find((l) => l.trim().startsWith('{'));
    try {
      return lastLine ? JSON.parse(lastLine) : null;
    } catch {
      return null;
    }
  }
}

function interpret(r, timeoutMs) {
  if (r.timedOut) return fail('timeout', `Claude CLI não respondeu em ${Math.round(timeoutMs / 1000)} s`);
  if (looksNotInstalled(r)) return fail('not_installed', 'Claude Code CLI não encontrado no PATH (instale e rode `claude` uma vez).');
  if (r.spawnError) return fail('spawn_error', r.spawnError.message);

  const parsed = parseResult(r.out);
  if (parsed && parsed.is_error === false && parsed.subtype === 'success') {
    status.installed = true;
    status.auth = 'ok';
    status.lastOkAt = Date.now();
    status.lastError = null;
    return { ok: true, text: String(parsed.result ?? ''), durationMs: parsed.duration_ms ?? null };
  }

  const msg = String((parsed && parsed.result) || r.err || r.out || `exit ${r.code}`).trim();
  if (/usage limit|rate.?limit|limit reached|too many requests|\b429\b|quota|overloaded/i.test(msg)) {
    return fail('rate_limited', msg.slice(0, 400));
  }
  if (/\/login|not logged|log ?in|authenticat|invalid api key|oauth|credential/i.test(msg)) {
    return fail('not_logged_in', 'Claude Code não está logado. Rode `claude` no terminal e faça /login com sua assinatura.');
  }
  return fail('cli_error', msg.slice(0, 400));
}

/** Motivo pelo qual o CLI não deve ser chamado agora, ou null se pode. */
export function unavailableReason() {
  const now = Date.now();
  if (now < status.limitedUntil) return 'rate_limited';
  const stale = now - status.checkedAt > RECHECK_MS;
  if (status.installed === false && !stale) return 'not_installed';
  if (status.auth === 'missing' && !stale) return 'not_logged_in';
  return null;
}

export async function probe() {
  const r = await exec(['--version'], { timeoutMs: 15_000 });
  status.checkedAt = Date.now();
  if (r.timedOut || r.spawnError || looksNotInstalled(r) || r.code !== 0) {
    status.installed = false;
    status.version = null;
    status.lastError = { code: 'not_installed', message: 'Claude Code CLI não encontrado no PATH (instale e rode `claude` uma vez).', at: Date.now() };
  } else {
    status.installed = true;
    status.version = r.out.trim().split('\n')[0];
  }
  return publicStatus();
}

export function publicStatus() {
  const reason = unavailableReason();
  return {
    available: reason === null && status.installed !== false,
    reason: reason ?? (status.installed === false ? 'not_installed' : null),
    installed: status.installed,
    version: status.version,
    auth: status.auth,
    limitedUntil: status.limitedUntil || null,
    lastError: status.lastError,
    lastOkAt: status.lastOkAt,
  };
}

/**
 * Executa `claude -p --output-format json` com o prompt via stdin.
 * lane: uma chamada por vez por tipo de uso (preprocess/reanchor/review).
 */
export async function runClaude(prompt, { lane, timeoutMs = 60_000, model } = {}) {
  const reason = unavailableReason();
  if (reason) return { ok: false, code: reason, message: status.lastError?.message ?? reason };
  if (lane && busyLanes.has(lane)) return { ok: false, code: 'busy', message: `já existe uma chamada "${lane}" em andamento` };

  const args = [...BASE_ARGS];
  if (model) args.push('--model', model);
  if (lane) busyLanes.add(lane);
  try {
    const r = await exec(args, { input: prompt, timeoutMs });
    return interpret(r, timeoutMs);
  } finally {
    if (lane) busyLanes.delete(lane);
  }
}

/** Extrai o primeiro objeto JSON de uma resposta em texto (tolera cercas ```json). */
export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('resposta sem JSON');
  return JSON.parse(text.slice(start, end + 1));
}
