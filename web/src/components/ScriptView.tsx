import { memo, type MutableRefObject } from 'react';

import { useI18n } from '../lib/i18n';
import type { Block, Piece, Script } from '../lib/markdown';
import { fmtTime } from '../lib/session-log';

type WordEls = MutableRefObject<(HTMLSpanElement | null)[]>;
type Props = { script: Script; wordEls: WordEls };

function renderPiece(p: Piece, key: number, script: Script, wordEls: WordEls, cueTitle: string) {
  const lead = p.lead ? ' ' : '';
  if (p.t === 'cue') {
    return (
      <span key={key}>
        {lead}
        <span className={`cue cue-${p.kind}`} title={cueTitle}>
          {p.text}
        </span>
      </span>
    );
  }
  if (p.t === 'text') {
    return (
      <span key={key}>
        {lead}
        {p.text}
      </span>
    );
  }
  const w = script.words[p.w];
  const cls = `w${w.bold ? ' b' : ''}${w.italic ? ' i' : ''}${w.code ? ' c' : ''}`;
  return (
    <span key={key}>
      {lead}
      <span
        data-w={p.w}
        className={cls}
        ref={(el) => {
          wordEls.current[p.w] = el;
        }}
      >
        {w.text}
      </span>
    </span>
  );
}

function BlockView({ block, script, wordEls, cueTitle }: { block: Block; script: Script; wordEls: WordEls; cueTitle: string }) {
  const content = block.pieces.map((p, i) => renderPiece(p, i, script, wordEls, cueTitle));
  switch (block.kind) {
    case 'heading': {
      const sec = script.sections[block.section];
      return (
        <div className="mt-[1.4em] mb-[0.5em] flex items-end justify-between gap-4 border-b-2 border-line pb-2">
          <span className="font-display text-[0.62em] leading-none font-bold tracking-wide text-chalk-dim uppercase">{content}</span>
          {sec?.estSeconds > 0 && <span className="shrink-0 font-mono text-[max(12px,0.28em)] text-past">≈ {fmtTime(sec.estSeconds)}</span>}
        </div>
      );
    }
    case 'list':
      return (
        <p className="mb-[0.5em] pl-[1.1em] -indent-[1.1em]">
          <span className="text-past">{block.marker} </span>
          {content}
        </p>
      );
    case 'quote':
      return <p className="mb-[0.6em] border-l-4 border-smpte-yellow/70 pl-4 text-[0.42em] text-chalk-dim italic">{content}</p>;
    case 'code':
      return <pre className="mb-[0.6em] overflow-hidden rounded-sm border border-line bg-coal-2 p-4 font-mono text-[max(12px,0.3em)] text-chalk-dim">{block.raw}</pre>;
    case 'rule':
      return <hr className="my-[0.9em] border-line" />;
    default:
      return <p className="mb-[0.7em]">{content}</p>;
  }
}

/** Renderiza uma vez por roteiro; destaque e "passado" são aplicados imperativamente pelo Prompter. */
export const ScriptView = memo(function ScriptView({ script, wordEls }: Props) {
  const { t } = useI18n();
  wordEls.current = new Array(script.words.length).fill(null);
  return (
    <>
      {script.blocks.map((b, i) => (
        <BlockView key={i} block={b} script={script} wordEls={wordEls} cueTitle={t.prompter.cueTitle} />
      ))}
    </>
  );
});
