import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { api, type ClaudeStatus } from '../lib/api';
import { reason, useI18n } from '../lib/i18n';
import { sentences, type Script } from '../lib/markdown';
import { SessionLog, fmtTime } from '../lib/session-log';
import { clamp, type Settings } from '../lib/settings';
import { WebSpeechEngine } from '../lib/speech';
import {
  advance,
  initialState,
  nextSection,
  nextSentence,
  prevSection,
  prevSentence,
  sectionAt,
  setCursor,
  type TrackerState,
} from '../lib/tracker';
import { ReviewPanel } from './ReviewPanel';
import { ScriptView } from './ScriptView';

type Props = {
  script: Script;
  scriptName: string;
  take: number;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  claude: ClaudeStatus | null;
  preInfo: string | null;
  onExit: () => void;
};

const SILENCE_MS = 1500;
const CLAUDE_COOLDOWN_MS = 15_000;
const CLAUDE_MIN_CONFIDENCE = 0.55;

type AiState =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'applied'; index: number; conf: number }
  | { kind: 'ignored'; stale: boolean; conf: number }
  | { kind: 'failed'; code: string };

type Mode = 'off' | 'paused' | 'silent' | 'lost' | 'live';

export function Prompter({ script, scriptName, take, settings, onSettings, claude, preInfo, onExit }: Props) {
  const { t, lang } = useI18n();
  const words = script.words;
  const wordsRef = useRef(words);
  const committed = useRef<TrackerState>(initialState(0, performance.now()));
  const lastMatchAny = useRef(performance.now());
  const lastSpeechAt = useRef(0);
  const recentText = useRef<string[]>([]);
  const furthest = useRef(0);
  const logRef = useRef(new SessionLog(words.length));
  const engineRef = useRef<WebSpeechEngine | null>(null);
  const pausedRef = useRef(false);
  const aiInflight = useRef(false);
  const lastAskAt = useRef(0);
  const firstListenAt = useRef<number | null>(null);
  const flashNext = useRef(false);

  const [cursor, setCursorView] = useState(0);
  const [listening, setListening] = useState(false);
  const [paused, setPaused] = useState(false);
  const [interim, setInterim] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const [ai, setAi] = useState<AiState>({ kind: 'idle' });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(true);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const wordEls = useRef<(HTMLSpanElement | null)[]>([]);
  const targetScroll = useRef(0);
  const manualUntil = useRef(0);
  const shownCursor = useRef(-1);

  // Roteiro recarregado (pasta monitorada / pré-processamento): mantém a posição.
  useEffect(() => {
    if (wordsRef.current === words) return;
    if (wordsRef.current.length !== words.length) logRef.current = new SessionLog(words.length);
    wordsRef.current = words;
    const c = Math.min(committed.current.cursor, words.length);
    committed.current = setCursor(committed.current, c, performance.now());
    shownCursor.current = -1;
    setCursorView(c);
  }, [words]);

  const jump = useCallback((i: number) => {
    const c = clamp(i, 0, wordsRef.current.length);
    committed.current = setCursor(committed.current, c, performance.now());
    lastMatchAny.current = performance.now();
    flashNext.current = true;
    setCursorView(c);
    setInterim('');
  }, []);

  // ---- STT ----
  useEffect(() => {
    const engine = new WebSpeechEngine(settings.lang, {
      onListening: (on) => {
        setListening(on);
        if (on && firstListenAt.current === null) firstListenAt.current = performance.now();
      },
      onError: (code) => setErrorCode(code),
      onFinal: (spoken, text) => {
        const ts = performance.now();
        lastSpeechAt.current = ts;
        if (!spoken.length) return;
        recentText.current.push(...text.split(/\s+/));
        recentText.current = recentText.current.slice(-60);
        if (pausedRef.current) return;
        const r = advance(committed.current, wordsRef.current, spoken, ts);
        committed.current = r.state;
        if (r.hits.length) lastMatchAny.current = ts;
        if (r.reanchored) flashNext.current = true;
        furthest.current = Math.max(furthest.current, r.state.cursor);
        logRef.current.record(text, r.hits, r.missed);
        setCursorView(r.state.cursor);
        setInterim('');
      },
      onInterim: (spoken, text) => {
        if (!spoken.length) return;
        const ts = performance.now();
        lastSpeechAt.current = ts;
        if (pausedRef.current) return;
        setInterim(text);
        // Cursor provisório = estado confirmado + fala parcial; recalculado a cada evento.
        const r = advance(committed.current, wordsRef.current, spoken, ts);
        if (r.hits.length) lastMatchAny.current = ts;
        setCursorView(r.state.cursor);
      },
    });
    engineRef.current = engine;
    return () => engine.stop();
  }, [settings.lang]);

  const toggleListen = useCallback(() => {
    setErrorCode(null);
    setKeysOpen(false);
    if (listening) engineRef.current?.stop();
    else engineRef.current?.start();
  }, [listening]);

  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    setInterim('');
  }, []);

  const exit = useCallback(() => {
    engineRef.current?.stop();
    onExit();
  }, [onExit]);

  // ---- reancoragem assíncrona via Claude ----
  const askClaude = useCallback(
    async (manual: boolean) => {
      if (aiInflight.current || !claude?.available) return;
      aiInflight.current = true;
      lastAskAt.current = performance.now();
      setAi({ kind: 'asking' });
      const snapshot = lastMatchAny.current;
      const ws = wordsRef.current;
      const c = committed.current.cursor;
      const from = Math.max(0, c - 150);
      const to = Math.min(ws.length, c + 300);
      const lines = sentences(script)
        .filter((s) => s.to >= from && s.from < to)
        .map((s) => ws.slice(s.from, s.to + 1).map((w, k) => `${s.from + k}:${w.text}`).join(' '));
      const r = await api.reanchor(recentText.current.slice(-50).join(' '), lines);
      aiInflight.current = false;
      if (!r.ok) return setAi({ kind: 'failed', code: r.code });
      // Descarta se o matcher local se achou sozinho enquanto o Claude pensava.
      const stale = !manual && lastMatchAny.current !== snapshot;
      const conf = Math.round(r.confidence * 100);
      if (r.index === null || r.confidence < CLAUDE_MIN_CONFIDENCE || stale) return setAi({ kind: 'ignored', stale, conf });
      jump(r.index + 1);
      setAi({ kind: 'applied', index: r.index, conf });
    },
    [claude?.available, jump, script],
  );

  const silent = listening && now - lastSpeechAt.current > SILENCE_MS;
  const lost = listening && !paused && !silent && cursor < words.length && now - lastMatchAny.current > settings.lostAfterSec * 1000;
  const mode: Mode = !listening ? 'off' : paused ? 'paused' : silent ? 'silent' : lost ? 'lost' : 'live';

  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (lost && claude?.available && performance.now() - lastAskAt.current > CLAUDE_COOLDOWN_MS) void askClaude(false);
  }, [lost, now, claude?.available, askClaude]);

  // ---- destaque imperativo (evita re-render de milhares de spans) ----
  useLayoutEffect(() => {
    const els = wordEls.current;
    const prev = shownCursor.current;
    const lo = prev < 0 ? 0 : Math.min(prev, cursor);
    const hi = prev < 0 ? els.length : Math.max(prev, cursor) + 1;
    for (let i = lo; i < Math.min(hi, els.length); i++) {
      const el = els[i];
      if (!el) continue;
      el.classList.toggle('past', i < cursor);
      el.classList.toggle('current', i === cursor);
    }
    shownCursor.current = cursor;

    const current = els[Math.min(cursor, els.length - 1)];
    if (current && flashNext.current) {
      flashNext.current = false;
      current.classList.remove('jumped');
      void current.offsetWidth;
      current.classList.add('jumped');
    }
    const sc = scrollerRef.current;
    if (sc && current) {
      targetScroll.current = current.offsetTop + current.offsetHeight / 2 - sc.clientHeight * settings.focus;
      manualUntil.current = 0;
    }
  }, [cursor, script, settings.focus, settings.fontSize]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const sc = scrollerRef.current;
      if (sc && performance.now() > manualUntil.current) {
        const d = targetScroll.current - sc.scrollTop;
        if (Math.abs(d) > 0.5) sc.scrollTop += d * 0.12;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- atalhos ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (reviewOpen) {
        if (e.key === 'Escape') setReviewOpen(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, select, textarea')) return;
      const c = committed.current.cursor;
      const ws = wordsRef.current;
      const actions: Record<string, () => void> = {
        ' ': togglePause,
        Enter: toggleListen,
        ArrowUp: () => jump(e.shiftKey ? prevSection(script.sections, c) : prevSentence(ws, c)),
        ArrowDown: () => jump(e.shiftKey ? nextSection(script.sections, c, ws.length) : nextSentence(ws, c)),
        PageUp: () => jump(prevSection(script.sections, c)),
        PageDown: () => jump(nextSection(script.sections, c, ws.length)),
        Home: () => jump(0),
        m: () => onSettings({ mirrorH: !settings.mirrorH }),
        v: () => onSettings({ mirrorV: !settings.mirrorV }),
        '+': () => onSettings({ fontSize: clamp(settings.fontSize + 4, 24, 140) }),
        '=': () => onSettings({ fontSize: clamp(settings.fontSize + 4, 24, 140) }),
        '-': () => onSettings({ fontSize: clamp(settings.fontSize - 4, 24, 140) }),
        '[': () => onSettings({ focus: clamp(settings.focus - 0.05, 0.1, 0.8) }),
        ']': () => onSettings({ focus: clamp(settings.focus + 0.05, 0.1, 0.8) }),
        r: () => void askClaude(true),
        '?': () => setKeysOpen((o) => !o),
        Escape: () => (keysOpen ? setKeysOpen(false) : exit()),
      };
      const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key] ?? actions[e.key];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [askClaude, exit, jump, keysOpen, onSettings, reviewOpen, script.sections, settings, toggleListen, togglePause]);

  const onClickWord = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-w]');
    if (el) jump(Number(el.getAttribute('data-w')));
  };

  const secIdx = sectionAt(script.sections, cursor);
  const sec = script.sections[secIdx];
  const remainingSec = ((words.length - cursor) / settings.wpm) * 60;
  const elapsed = firstListenAt.current === null ? 0 : (now - firstListenAt.current) / 1000;

  const modeView: Record<Mode, { label: string; hint?: string; dot: string; live?: boolean }> = {
    off: { label: t.prompter.off, hint: t.prompter.offHint, dot: 'text-past' },
    paused: { label: t.prompter.paused, dot: 'text-smpte-yellow' },
    silent: { label: t.prompter.silent, dot: 'text-smpte-cyan' },
    lost: { label: t.prompter.lost, hint: t.prompter.lostHint, dot: 'text-smpte-magenta', live: true },
    live: { label: t.prompter.following, dot: 'text-tally', live: true },
  };
  const mv = modeView[mode];

  const aiLabel = !claude?.available
    ? t.ai.off(reason(t, claude?.reason ?? 'backend_offline'))
    : ai.kind === 'asking'
      ? t.ai.asking
      : ai.kind === 'applied'
        ? t.ai.applied(ai.index, ai.conf)
        : ai.kind === 'ignored'
          ? ai.stale
            ? t.ai.ignoredStale
            : t.ai.ignoredLow(ai.conf)
          : ai.kind === 'failed'
            ? t.ai.failedCall(reason(t, ai.code))
            : (preInfo ?? t.ai.idle);

  const chromeDim = mode === 'live' ? 'opacity-40 hover:opacity-100 focus-within:opacity-100' : 'opacity-100';

  return (
    <div className="fade-in fixed inset-0 flex flex-col bg-coal">
      {/* faixa superior: tally, timecode, take */}
      <header className={`z-20 flex items-center justify-between gap-4 px-4 py-3 font-mono text-xs transition-opacity duration-500 sm:px-6 ${chromeDim}`}>
        <div className="flex min-w-0 items-center gap-3" aria-live="polite">
          <span
            className={`flex items-center gap-2 rounded-sm px-2 py-1 font-semibold tracking-[0.14em] uppercase transition-colors duration-300 ${
              mode === 'live' ? 'bg-tally text-white' : 'border border-line text-chalk'
            }`}
          >
            <span className={`tally-dot inline-block size-2 rounded-full bg-current ${mode === 'live' ? 'is-live text-white' : mv.dot}`} />
            {mv.label}
          </span>
          {mv.hint && <span className="hidden truncate text-chalk-dim sm:inline">{mv.hint}</span>}
        </div>
        <div className="text-base tracking-widest text-chalk tabular-nums">{fmtTime(elapsed)}</div>
        <div className="flex min-w-0 items-center gap-3 text-chalk-dim">
          <span className="hidden truncate md:inline">{scriptName}</span>
          <span className="rounded-sm border border-line px-2 py-1 text-chalk">TAKE {String(take).padStart(2, '0')}</span>
        </div>
      </header>

      {/* área de leitura (espelhável) */}
      <div className="relative flex-1 overflow-hidden" style={{ transform: `scale(${settings.mirrorH ? -1 : 1}, ${settings.mirrorV ? -1 : 1})` }}>
        <div ref={scrollerRef} className="no-scrollbar h-full overflow-y-auto" onWheel={() => (manualUntil.current = performance.now() + 2500)}>
          <div
            className="script relative mx-auto max-w-5xl px-6 leading-[1.38] md:px-16"
            style={{ fontSize: settings.fontSize, paddingTop: '50vh', paddingBottom: '70vh' }}
            onClick={onClickWord}
          >
            <ScriptView script={script} wordEls={wordEls} />
          </div>
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-x-0" style={{ top: `${settings.focus * 100}%` }}>
          <div className={`focus-line border-t-2 ${mode === 'live' ? 'border-tally/60' : 'border-chalk/15'}`} />
          <span
            className={`absolute -top-[9px] left-0 h-0 w-0 border-y-[8px] border-l-[12px] border-y-transparent transition-colors duration-300 ${
              mode === 'live' ? 'border-l-tally' : 'border-l-chalk/40'
            }`}
          />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-coal to-transparent" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-coal to-transparent" />
      </div>

      {/* trilha de seções */}
      <nav aria-label={t.scriptFallback} className="z-20 flex h-6 items-end gap-0.5 px-4 sm:px-6">
        {script.sections.map((s, i) =>
          s.wordCount > 0 ? (
            <button
              key={i}
              title={`${s.title || script.title || t.scriptFallback} · ≈ ${fmtTime(s.estSeconds)}`}
              onClick={() => jump(s.firstWord)}
              className="group relative h-full min-w-2 cursor-pointer"
              style={{ flexGrow: s.wordCount }}
            >
              <span className={`absolute inset-x-0 bottom-0 h-1 transition-all duration-200 group-hover:h-2 ${i === secIdx ? 'bg-chalk-dim' : 'bg-line'}`} />
              <span
                className="absolute bottom-0 left-0 h-1 bg-chalk transition-[width] duration-300 ease-out group-hover:h-2"
                style={{ width: `${clamp((cursor - s.firstWord) / s.wordCount, 0, 1) * 100}%` }}
              />
            </button>
          ) : null,
        )}
      </nav>

      {/* barra de controle */}
      <footer className={`z-20 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-xs transition-opacity duration-500 sm:px-6 ${chromeDim}`}>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-display text-base font-bold tracking-wide uppercase">{sec?.title || script.title || t.scriptFallback}</span>
          <span className="font-mono text-chalk-dim tabular-nums">
            {t.prompter.word} {Math.min(cursor + 1, words.length)}/{words.length} · {t.prompter.left} ≈ {fmtTime(remainingSec)}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-chalk-dim" title={aiLabel}>
            {aiLabel}
          </span>
          <span className="truncate font-mono text-past italic" title={t.prompter.heard}>
            {interim || recentText.current.slice(-8).join(' ') || '…'}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          <CtrlButton primary={!listening} onClick={toggleListen} k="Enter">
            {listening ? t.prompter.stopMic : t.prompter.listen}
          </CtrlButton>
          <CtrlButton onClick={togglePause} k={lang === 'pt' ? 'Espaço' : 'Space'}>
            {paused ? t.prompter.resume : t.prompter.pause}
          </CtrlButton>
          <CtrlButton onClick={() => setReviewOpen(true)}>{t.prompter.review}</CtrlButton>
          <CtrlButton onClick={() => setKeysOpen((o) => !o)} k="?">
            {t.prompter.shortcuts}
          </CtrlButton>
          <CtrlButton onClick={exit} k="Esc">
            {t.prompter.exit}
          </CtrlButton>
        </div>
      </footer>

      {errorCode && (
        <div
          role="alert"
          className="slide-down absolute top-16 left-1/2 z-40 flex max-w-[90vw] items-center gap-3 rounded-sm bg-tally px-4 py-2.5 text-sm text-white"
        >
          {t.speechErrors[errorCode] ?? errorCode}
          <button className="font-mono text-xs underline" onClick={() => setErrorCode(null)}>
            OK
          </button>
        </div>
      )}

      {keysOpen && !reviewOpen && (
        <aside className="sheet-up absolute right-4 bottom-28 z-30 w-[min(92vw,420px)] border-2 border-chalk bg-coal-2 p-5 sm:right-6">
          <div className="mb-3 flex items-center justify-between"><p className="font-display text-lg font-bold tracking-wide uppercase">{t.prompter.shortcuts}</p><button className="font-mono text-xs text-chalk-dim hover:text-chalk" onClick={() => setKeysOpen(false)}>Esc ✕</button></div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {t.keys.map(([k, d]) => (
              <div key={k} className="contents">
                <dt>
                  <kbd className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-xs text-chalk">{k}</kbd>
                </dt>
                <dd className="text-chalk-dim">{d}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-past">{t.prompter.clickToJump}</p>
        </aside>
      )}

      {reviewOpen && (
        <ReviewPanel script={script} log={logRef.current} furthest={furthest.current} take={take} claude={claude} onClose={() => setReviewOpen(false)} />
      )}
    </div>
  );
}

function CtrlButton({ onClick, children, k, primary }: { onClick: () => void; children: ReactNode; k?: string; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-sm px-3 py-1.5 transition-colors ${
        primary ? 'bg-chalk font-bold text-coal hover:bg-white' : 'border border-line text-chalk hover:border-chalk-dim'
      }`}
    >
      {children}
      {k && <kbd className={`font-mono text-[10px] ${primary ? 'text-coal/60' : 'text-past'}`}>{k}</kbd>}
    </button>
  );
}
