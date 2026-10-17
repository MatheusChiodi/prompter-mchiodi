import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { Source } from '../App';
import { api, type ClaudeStatus, type FileInfo } from '../lib/api';
import { reason, useI18n, type UiLang } from '../lib/i18n';
import { SAMPLE_SCRIPT } from '../lib/sample';
import type { Settings } from '../lib/settings';
import { speechSupported } from '../lib/speech';

type Props = {
  backend: boolean | null;
  claude: ClaudeStatus | null;
  watchDir: string | null;
  files: FileInfo[];
  settings: Settings;
  onSettings: (p: Partial<Settings>) => void;
  onOpen: (s: Source) => void;
  onProbe: () => void;
  current: Source | null;
  take: number;
  clapping: boolean;
  preInfo: string | null;
  onResume?: () => void;
};

const ACCEPT = /\.(md|markdown|txt)$/i;

export function Home(p: Props) {
  const { t, lang } = useI18n();
  const [dragging, setDragging] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (!ACCEPT.test(f.name)) return setErr(t.drop.invalid);
    setErr(null);
    p.onOpen({ name: f.name, md: await f.text(), origin: 'drop' });
  };

  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      void readFile(e.dataTransfer?.files[0]);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  });

  const openWatched = async (name: string) => {
    const r = await api.file(name);
    if (r.ok) p.onOpen({ name, md: r.content, origin: 'watch' });
    else setErr(t.drop.openFailed(name));
  };

  const today = new Date().toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  const voice = speechSupported();

  return (
    <div className="min-h-full">
      {p.clapping && <div className="clap-flash pointer-events-none fixed inset-0 z-50 bg-chalk" />}

      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 pt-6 pb-16 sm:px-8 sm:pt-10">
        <nav className="flex items-center justify-between">
          <span className="font-mono text-xs tracking-[0.2em] text-chalk-dim uppercase">MChiodi · {t.appName}</span>
          <LangSwitch value={p.settings.uiLang} onChange={(uiLang) => p.onSettings({ uiLang })} />
        </nav>

        {/* claquete */}
        <section className="rise relative pt-6" aria-label={t.appName}>
          <div className={`clapper-stick stripes relative z-10 h-12 rounded-t-sm border-2 border-chalk sm:h-14 ${p.clapping ? 'is-clapping' : ''}`} />
          <div className="stripes h-4 border-x-2 border-t-2 border-chalk" />
          <div className="rounded-b-sm border-2 border-t-0 border-chalk bg-coal-2">
            <div className="grid gap-0 md:grid-cols-[1fr_auto]">
              <div className="border-b-2 border-chalk p-5 sm:p-7 md:border-r-2 md:border-b-0">
                <h1 className="font-display text-[clamp(3.2rem,11vw,7.5rem)] leading-[0.82] font-black tracking-tight uppercase">
                  Prompter
                  <br />
                  <span className="text-chalk-dim">MChiodi</span>
                </h1>
              </div>
              <ul className="flex flex-col justify-center gap-3 p-5 text-sm sm:p-7">
                <StatusLight
                  state={p.backend === null ? 'wait' : p.backend ? 'on' : 'off'}
                  label={p.backend === null ? t.status.backendWait : p.backend ? t.status.backend : t.status.backendOff}
                />
                <StatusLight
                  state={p.claude?.available ? 'on' : 'off'}
                  label={p.claude?.available ? `${t.status.claudeOn} ${p.claude.version?.split(' ')[0] ?? ''}` : t.status.claudeOff}
                  detail={p.claude?.available ? undefined : reason(t, p.claude?.reason ?? (p.backend ? 'unknown' : 'backend_offline'))}
                  action={p.backend && !p.claude?.available ? { label: t.status.recheck, onClick: p.onProbe } : undefined}
                />
                <StatusLight state={voice ? 'on' : 'off'} label={voice ? t.status.voiceOn : t.status.voiceOff} />
              </ul>
            </div>
            <dl className="grid grid-cols-2 border-t-2 border-chalk sm:grid-cols-[1.2fr_2fr_0.7fr_1fr]">
              <SlateField i={0} label={t.slate.production} value="MChiodi" />
              <SlateField i={1} label={t.slate.script} value={p.current?.name.replace(ACCEPT, '') ?? t.slate.none} dim={!p.current} />
              <SlateField i={2} label={t.slate.take} value={String(p.take || 1).padStart(2, '0')} />
              <SlateField i={3} label={t.slate.date} value={today} />
            </dl>
          </div>
        </section>

        {/* entrada do roteiro */}
        <section className="rise flex flex-col gap-4" style={{ animationDelay: '120ms' }}>
          <button
            type="button"
            className={`dropzone group relative flex min-h-48 w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-sm border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragging ? 'is-dragging border-chalk' : 'border-line hover:border-chalk-dim'
            }`}
            onClick={() => inputRef.current?.click()}
          >
            <span className="drop-stripes stripes pointer-events-none absolute inset-x-0 top-0 h-2 opacity-0 transition-opacity" />
            <span className="font-display text-4xl font-bold tracking-tight uppercase sm:text-5xl">
              {dragging ? t.drop.titleDragging : t.drop.title}
            </span>
            <span className="text-sm text-chalk-dim">{t.drop.hint}</span>
          </button>
          <input ref={inputRef} type="file" accept=".md,.markdown,.txt" className="hidden" onChange={(e) => void readFile(e.target.files?.[0])} />
          {err && (
            <p role="alert" className="fade-in text-sm text-tally">
              {err}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {p.onResume && p.current && (
              <button className="rounded-sm bg-chalk px-4 py-2 text-sm font-bold text-coal transition-transform hover:-translate-y-0.5" onClick={p.onResume}>
                {t.resume(p.current.name)}
              </button>
            )}
            <button
              className="rounded-sm border border-line px-4 py-2 text-sm transition-colors hover:border-chalk-dim"
              onClick={() => p.onOpen({ name: 'exemplo.md', md: SAMPLE_SCRIPT, origin: 'sample' })}
            >
              {t.sample}
            </button>
            {p.preInfo && <span className="text-xs text-chalk-dim">{p.preInfo}</span>}
          </div>

          <CueLegend />
        </section>

        <div className="rise grid gap-10 md:grid-cols-[1.4fr_1fr]" style={{ animationDelay: '220ms' }}>
          <section>
            <SectionTitle>{t.watch.title}</SectionTitle>
            {p.backend ? (
              <>
                <p className="mb-3 font-mono text-[11px] break-all text-chalk-dim">{p.watchDir}</p>
                {p.files.length ? (
                  <ul className="border-t border-line">
                    {p.files.map((f) => (
                      <li key={f.name} className="border-b border-line">
                        <button
                          className="group flex w-full items-baseline justify-between gap-4 py-3 text-left transition-colors hover:text-chalk"
                          onClick={() => void openWatched(f.name)}
                        >
                          <span className="truncate transition-transform group-hover:translate-x-1">{f.name}</span>
                          <span className="shrink-0 font-mono text-[11px] text-chalk-dim">
                            {new Date(f.mtime).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-chalk-dim">{t.watch.empty}</p>
                )}
                <p className="mt-3 text-xs text-chalk-dim">{t.watch.autoReload}</p>
              </>
            ) : (
              <p className="text-sm text-chalk-dim">{t.watch.offline}</p>
            )}
          </section>

          <section>
            <SectionTitle>{t.settings.title}</SectionTitle>
            <div className="flex flex-col divide-y divide-line border-y border-line text-sm">
              <Row label={t.settings.sttLang}>
                <select className="rounded-sm border border-line bg-coal px-2 py-1" value={p.settings.lang} onChange={(e) => p.onSettings({ lang: e.target.value })}>
                  <option value="pt-BR">Português (Brasil)</option>
                  <option value="pt-PT">Português (Portugal)</option>
                  <option value="en-US">English (US)</option>
                </select>
              </Row>
              <Row label={t.settings.speakHeadings}>
                <input
                  type="checkbox"
                  className="size-4 accent-chalk"
                  checked={p.settings.speakHeadings}
                  onChange={(e) => p.onSettings({ speakHeadings: e.target.checked })}
                />
              </Row>
              <Row label={t.settings.lostAfter}>
                <NumberInput value={p.settings.lostAfterSec} min={3} max={30} unit={t.settings.seconds} onChange={(v) => p.onSettings({ lostAfterSec: v })} />
              </Row>
              <Row label={t.settings.wpm}>
                <NumberInput value={p.settings.wpm} min={80} max={250} unit={t.settings.wpmUnit} onChange={(v) => p.onSettings({ wpm: v })} />
              </Row>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function LangSwitch({ value, onChange }: { value: UiLang; onChange: (v: UiLang) => void }) {
  const opts: [UiLang, string, string][] = [
    ['pt', 'PT', 'Português'],
    ['en', 'EN', 'English'],
  ];
  return (
    <div role="radiogroup" aria-label="Idioma / Language" className="relative flex rounded-sm border border-line p-0.5 font-mono text-xs">
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-[1px] bg-chalk transition-transform duration-300 ease-out"
        style={{ transform: value === 'en' ? 'translateX(100%)' : 'none' }}
      />
      {opts.map(([v, short, long]) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          title={long}
          onClick={() => onChange(v)}
          className={`relative z-10 w-10 py-1 transition-colors duration-300 ${value === v ? 'text-coal' : 'text-chalk-dim hover:text-chalk'}`}
        >
          {short}
        </button>
      ))}
    </div>
  );
}

function StatusLight({
  state,
  label,
  detail,
  action,
}: {
  state: 'on' | 'off' | 'wait';
  label: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
}) {
  const color = state === 'on' ? 'text-smpte-green' : state === 'wait' ? 'text-smpte-yellow' : 'text-past';
  return (
    <li className="flex items-start gap-3">
      <span className={`tally-dot mt-1.5 inline-block size-2 shrink-0 rounded-full bg-current ${color} ${state === 'on' ? 'is-live' : ''}`} />
      <span className="flex flex-col">
        <span className={state === 'on' ? 'text-chalk' : 'text-chalk-dim'}>{label}</span>
        {detail && <span className="text-xs text-chalk-dim">{detail}</span>}
        {action && (
          <button className="self-start text-xs text-chalk underline underline-offset-2 hover:text-smpte-yellow" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </span>
    </li>
  );
}

function SlateField({ i, label, value, dim }: { i: number; label: string; value: string; dim?: boolean }) {
  const borders = [i % 2 === 0 ? 'border-r-2' : '', i < 2 ? 'border-b-2 sm:border-b-0' : '', i < 3 ? 'sm:border-r-2' : 'sm:border-r-0'].join(' ');
  return (
    <div className={`min-w-0 border-chalk px-5 py-3 sm:px-7 ${borders}`}>
      <dt className="font-mono text-[10px] tracking-[0.2em] text-chalk-dim uppercase">{label}</dt>
      <dd className={`truncate font-display text-2xl font-bold tracking-tight uppercase sm:text-3xl ${dim ? 'text-past' : ''}`}>{value}</dd>
    </div>
  );
}

function CueLegend() {
  const { t } = useI18n();
  const items: [string, string][] = [
    ['cue-cut', `[${t.cueLegend.cut}]`],
    ['cue-broll', `[${t.cueLegend.broll}: …]`],
    ['cue-pause', `[${t.cueLegend.pause}]`],
    ['cue-note', `<!-- ${t.cueLegend.note} -->`],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-chalk-dim">
      <span>{t.cueLegend.title}:</span>
      {items.map(([cls, label]) => (
        <span key={cls} className={`cue ${cls} !text-[11px] !align-middle`}>
          {label}
        </span>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 font-display text-xl font-bold tracking-wide uppercase">{children}</h2>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4 py-3">
      <span className="text-chalk-dim">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({ value, min, max, unit, onChange }: { value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  return (
    <span className="flex items-center gap-2 font-mono">
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        className="w-16 rounded-sm border border-line bg-coal px-2 py-1 text-right"
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v > 0) onChange(v);
        }}
      />
      <span className="w-7 text-xs text-chalk-dim">{unit}</span>
    </span>
  );
}
