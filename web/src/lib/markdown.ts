import { norm, phoneticKey, splitCompound } from './normalize';
import { TECH_ALIASES } from './tech-aliases';

export type CueKind = 'cut' | 'broll' | 'pause' | 'note';

export type Word = {
  text: string;
  norm: string;
  key: string;
  /** Sequências alternativas aceitas (cada uma = palavras normalizadas). */
  alts: string[][];
  bold: boolean;
  italic: boolean;
  code: boolean;
  block: number;
  section: number;
  sentenceStart: boolean;
};

export type Piece =
  | { t: 'word'; w: number; lead: string }
  | { t: 'text'; text: string; lead: string }
  | { t: 'cue'; text: string; kind: CueKind; lead: string };

export type BlockKind = 'heading' | 'paragraph' | 'list' | 'quote' | 'code' | 'rule';

export type Block = {
  kind: BlockKind;
  section: number;
  pieces: Piece[];
  level?: number;
  marker?: string;
  raw?: string;
};

export type Section = {
  title: string;
  block: number;
  firstWord: number;
  wordCount: number;
  estSeconds: number;
};

export type Script = {
  title: string;
  blocks: Block[];
  words: Word[];
  sections: Section[];
  aliasCount: number;
};

export type ParseOptions = {
  speakHeadings?: boolean;
  /** Trechos literais que devem virar cue (vindos do pré-processamento). */
  extraCues?: string[];
  /** Termo do roteiro → variantes do STT (vindos do pré-processamento). */
  aliases?: Record<string, string[]>;
  /** Estimativas por seção (mesma ordem), sobrescrevem o cálculo local. */
  sectionSeconds?: number[];
  wpm?: number;
};

const CUE_OPEN = '\u0001';
const CUE_CLOSE = '\u0002';
const PAUSE_SECONDS = 2;

type Atom = { cue: string } | { text: string; bold: boolean; italic: boolean; code: boolean };

export function cueKind(text: string): CueKind {
  const head = norm(text.split(/[\s:,-]/)[0] ?? '');
  if (/^(corte|cut|corta)/.test(head)) return 'cut';
  if (/^(broll|b)$/.test(head) || /^b-?roll/i.test(text.trim())) return 'broll';
  if (/^(pausa|pause|respira)/.test(head)) return 'pause';
  return 'note';
}

function wrapExtraCues(md: string, cues: string[]): string {
  let out = md;
  for (const c of cues) {
    const needle = c.trim();
    if (needle.length < 2) continue;
    const at = out.indexOf(needle);
    if (at < 0 || out[at - 1] === '[' || out[at - 1] === CUE_OPEN) continue;
    out = `${out.slice(0, at)}${CUE_OPEN}${needle}${CUE_CLOSE}${out.slice(at + needle.length)}`;
  }
  return out;
}

function scanInline(src: string): Atom[] {
  const atoms: Atom[] = [];
  let buf = '';
  let bold = false;
  let italic = false;
  const flush = () => {
    if (buf) atoms.push({ text: buf, bold, italic, code: false });
    buf = '';
  };
  const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      buf += src[++i];
      continue;
    }
    if (ch === CUE_OPEN) {
      const end = src.indexOf(CUE_CLOSE, i + 1);
      if (end > i) {
        flush();
        atoms.push({ cue: src.slice(i + 1, end).trim() });
        i = end;
        continue;
      }
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        flush();
        atoms.push({ text: src.slice(i + 1, end), bold, italic, code: true });
        i = end;
        continue;
      }
    }
    if (ch === '!' && src[i + 1] === '[') {
      const close = src.indexOf(']', i + 2);
      if (close > 0 && src[close + 1] === '(') {
        const paren = src.indexOf(')', close + 2);
        if (paren > 0) {
          flush();
          atoms.push({ cue: `IMG ${src.slice(i + 2, close)}`.trim() });
          i = paren;
          continue;
        }
      }
    }
    if (ch === '[') {
      const close = src.indexOf(']', i + 1);
      if (close > i) {
        const inner = src.slice(i + 1, close);
        if (src[close + 1] === '(') {
          const paren = src.indexOf(')', close + 2);
          if (paren > 0) {
            buf += inner;
            i = paren;
            continue;
          }
        }
        flush();
        atoms.push({ cue: inner.trim() });
        i = close;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] === ch) {
      flush();
      bold = !bold;
      i++;
      continue;
    }
    if (ch === '*' || (ch === '_' && !(isWordChar(src[i - 1]) && isWordChar(src[i + 1])))) {
      flush();
      italic = !italic;
      continue;
    }
    buf += ch;
  }
  flush();
  return atoms;
}

type Builder = {
  words: Word[];
  aliasMap: Map<string, string[][]>;
};

function buildAliasMap(extra: Record<string, string[]> | undefined): Map<string, string[][]> {
  const map = new Map<string, string[][]>();
  const add = (term: string, variants: string[]) => {
    const k = norm(term);
    if (!k || /\s/.test(term.trim())) return;
    const list = map.get(k) ?? [];
    for (const v of variants) {
      const seq = v.split(/\s+/).map(norm).filter(Boolean);
      if (!seq.length || (seq.length === 1 && seq[0] === k)) continue;
      if (!list.some((s) => s.join(' ') === seq.join(' '))) list.push(seq);
    }
    if (list.length) map.set(k, list);
  };
  for (const [t, v] of Object.entries(TECH_ALIASES)) add(t, v);
  for (const [t, v] of Object.entries(extra ?? {})) add(t, v);
  return map;
}

