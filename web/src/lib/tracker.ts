import type { Section, Word } from './markdown';
import { STOPWORDS, fuzzyEqual, phoneticKey, sameWord } from './normalize';

export type TrackerState = {
  /** Índice da próxima palavra esperada (a destacada). */
  cursor: number;
  /** Palavras faladas seguidas sem casar com o roteiro. */
  miss: number;
  /** Últimas palavras faladas (normalizadas), para bigrama e reancoragem. */
  recent: string[];
  lastMatchAt: number;
};

export type TrackerOptions = {
  lookahead: number;
  nearJump: number;
  bigramWindow: number;
  reanchorMisses: number;
  reanchorWindow: number;
  reanchorMin: number;
  reanchorMinFar: number;
  farDistance: number;
};

export const DEFAULT_OPTIONS: TrackerOptions = {
  lookahead: 20,
  nearJump: 2,
  bigramWindow: 3,
  reanchorMisses: 4,
  reanchorWindow: 7,
  reanchorMin: 3,
  reanchorMinFar: 4,
  farDistance: 150,
};

export type AdvanceResult = {
  state: TrackerState;
  /** Índices de palavras do roteiro casadas neste lote. */
  hits: number[];
  /** Palavras faladas que não casaram (improviso/erro de STT). */
  missed: string[];
  reanchored: boolean;
};

const RECENT_MAX = 16;

export function initialState(cursor = 0, now = 0): TrackerState {
  return { cursor, miss: 0, recent: [], lastMatchAt: now };
}

export function setCursor(s: TrackerState, cursor: number, now: number): TrackerState {
  return { ...s, cursor: Math.max(0, cursor), miss: 0, lastMatchAt: now };
}

function single(w: Word, spoken: string): boolean {
  if (sameWord(w.norm, w.key, spoken)) return true;
  for (const alt of w.alts) if (alt.length === 1 && sameWord(alt[0], phoneticKey(alt[0]), spoken)) return true;
  return false;
}

/** Quantas palavras faladas a partir de i correspondem à palavra do roteiro (0 = não casa). */
export function matchLen(w: Word, spoken: string[], i: number): number {
  const s = spoken[i];
  if (single(w, s)) return 1;

  // STT separou um termo composto: "use effect" → useEffect, "node js" → Node.js.
  let cat = s;
  for (let k = 1; k < 3 && i + k < spoken.length; k++) {
    cat += spoken[i + k];
    if (cat.length > w.norm.length + 2) break;
    if (cat === w.norm || (w.norm.length >= 6 && fuzzyEqual(w.norm, cat))) return k + 1;
  }

  for (const alt of w.alts) {
    if (alt.length < 2 || i + alt.length > spoken.length) continue;
    let ok = true;
    for (let k = 0; k < alt.length && ok; k++) ok = sameWord(alt[k], phoneticKey(alt[k]), spoken[i + k]);
    if (ok) return alt.length;
  }
  return 0;
}

function confirmsBehind(words: Word[], j: number, floor: number, prev: string, window: number): boolean {
  for (let k = j - 1; k >= Math.max(floor, j - window); k--) if (single(words[k], prev)) return true;
  return false;
}

function confirmsAhead(words: Word[], j: number, next: string): boolean {
  for (let k = j + 1; k <= Math.min(words.length - 1, j + 2); k++) if (single(words[k], next)) return true;
  return false;
}

function forwardMatch(words: Word[], cursor: number, spoken: string[], i: number, prev: string | undefined, o: TrackerOptions) {
  const n = words.length;
  const nearEnd = Math.min(cursor + o.nearJump + 1, n);
  for (let j = cursor; j < nearEnd; j++) {
    const len = matchLen(words[j], spoken, i);
    if (len) return { to: j + 1, len };
  }
  // Salto longo exige confirmação (palavra anterior ou seguinte), senão "de"/"que" arrastam o cursor.
  const farEnd = Math.min(cursor + o.lookahead, n);
  for (let j = nearEnd; j < farEnd; j++) {
    const len = matchLen(words[j], spoken, i);
    if (!len) continue;
    const next = spoken[i + len];
    if ((prev && confirmsBehind(words, j, cursor, prev, o.bigramWindow)) || (next && confirmsAhead(words, j, next))) {
      return { to: j + 1, len };
    }
  }
  return null;
}

