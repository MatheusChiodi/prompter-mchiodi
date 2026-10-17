const DIACRITICS = /[̀-ͯ]/g;

/** Forma comparável: sem acento, minúscula, só [a-z0-9]. "Node.js" → "nodejs", "ação" → "acao". */
export function norm(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const keyCache = new Map<string, string>();

/**
 * Chave fonética grosseira pt-BR + inglês "abrasileirado": aproxima como o STT pt-BR
 * escreve termos estrangeiros ("Kubernetes" ≈ "cubernetis", "deploy" ≈ "diploi").
 */
export function phoneticKey(n: string): string {
  if (n.length < 3) return n;
  const hit = keyCache.get(n);
  if (hit !== undefined) return hit;
  let s = n
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/sh|ch/g, 'x')
    .replace(/lh/g, 'li')
    .replace(/nh/g, 'ni')
    .replace(/ck/g, 'k')
    .replace(/qu(?=[ei])/g, 'k')
    .replace(/gu(?=[ei])/g, 'g')
    .replace(/c(?=[ei])/g, 's')
    .replace(/[cq]/g, 'k')
    .replace(/w/g, 'u')
    .replace(/y/g, 'i')
    .replace(/z/g, 's')
    .replace(/h/g, '')
    .replace(/e/g, 'i')
    .replace(/o/g, 'u')
    .replace(/m$/, 'n')
    .replace(/(.)\1+/g, '$1');
  if (s.length > 3) s = s.replace(/[aiu]$/, '');
  keyCache.set(n, s);
  return s;
}

/** Distância de Levenshtein limitada: true se dist(a, b) <= limit. */
export function editDistanceAtMost(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > limit) return false;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] <= limit;
}

/** Fuzzy só para palavras longas: em palavras curtas ("de"/"da", "que"/"quem") o erro puxa o cursor. */
export function fuzzyEqual(a: string, b: string): boolean {
  const min = Math.min(a.length, b.length);
  if (min < 5) return false;
  return editDistanceAtMost(a, b, Math.max(a.length, b.length) >= 9 ? 2 : 1);
}

/** Igualdade tolerante entre uma palavra do roteiro (norm + key) e uma palavra falada. */
export function sameWord(scriptNorm: string, scriptKey: string, spoken: string): boolean {
  if (scriptNorm === spoken) return true;
  if (scriptNorm.length >= 4 && spoken.length >= 4 && scriptKey === phoneticKey(spoken)) return true;
  return fuzzyEqual(scriptNorm, spoken);
}

export function tokenizeSpoken(text: string): string[] {
  return text.split(/\s+/).map(norm).filter(Boolean);
}

/** Separa identificadores compostos: "useEffect" → use effect, "Node.js" → node js, "e-mail" → e mail. */
export function splitCompound(display: string): string[] {
  const parts = display
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .map(norm)
    .filter(Boolean);
  return parts.length > 1 ? parts : [];
}

export const STOPWORDS = new Set(
  'a o as os e de da do das dos em no na nos nas um uma uns umas que se por para pra com sem é eh ao aos à às mas ou como mais já não nao isso esse essa este esta aqui lá la eu você voce vc ele ela tá ta né ne'
    .split(' ')
    .map(norm),
);
