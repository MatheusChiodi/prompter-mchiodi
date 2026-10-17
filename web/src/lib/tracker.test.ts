import { describe, expect, it } from 'vitest';

import { parseScript } from './markdown';
import { tokenizeSpoken } from './normalize';
import { advance, initialState, nextSection, prevSentence, type TrackerState } from './tracker';

const MD = `# Teste

Fala pessoal, hoje vamos fazer o deploy de uma aplicação React no Kubernetes.

[CORTE]

## Hooks

O useEffect roda depois da renderização. Ele é útil para buscar dados da API.
Depois a gente publica tudo no GitHub e encerra o vídeo de hoje.
`;

const script = parseScript(MD);
const W = script.words;

const idx = (t: string, from = 0) => W.findIndex((w, i) => i >= from && w.norm === t);
const at = (cursor: number): TrackerState => ({ ...initialState(), cursor });
const feed = (state: TrackerState, text: string) => advance(state, W, tokenizeSpoken(text), 1000);

describe('parser', () => {
  it('separa cues e headings da fala', () => {
    expect(W.some((w) => w.norm === 'corte')).toBe(false);
    expect(W.some((w) => w.norm === 'hooks')).toBe(false);
    const cue = script.blocks.flatMap((b) => b.pieces).find((p) => p.t === 'cue');
    expect(cue?.t === 'cue' && cue.kind).toBe('cut');
    expect(script.sections.map((s) => s.title)).toEqual(['Teste', 'Hooks']);
  });

  it('cues extras do pré-processamento saem da fala', () => {
    const s = parseScript('Olá (olhar para a câmera 2) pessoal', { extraCues: ['(olhar para a câmera 2)'] });
    expect(s.words.map((w) => w.norm)).toEqual(['ola', 'pessoal']);
  });
});

describe('tracker', () => {
  it('segue leitura linear', () => {
    expect(feed(initialState(), 'fala pessoal hoje vamos fazer o deploy').state.cursor).toBe(idx('deploy') + 1);
  });

  it('aceita termos técnicos como o STT pt-BR escreve', () => {
    expect(feed(at(idx('uma')), 'uma aplicação riact no cubernetis').state.cursor).toBe(idx('kubernetes') + 1);
  });

  it('casa identificador separado pelo STT ("use effect")', () => {
    expect(feed(at(idx('useeffect') - 1), 'o use effect roda depois').state.cursor).toBe(idx('depois') + 1);
  });

  it('tolera palavra pulada', () => {
    expect(feed(initialState(), 'fala pessoal vamos fazer').state.cursor).toBe(idx('fazer') + 1);
  });

  it('stopword solta não arrasta o cursor para longe', () => {
    expect(feed(at(idx('fala')), 'de').state.cursor).toBe(idx('fala'));
  });

  it('improviso não move o cursor', () => {
    expect(feed(at(idx('hoje')), 'peraí deixa eu beber uma água rapidinho').state.cursor).toBeLessThanOrEqual(idx('hoje') + 1);
  });

  it('reancora quando releio uma frase anterior', () => {
    const r = feed(at(idx('github')), 'ele é útil para buscar dados da api');
    expect(r.state.cursor).toBe(idx('api') + 1);
    expect(r.reanchored).toBe(true);
  });

  it('navegação por frase e seção', () => {
    const roda = idx('roda');
    expect(W[prevSentence(W, roda + 1)].norm).toBe('o');
    expect(nextSection(script.sections, 0, W.length)).toBe(script.sections[1].firstWord);
  });
});