/**
 * Procura no roteiro inteiro o melhor alinhamento das últimas palavras faladas.
 * Cobre frase relida (volta) e trecho pulado (avança). Stopwords valem meio ponto e
 * saltos distantes exigem mais acertos, para improviso não teleportar o cursor.
 */
export function globalAnchor(words: Word[], recent: string[], cursor: number, o: TrackerOptions = DEFAULT_OPTIONS): number | null {
  if (recent.length < 3) return null;
  const last = recent[recent.length - 1];
  const weight = (s: string) => (STOPWORDS.has(s) ? 0.5 : 1);
  let best = -1;
  let bestScore = 0;
  let bestDist = Infinity;

  for (let p = 0; p < words.length; p++) {
    if (!single(words[p], last)) continue;
    let score = weight(last);
    let q = p - 1;
    for (let k = recent.length - 2; k >= 0 && q >= 0; k--) {
      for (let g = 0; g <= 2 && q - g >= 0; g++) {
        if (single(words[q - g], recent[k])) {
          score += weight(recent[k]);
          q = q - g - 1;
          break;
        }
      }
    }
    const dist = Math.abs(p + 1 - cursor);
    const need = dist > o.farDistance ? o.reanchorMinFar : o.reanchorMin;
    if (score < need) continue;
    if (score > bestScore || (score === bestScore && dist < bestDist)) {
      best = p;
      bestScore = score;
      bestDist = dist;
    }
  }
  return best >= 0 ? best + 1 : null;
}

/** Função pura: avança o estado consumindo palavras faladas (normalizadas). */
export function advance(s: TrackerState, words: Word[], spoken: string[], now: number, o: TrackerOptions = DEFAULT_OPTIONS): AdvanceResult {
  let { cursor, miss, lastMatchAt } = s;
  const recent = s.recent.slice();
  const hits: number[] = [];
  const missed: string[] = [];
  let reanchored = false;

  let i = 0;
  while (i < spoken.length) {
    const m = cursor < words.length ? forwardMatch(words, cursor, spoken, i, recent[recent.length - 1], o) : null;
    if (m) {
      hits.push(m.to - 1);
      cursor = m.to;
      miss = 0;
      lastMatchAt = now;
      for (let k = 0; k < m.len; k++) recent.push(spoken[i + k]);
      i += m.len;
      continue;
    }
    recent.push(spoken[i]);
    missed.push(spoken[i]);
    miss++;
    i++;
    if (miss >= o.reanchorMisses) {
      const a = globalAnchor(words, recent.slice(-o.reanchorWindow), cursor, o);
      if (a !== null && a !== cursor) {
        cursor = a;
        miss = 0;
        lastMatchAt = now;
        hits.push(a - 1);
        reanchored = true;
      }
    }
  }

  return {
    state: { cursor, miss, recent: recent.slice(-RECENT_MAX), lastMatchAt },
    hits,
    missed,
    reanchored,
  };
}

// ---- navegação manual ----

export function sentenceStartAt(words: Word[], i: number): number {
  let j = Math.min(i, words.length - 1);
  while (j > 0 && !words[j].sentenceStart) j--;
  return Math.max(0, j);
}

export function prevSentence(words: Word[], cursor: number): number {
  const start = sentenceStartAt(words, cursor);
  if (cursor - start > 1) return start;
  return start > 0 ? sentenceStartAt(words, start - 1) : 0;
}

export function nextSentence(words: Word[], cursor: number): number {
  for (let j = cursor + 1; j < words.length; j++) if (words[j].sentenceStart) return j;
  return words.length;
}

export function sectionAt(sections: Section[], cursor: number): number {
  let s = 0;
  for (let i = 0; i < sections.length; i++) if (sections[i].firstWord <= cursor && sections[i].wordCount > 0) s = i;
  return s;
}

export function prevSection(sections: Section[], cursor: number): number {
  const s = sectionAt(sections, cursor);
  const start = sections[s].firstWord;
  if (cursor - start > 2) return start;
  for (let i = s - 1; i >= 0; i--) if (sections[i].wordCount > 0) return sections[i].firstWord;
  return 0;
}

export function nextSection(sections: Section[], cursor: number, total: number): number {
  for (const sec of sections) if (sec.firstWord > cursor && sec.wordCount > 0) return sec.firstWord;
  return total;
}
