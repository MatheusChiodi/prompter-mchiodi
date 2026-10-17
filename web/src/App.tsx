import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Home } from './components/Home';
import { Prompter } from './components/Prompter';
import { api, type ClaudeStatus, type FileInfo, type PreprocessData } from './lib/api';
import { DICTS, I18nProvider, reason, type Dict } from './lib/i18n';
import { parseScript } from './lib/markdown';
import { loadSettings, saveSettings, type Settings } from './lib/settings';

export type Source = { name: string; md: string; origin: 'drop' | 'watch' | 'sample' };
export type PreState = { kind: 'off' | 'running' | 'done' | 'failed'; code?: string; cached?: boolean };

const TAKES_KEY = 'prompter-mchiodi:takes';
const CLAP_MS = 520;

function readTakes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(TAKES_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function preLabel(t: Dict, pre: PreState, aliasTerms: number): string | null {
  switch (pre.kind) {
    case 'running':
      return t.ai.preprocessing;
    case 'done':
      return t.ai.ready(aliasTerms, !!pre.cached);
    case 'failed':
      return t.ai.failed(reason(t, pre.code));
    default:
      return null;
  }
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [source, setSource] = useState<Source | null>(null);
  const [view, setView] = useState<'home' | 'prompter'>('home');
  const [clapping, setClapping] = useState(false);
  const [backend, setBackend] = useState<boolean | null>(null);
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [watchDir, setWatchDir] = useState<string | null>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [pre, setPre] = useState<PreprocessData | null>(null);
  const [preState, setPreState] = useState<PreState>({ kind: 'off' });
  const [takes, setTakes] = useState(readTakes);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const t = DICTS[settings.uiLang];

  useEffect(() => {
    document.documentElement.lang = settings.uiLang === 'pt' ? 'pt-BR' : 'en';
  }, [settings.uiLang]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const refreshHealth = useCallback(async () => {
    const r = await api.health();
    setBackend(r.ok);
    if (r.ok) {
      setClaude(r.claude);
      setWatchDir(r.watchDir);
    } else setClaude(null);
  }, []);

  useEffect(() => {
    void refreshHealth();
    const id = setInterval(refreshHealth, 30_000);
    return () => clearInterval(id);
  }, [refreshHealth]);

  useEffect(() => {
    if (!backend) return;
    return api.events(async (msg) => {
      if (msg.type === 'files') setFiles(msg.files);
      if (msg.type === 'changed' && sourceRef.current?.origin === 'watch' && sourceRef.current.name === msg.name) {
        const r = await api.file(msg.name);
        if (r.ok) setSource({ name: r.name, md: r.content, origin: 'watch' });
      }
    });
  }, [backend]);

  // Pré-processamento (Claude Code CLI). Sem CLI, o app segue com o parser local.
  useEffect(() => {
    setPre(null);
    if (!source) return setPreState({ kind: 'off' });
    if (!claude?.available) return setPreState({ kind: 'off', code: claude?.reason ?? 'backend_offline' });
    let cancelled = false;
    setPreState({ kind: 'running' });
    void api.preprocess(source.md).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setPre(r.data);
        setPreState({ kind: 'done', cached: r.cached });
      } else {
        setPreState({ kind: 'failed', code: r.code });
        if (r.claude) setClaude(r.claude);
      }
    });
    return () => {
      cancelled = true;
    };
    // Só md e disponibilidade: não reprocessar a cada health check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.md, claude?.available]);

  const script = useMemo(() => {
    if (!source) return null;
    const s = parseScript(source.md, {
      speakHeadings: settings.speakHeadings,
      aliases: pre?.aliases,
      extraCues: pre?.cues,
      wpm: settings.wpm,
    });
    if (pre && pre.sections.length === s.sections.length) {
      s.sections.forEach((sec, i) => (sec.estSeconds = Math.round(pre.sections[i].estimatedSeconds) || sec.estSeconds));
    }
    return s;
  }, [source, pre, settings.speakHeadings, settings.wpm]);

  const take = source ? (takes[source.name] ?? 0) : 0;

  const enterPrompter = (name: string) => {
    setTakes((prev) => {
      const next = { ...prev, [name]: (prev[name] ?? 0) + 1 };
      try {
        localStorage.setItem(TAKES_KEY, JSON.stringify(next));
      } catch {
        /* modo privado */
      }
      return next;
    });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return setView('prompter');
    setClapping(true);
    window.setTimeout(() => {
      setClapping(false);
      setView('prompter');
    }, CLAP_MS);
  };

  const open = (s: Source) => {
    setSource(s);
    enterPrompter(s.name);
  };

  const aliasTerms = Object.keys(pre?.aliases ?? {}).length;

  return (
    <I18nProvider lang={settings.uiLang}>
      {view === 'prompter' && script && source ? (
        <Prompter
          script={script}
          scriptName={source.name}
          take={take}
          settings={settings}
          onSettings={updateSettings}
          claude={claude}
          preInfo={preLabel(t, preState, aliasTerms)}
          onExit={() => setView('home')}
        />
      ) : (
        <Home
          backend={backend}
          claude={claude}
          watchDir={watchDir}
          files={files}
          settings={settings}
          onSettings={updateSettings}
          onOpen={open}
          onProbe={async () => {
            const r = await api.probe();
            if (r.ok) setClaude(r.claude);
          }}
          current={source}
          take={take}
          clapping={clapping}
          preInfo={preLabel(t, preState, aliasTerms)}
          onResume={script && source ? () => enterPrompter(source.name) : undefined}
        />
      )}
    </I18nProvider>
  );
}
