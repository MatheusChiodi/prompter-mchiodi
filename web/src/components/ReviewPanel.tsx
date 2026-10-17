import { useMemo, useState } from 'react';

import { api, type ClaudeStatus, type ReviewData } from '../lib/api';
import { reason, useI18n } from '../lib/i18n';
import { sentences, type Script } from '../lib/markdown';
import { localReview, type SessionLog } from '../lib/session-log';

type Props = {
  script: Script;
  log: SessionLog;
  furthest: number;
  take: number;
  claude: ClaudeStatus | null;
  onClose: () => void;
};

type Item = { meta: string; text: string };

export function ReviewPanel({ script, log, furthest, take, claude, onClose }: Props) {
  const { t } = useI18n();
  const local = useMemo(() => localReview(script, log, furthest), [script, log, furthest]);
  const [ai, setAi] = useState<ReviewData | null>(null);
  const [aiState, setAiState] = useState<{ kind: 'idle' | 'running' | 'failed'; code?: string }>({ kind: 'idle' });

  const runAi = async () => {
    setAiState({ kind: 'running' });
    const r = await api.review(log.segments, sentences(script));
    if (r.ok) {
      setAi(r.data);
      setAiState({ kind: 'idle' });
    } else setAiState({ kind: 'failed', code: r.code });
  };

  const pct = Math.round(local.coverage * 100);

  return (
    <div className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-coal/85 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        className="sheet-up max-h-[92vh] w-full max-w-3xl overflow-y-auto border-2 border-chalk bg-coal-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="stripes h-3" />
        <header className="flex items-start justify-between gap-4 border-b-2 border-chalk px-6 py-5">
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-chalk-dim uppercase">
              Take {String(take).padStart(2, '0')}
            </p>
            <h2 id="review-title" className="font-display text-4xl font-black tracking-tight uppercase">
              {t.review.title}
            </h2>
          </div>
          <button className="rounded-sm border border-line px-3 py-1.5 text-sm hover:border-chalk-dim" onClick={onClose}>
            {t.review.close} <kbd className="ml-1 font-mono text-xs text-chalk-dim">Esc</kbd>
          </button>
        </header>

        <div className="grid gap-6 px-6 py-6 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="font-display text-7xl leading-none font-black">{pct}%</div>
          <div>
            <p className="text-chalk">{t.review.coverage}</p>
            <div className="mt-2 h-1.5 w-full bg-line">
              <div className="h-full bg-chalk transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 font-mono text-xs text-chalk-dim">{t.review.segments(log.segments.length)}</p>
          </div>
        </div>

        <div className="border-t border-line px-6 py-6">
          <h3 className="mb-4 font-mono text-[10px] tracking-[0.2em] text-chalk-dim uppercase">{t.review.local}</h3>
          <div className="grid gap-6 sm:grid-cols-3">
            <List title={t.review.skipped} tone="cut" items={local.skipped.map((s) => ({ meta: `#${s.from}–${s.to}`, text: s.text }))} />
            <List title={t.review.repeated} tone="pause" items={local.repeated.map((s) => ({ meta: `#${s.from}–${s.to}`, text: s.text }))} />
            <List title={t.review.improvised} tone="broll" items={local.improvised.map((s) => ({ meta: s.at, text: s.text }))} />
          </div>
        </div>

        <div className="border-t border-line px-6 py-6">
          <h3 className="mb-4 font-mono text-[10px] tracking-[0.2em] text-chalk-dim uppercase">{t.review.ai}</h3>
          {claude?.available ? (
            <button
              className="rounded-sm bg-chalk px-4 py-2 text-sm font-bold text-coal transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
              disabled={aiState.kind === 'running' || log.segments.length === 0}
              onClick={runAi}
            >
              {aiState.kind === 'running' ? t.review.running : t.review.runAi}
            </button>
          ) : (
            <p className="text-sm text-chalk-dim">{t.review.aiOff(reason(t, claude?.reason ?? 'backend_offline'))}</p>
          )}
          {aiState.kind === 'failed' && <p className="mt-3 text-sm text-tally">{t.review.aiFailed(reason(t, aiState.code))}</p>}
          {ai && (
            <div className="fade-in mt-6">
              {ai.summary && <p className="mb-6 text-chalk">{ai.summary}</p>}
              <div className="grid gap-6 sm:grid-cols-3">
                <List title={t.review.skipped} tone="cut" items={ai.skipped.map((x) => ({ meta: `#${x.fromWord}–${x.toWord}`, text: x.text }))} />
                <List title={t.review.repeated} tone="pause" items={ai.repeated.map((x) => ({ meta: `${x.at} · ${t.review.times(x.times)}`, text: x.text }))} />
                <List title={t.review.improvised} tone="broll" items={ai.improvised.map((x) => ({ meta: x.at, text: x.text }))} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function List({ title, tone, items }: { title: string; tone: 'cut' | 'pause' | 'broll'; items: Item[] }) {
  const { t } = useI18n();
  return (
    <section>
      <h4 className="mb-2 flex items-center gap-2 text-sm font-bold">
        <span className={`cue cue-${tone} !m-0 !px-1.5 !align-middle !text-[10px]`}>{items.length}</span>
        {title}
      </h4>
      {items.length ? (
        <ul className="flex flex-col gap-3 text-sm">
          {items.map((it, i) => (
            <li key={i} className="border-l-2 border-line pl-3">
              <span className="block font-mono text-[11px] text-chalk-dim">{it.meta}</span>
              <span className="text-chalk">{it.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-past">{t.review.nothing}</p>
      )}
    </section>
  );
}