function pushWord(b: Builder, text: string, style: { bold: boolean; italic: boolean; code: boolean }, block: number, section: number): Word {
  const n = norm(text);
  const alts = [...(b.aliasMap.get(n) ?? [])];
  const parts = splitCompound(text);
  if (parts.length) alts.push(parts);
  const word: Word = {
    text,
    norm: n,
    key: phoneticKey(n),
    alts,
    bold: style.bold,
    italic: style.italic,
    code: style.code,
    block,
    section,
    sentenceStart: false,
  };
  b.words.push(word);
  return word;
}

function inlinePieces(b: Builder, src: string, block: number, section: number, spoken: boolean): Piece[] {
  const pieces: Piece[] = [];
  let lead = '';
  for (const atom of scanInline(src)) {
    if ('cue' in atom) {
      pieces.push({ t: 'cue', text: atom.cue, kind: cueKind(atom.cue), lead });
      lead = ' ';
      continue;
    }
    for (const chunk of atom.text.split(/(\s+)/)) {
      if (!chunk) continue;
      if (/^\s+$/.test(chunk)) {
        lead = ' ';
        continue;
      }
      const last = pieces[pieces.length - 1];
      // Mudança de estilo no meio da palavra (**Kube**rnetes): junta com a anterior.
      if (!lead && last && last.t === 'word') {
        const w = b.words[last.w];
        w.text += chunk;
        w.norm = norm(w.text);
        w.key = phoneticKey(w.norm);
        continue;
      }
      if (!spoken || !norm(chunk)) {
        pieces.push({ t: 'text', text: chunk, lead });
      } else {
        pushWord(b, chunk, atom, block, section);
        pieces.push({ t: 'word', w: b.words.length - 1, lead });
      }
      lead = '';
    }
  }
  return pieces;
}

export function parseScript(markdown: string, opts: ParseOptions = {}): Script {
  const wpm = opts.wpm ?? 150;
  let md = markdown.replace(/\r\n?/g, '\n');
  md = md.replace(/<!--([\s\S]*?)-->/g, (_m, inner: string) => `${CUE_OPEN}${inner.trim().replace(/\s+/g, ' ')}${CUE_CLOSE}`);
  if (opts.extraCues?.length) md = wrapExtraCues(md, opts.extraCues);

  const b: Builder = { words: [], aliasMap: buildAliasMap(opts.aliases) };
  const blocks: Block[] = [];
  const sections: Section[] = [{ title: '', block: 0, firstWord: 0, wordCount: 0, estSeconds: 0 }];
  let title = '';
  let para: string[] = [];
  let paraKind: 'paragraph' | 'list' | 'quote' = 'paragraph';
  let marker = '';

  const section = () => sections.length - 1;
  const flush = () => {
    if (!para.length) return;
    const text = para.join(' ');
    const idx = blocks.length;
    const spoken = paraKind !== 'quote';
    blocks.push({ kind: paraKind, section: section(), marker: marker || undefined, pieces: inlinePieces(b, text, idx, section(), spoken) });
    para = [];
    paraKind = 'paragraph';
    marker = '';
  };

  const lines = md.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      flush();
      const body: string[] = [];
      while (++li < lines.length && !lines[li].trimStart().startsWith(fence[1])) body.push(lines[li]);
      blocks.push({ kind: 'code', section: section(), pieces: [], raw: body.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flush();
      const text = heading[2];
      if (!title && heading[1].length === 1) title = text;
      const current = sections[section()];
      const emptySection = current.wordCount === 0 && b.words.length === current.firstWord && !blocks.some((x) => x.section === section() && x.kind !== 'heading');
      if (emptySection && !current.title) {
        current.title = text;
        current.block = blocks.length;
      } else {
        sections.push({ title: text, block: blocks.length, firstWord: b.words.length, wordCount: 0, estSeconds: 0 });
      }
      const idx = blocks.length;
      blocks.push({ kind: 'heading', level: heading[1].length, section: section(), pieces: inlinePieces(b, text, idx, section(), !!opts.speakHeadings) });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: 'rule', section: section(), pieces: [] });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      if (paraKind !== 'quote') flush();
      paraKind = 'quote';
      para.push(quote[1]);
      continue;
    }
    const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      flush();
      paraKind = 'list';
      marker = /\d/.test(item[1]) ? item[1] : '•';
      para.push(item[2]);
      continue;
    }
    if (paraKind === 'quote') flush();
    para.push(line.trim());
  }
  flush();

  // Início de frase: primeira palavra do bloco ou após pontuação final.
  let prevBlock = -1;
  b.words.forEach((w, i) => {
    const prev = b.words[i - 1];
    w.sentenceStart = w.block !== prevBlock || !prev || /[.!?…:;]["'”’)\]]*$/.test(prev.text);
    prevBlock = w.block;
  });

  for (let s = 0; s < sections.length; s++) {
    const next = sections[s + 1];
    const sec = sections[s];
    sec.wordCount = (next ? next.firstWord : b.words.length) - sec.firstWord;
    const pauses = blocks
      .filter((x) => x.section === s)
      .reduce((n, x) => n + x.pieces.filter((p) => p.t === 'cue' && p.kind === 'pause').length, 0);
    sec.estSeconds = opts.sectionSeconds?.[s] ?? Math.round((sec.wordCount / wpm) * 60 + pauses * PAUSE_SECONDS);
  }

  const aliasCount = b.words.filter((w) => w.alts.length > 0).length;
  return { title: title || sections[0].title, blocks, words: b.words, sections, aliasCount };
}

/** Frases (para reancoragem/revisão): faixas [from, to] de índices de palavra. */
export function sentences(script: Script): { from: number; to: number; text: string }[] {
  const out: { from: number; to: number; text: string }[] = [];
  script.words.forEach((w, i) => {
    if (w.sentenceStart || i === 0) out.push({ from: i, to: i, text: w.text });
    else {
      const last = out[out.length - 1];
      last.to = i;
      last.text += ` ${w.text}`;
    }
  });
  return out;
}
