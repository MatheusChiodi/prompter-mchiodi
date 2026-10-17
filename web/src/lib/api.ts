export type ClaudeStatus = {
  available: boolean;
  reason: string | null;
  installed: boolean | null;
  version: string | null;
  auth: 'unknown' | 'ok' | 'missing';
  limitedUntil: number | null;
  lastError: { code: string; message: string } | null;
};

export type PreprocessData = {
  sections: { title: string; estimatedSeconds: number }[];
  aliases: Record<string, string[]>;
  cues: string[];
};

export type ReviewData = {
  improvised: { at: string; text: string }[];
  skipped: { fromWord: number; toWord: number; text: string }[];
  repeated: { at: string; text: string; times: number }[];
  summary?: string;
};

export type FileInfo = { name: string; size: number; mtime: number };

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; code: string; message?: string; claude?: ClaudeStatus };

async function call<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<ApiResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 10_000);
  try {
    const res = await fetch(path, {
      ...init,
      signal: ctrl.signal,
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!json) return { ok: false, code: 'backend_offline', message: 'Backend local indisponível' };
    return json as ApiResult<T>;
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError';
    return { ok: false, code: aborted ? 'timeout' : 'backend_offline', message: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

const post = <T>(path: string, body: unknown, timeoutMs: number) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body), timeoutMs });

export const api = {
  health: () => call<{ claude: ClaudeStatus; watchDir: string }>('/api/health', { timeoutMs: 3000 }),
  probe: () => post<{ claude: ClaudeStatus }>('/api/claude/probe', {}, 20_000),
  preprocess: (markdown: string) => post<{ cached: boolean; hash: string; data: PreprocessData }>('/api/preprocess', { markdown }, 200_000),
  reanchor: (transcript: string, lines: string[]) =>
    post<{ index: number | null; confidence: number }>('/api/reanchor', { transcript, lines }, 35_000),
  review: (segments: { t: number; text: string }[], sentences: { from: number; to: number; text: string }[]) =>
    post<{ data: ReviewData }>('/api/review', { segments, sentences }, 250_000),
  files: () => call<{ dir: string; files: FileInfo[] }>('/api/files', { timeoutMs: 3000 }),
  file: (name: string) => call<{ name: string; content: string }>(`/api/file?name=${encodeURIComponent(name)}`),
  events(onMessage: (data: any) => void): () => void {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch {
        /* ping */
      }
    };
    return () => es.close();
  },
};
