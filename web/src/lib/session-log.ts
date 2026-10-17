import type { Script } from './markdown';

export type Segment = { t: number; text: string };

/** Registro da gravação para a revisão local (sem IA) e para o Claude. */
export class SessionLog {
  readonly startedAt = performance.now();
  segments: Segment[] = [];
  hitCount: Uint16Array;
  improvised: { t: number; words: string[] }[] = [];

  constructor(wordCount: number) {
    this.hitCount = new Uint16Array(wordCount);
  }

  elapsed() {
    return (performance.now() - this.startedAt) / 1000;
  }

  record(text: string, hits: number[], missed: string[]) {
    const t = this.elapsed();
    if (text) this.segments.push({ t, text });
    for (const h of hits) if (h >= 0 && h < this.hitCount.length) this.hitCount[h]++;
    if (missed.length) {
      const last = this.improvised[this.improvised.length - 1];
      if (last && t - last.t < 4) last.words.push(...missed);
      else this.improvised.push({ t, words: [...missed] });
    }
  }
}

export type LocalReview = {
  skipped: { from: number; to: number; text: string }[];
  repeated: { from: number; to: number; text: string }[];
  improvised: { at: string; text: string }[];
  coverage: number;
};

const MIN_RUN = 4;

export function fmtTime(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function localReview(script: Script, log: SessionLog, furthest: number): LocalReview {
  const runs = (pred: (i: number) => boolean, end: number) => {
    const out: { from: number; to: number; text: string }[] = [];
    let start = -1;
    for (let i = 0; i <= end; i++) {
      const on = i < end && pred(i);
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        if (i - start >= MIN_RUN) out.push({ from: start, to: i - 1, text: script.words.slice(start, i).map((w) => w.text).join(' ') });
        start = -1;
      }
    }
    return out;
  };
  const end = Math.min(furthest, script.words.length);
  // Só conta como "pulado" o que ficou para trás do ponto mais distante alcançado.
  const skipped = runs((i) => log.hitCount[i] === 0, end);
  const repeated = runs((i) => log.hitCount[i] > 1, end);
  const improvised = log.improvised.filter((x) => x.words.length >= MIN_RUN).map((x) => ({ at: fmtTime(x.t), text: x.words.join(' ') }));
  const hit = log.hitCount.reduce((n, c) => n + (c > 0 ? 1 : 0), 0);
  return { skipped, repeated, improvised, coverage: script.words.length ? hit / script.words.length : 0 };
}
