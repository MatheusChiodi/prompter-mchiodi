# Análise: teleprompters guiados por voz (Fases 1 e 2)

Data: 2026-10-17. Alvos clonados com `--depth 1` e lidos como dado não confiável (nada foi executado).

- **LT** = [ShayneP/local-teleprompter](https://github.com/ShayneP/local-teleprompter)
- **VP** = [aaronse/VoicePrompter](https://github.com/aaronse/VoicePrompter) (fork de `kosuvorov/VoicePrompter`; as issues do fork estão desativadas, então li as do upstream)

Ferramenta: `rea@6.4.0 analyze-javascript-application` nos dois fontes (evidências `ev_94b489d4…` para LT/`frontend/lib` e `ev_32da405a…` para VP/`src`). O REA só devolve o grafo de módulos e storage (VP: 13 módulos, 2 nós de storage = localStorage; LT/lib: 6 módulos, 1 endpoint, 1 storage). Ele não explica os algoritmos, então matcher, parser e STT foram analisados lendo os fontes. As referências `arquivo:linha` abaixo são desses clones.

---

## Fase 1: cada projeto

### LT: local-teleprompter

**Arquitetura (4 processos)**

```
frontend/      Next.js + LiveKit components (UI, SQLite de roteiros)
livekit-server/ servidor WebRTC local
agent/         agente Python LiveKit (agent.py + local_stt.py)
stt-server/    FastAPI + NeMo, modelo NVIDIA (server.py, 637 linhas)
```

Fluxo: mic → WebRTC (sala LiveKit) → agente Python → WebSocket `/v1/audio/stream` do stt-server → transcrição volta para a sala → `useTranscriptions()` no React (`prompter-view.tsx:40`) → `join(' ')` de todas as transcrições → `tokenizeSpoken` → `advanceTracker` → `scrollTo({behavior:'smooth'})` com a palavra na linha de leitura a 1/3 da altura (`prompter-view.tsx:98-108`).

**STT**

- Modelo `nvidia/nemotron-3.5-asr-streaming-0.6b`, FastConformer-RNNT *cache-aware*, 600M parâmetros (`server.py:48`, README do stt-server).
- Idioma: prompt `target_lang` ou `auto` (`server.py:99-121`, `STT_TARGET_LANG`). O README promete "35+ idiomas", mas **o repositório não menciona português** em lugar nenhum (busca por `pt-`/`Portug` deu zero). O suporte a pt-BR não foi verificado aqui e depende do model card.
- Latência declarada: cerca de 100 ms em GPU NVIDIA, menos de 150 ms em Apple Silicon e streaming por palavra em cerca de 80 ms (README). Não medi.
- Offline: sim, depois do download (torch + NeMo, "vários GB").
- Plataforma: **macOS/Linux** (`start.sh`, `install.sh` em bash e Homebrew). No Windows precisaria de WSL.

**Matcher** (`frontend/lib/teleprompter/position-tracker.ts`)

| Aspecto | Como funciona |
|---|---|
| Tokenização | Sequências `[\p{L}\p{N}]+`, minúsculas, **sem remover acento** (`:51`, `:66`) |
| Avanço | Só para frente. Procura a palavra falada em `cursor..cursor+2` (`NEAR_JUMP`), e até 18 palavras à frente (`DEFAULT_LOOKAHEAD`) desde que confirmada por bigrama: a palavra falada anterior precisa casar até 3 posições antes (`:140-163`) |
| Tolerância | Levenshtein ≤ 1, só para palavras com 5 letras ou mais (`:223-233`) |
| Palavra pulada | Coberta pelo lookahead com bigrama |
| Frase relida / salto | Depois de 4 erros seguidos, varre o roteiro inteiro com as últimas 6 falas e exige 3 acertos (`:125-133`, `:171-202`) |
| Improviso | Acumula `missStreak`. Se 3 palavras de 6 casarem em qualquer lugar do roteiro, ele pula |
| Silêncio | Nada acontece (não chega evento), o cursor fica parado e não há indicação |
| Correção do STT | Se a lista de palavras faladas encolher, só refaz a contagem do que já foi consumido (`:103-109`) |

**Parser**: só a primeira linha `# título` é tratada (`markdown.ts:13-34`). O resto vira texto cru renderizado com `whitespace-pre-wrap`: `##`, `**` e `-` aparecem na tela, e **`[CORTE]` vira a palavra "CORTE", que o matcher espera ouvir**.

**UI**: fonte de 24 a 96 px, linha de leitura fixa em 1/3, pausar/retomar, reiniciar, mutar o mic e duplo clique para pular. Não tem espelhamento nem atalhos de teclado (busca por `keydown` deu zero).

**Pontos fracos e bugs**

1. **Empate na reancoragem escolhe a primeira ocorrência** (`score > bestScore` é estrito, `:195`). Se a frase se repete no roteiro (CTA, refrão), relê-la manda o cursor para a primeira vez que ela aparece.
2. Revisão do STT com o **mesmo tamanho** e palavras diferentes não é reprocessada: a palavra errada já foi consumida (`:103-109`).
3. Stopwords pesam o mesmo que as outras palavras na reancoragem, então improviso com "de/que/o" pode teleportar o cursor.
4. Sem acento normalizado nem aliases: "Kubernetes" falado e transcrito "cubernetes" só casa por sorte de Levenshtein.
5. Cues entre colchetes são esperadas na fala, e o Markdown não é interpretado.
6. Infra pesada (LiveKit + agente + NeMo) e um workaround frágil para um bug do `@livekit/components-react@2.9.20` (`agent/src/agent.py`, comentário longo sobre `useAgent`).
7. Issues: o repositório tem **0 issues** (abertas ou fechadas).

### VP: VoicePrompter

**Arquitetura**: Vite + TypeScript sem framework (`src/main.ts` com 1183 linhas, mais `speech.ts`, `render.ts`, `autoscroll.ts`, `video.ts`), PWA. A maior parte do repositório é site de marketing e SEO (`blog/`, `mac/`, `ios/`). Tem um Worker da Cloudflare só para importar do Google Docs (`cloudflare/gdoc-proxy`).

Fluxo: `SpeechRecognition` (continuous + interim, `speech.ts:33-36`) → concatena os resultados a partir de `resultIndex` → **só as últimas 5 palavras** (`speech.ts:106-107`) → `matchWords` → `currentIndex` → `updateHighlight()` percorre **todas** as palavras a cada evento (`render.ts:67-91`) → `smoothScrollTo` de 600 ms com rAF (`render.ts:93-136`).

**STT**: Web Speech API.

- No Chrome o áudio vai para servidores do Google, no Edge para a Microsoft. Precisa de internet. Firefox não tem a API (`speech.ts:27-31`).
- Latência típica de interim: 200 a 500 ms, mais rede (estimativa, não medi).
- **pt-BR não existe na lista**: só `pt-PT` (`main.ts:26`), e a autodetecção mapeia `'pt' → 'pt-PT'` (`main.ts:62`). Um brasileiro cai no modelo de Portugal.

**Matcher** (`speech.ts:200-250`)

| Aspecto | Como funciona |
|---|---|
| Avanço | Monta um `Set` com as 5 últimas palavras faladas. Percorre o roteiro a partir do cursor por até `lookaheadWords` (padrão **5**, `state.ts:29`). A primeira palavra do roteiro que estiver no Set vira o cursor |
| Ordem | **Ignorada**: é um conjunto, não uma sequência |
| Tolerância | Só igualdade exata depois de `[^\p{L}\p{N}]` → "" |
| Palavra pulada | Até 5 palavras. Mais que isso e ele se perde |
| Frase relida | **Não volta.** Não existe reancoragem. Só os comandos de voz "go back"/"go start" (em inglês, desligados por padrão) ou um toque na palavra |
| Improviso | Qualquer palavra comum no lookahead avança o cursor |
| Silêncio | No modo voz, nada acontece. No modo "sound" (`autoscroll.ts`) tem um VAD por RMS com hold de 250 ms que pausa a rolagem automática, uma boa ideia |

**Parser** (`main.ts:265-315`): texto puro. `[...]` é pulado (inclusive quando atravessa várias palavras), emojis também, e a quebra de linha vira 🛑 ou `<br>`. Não interpreta Markdown: `#` e `**` aparecem literalmente.

**UI**: o ponto forte.

- Espelho vertical (`scaleX(-1) rotate(180deg)`) e horizontal em beta (`style.css`, `?beta=hmirror`).
- Linha ativa configurável (35% por padrão) e fontes, incluindo OpenDyslexic.
- Cores, altura de linha, RTL, gravação de vídeo com overlay e import do Google Docs.
- **Não tem atalhos de teclado** (zero `keydown`).

**Pontos fracos e bugs**

1. O **matcher baseado em conjunto** reprocessa as mesmas 5 palavras a cada evento interim. Stopwords ("a", "o", "de") empurram o cursor para frente.
2. Não tem reancoragem para trás.
3. pt-BR ausente (ver STT).
4. `updateHighlight` é O(n) a cada palavra, o que pesa em roteiros longos.
5. Issues abertas no upstream: #14 comandos de voz em italiano quebrados; #13 tela cheia; **#12 pedido de espelho horizontal** (o espelho padrão é vertical); #11 salvar configurações na web; #10 gravar áudio; **#8 expor as cues de produção puladas por uma API local**.
6. A documentação do fork (`docs/fork/2026-08-05-state-of-project.md`) registra que o README do upstream dizia "sem coleta de dados", mas o app carregava 2 trackers e session replay. Segundo o mesmo documento, o fork corrigiu isso.

---

## Tabela comparativa

| | **LT: local-teleprompter** | **VP: VoicePrompter** |
|---|---|---|
| Stack | Next.js + LiveKit + Python agent + FastAPI/NeMo | Vite + TS vanilla, PWA |
| Fluxo mic→tela | mic → WebRTC → agente → WS STT → transcrição → React | mic → Web Speech → `onresult` → DOM |
| Motor STT | Nemotron 3.5 ASR streaming 0.6B (local) | Web Speech API (nuvem Google/MS) |
| Latência | ~100–150 ms (declarada) | ~200–500 ms + rede (estimada) |
| pt-BR | não citado no repo; não verificado | **ausente** (só pt-PT) |
| Offline | sim | não (Chrome/Edge) |
| Windows | não (bash/Homebrew) | sim (navegador) |
| Setup | pesado (GBs, 4 processos) | zero |
| Matching | sequencial, lookahead 18, bigrama, Levenshtein ≥5 | conjunto das 5 últimas, lookahead 5, exato |
| Palavra pulada | ✅ até 18 | ⚠️ até 5 |
| Frase relida | ✅ reancoragem global (empate → 1ª ocorrência) | ❌ |
| Improviso | ⚠️ pode teleportar (3/6) | ❌ avança em stopwords |
| Silêncio | segura, sem indicador | segura; VAD RMS só no modo "sound" |
| Termos técnicos EN | ❌ sem alias/fonética | ❌ |
| Markdown | só título `#` | nenhum |
| Cues `[...]` | ❌ esperadas na fala | ✅ puladas |
| Espelho | ❌ | ✅ vertical (+ horizontal beta) |
| Linha de foco | fixa 1/3 | ajustável (%) |
| Atalhos | ❌ | ❌ (comandos de voz em inglês) |
| Persistência | SQLite | localStorage |
| Issues | 0 | 6 abertas (upstream) |

---

## Fase 2: síntese

### Copiar

| De | O quê |
|---|---|
| LT | Rastreador **sequencial com cursor + lookahead + confirmação por bigrama**, e reancoragem global depois de N erros. É o núcleo certo |
| LT | Fuzzy **só em palavras longas**, para que "de/da", "que/quem" não arrastem o cursor |
| LT | Rebase do backlog ao pausar e cursor por clique |
| VP | Cues `[...]` fora da fala; espelho; linha ativa em %; scroll suave com rAF |
| VP | Ideia do VAD por RMS com hold (usar como indicador de silêncio e fallback) |
| VP | Detecção de conflito antes de comandos (não disparar comando se o texto do roteiro contém a frase) |

### Descartar

- O Set das últimas N palavras do VP (ignora ordem e reprocessa interim).
- LiveKit + agente para um único usuário local (LT): é infraestrutura de conferência para um caso que só tem um microfone.
- `updateHighlight` O(n) e re-render de todas as palavras.
- Parser de Markdown que mostra `##`/`**` na tela.

### Lacunas que nenhum dos dois resolve

1. **Termos técnicos em inglês falados em pt-BR.** O STT pt-BR escreve "cubernetes", "deploi", "use effect", "riact", "doquer faio". Nenhum dos dois projetos tem:
   - normalização de acento ("é" e "e");
   - **chave fonética** pt-BR + inglês abrasileirado (c/k/q, e/i, o/u, y→i, w→u, vogal final muda);
   - **aliases** por termo, inclusive com várias palavras ("use effect" → `useEffect`);
   - concatenação de palavras faladas ("node" + "js" → `Node.js`).
2. **Interim vs final.** Precisa de estado *confirmado* (finais) e cursor *provisório* (confirmado + interim recalculado a cada evento), para que a revisão do STT nunca corrompa o estado.
3. **Improviso não pode teleportar.** Stopwords valem menos e saltos longos exigem mais acertos. Desempatar pela **proximidade do cursor**, não pela primeira ocorrência.
4. **Saber que está perdido** (fala chegando sem casar por N segundos) e ter um plano B assíncrono: reancoragem por LLM, que **não bloqueia** o scroll e é descartada se o matcher local se achar antes.
5. Markdown de verdade: headings como seções com tempo estimado, listas, negrito, `código` falado e blocos de código, citações e comentários HTML como cues.
6. Atalhos de teclado (frase, seção, pausa, espelho, foco) e espelho horizontal (issue #12 do VP).
7. Relatório pós-gravação de trechos pulados, repetidos e improvisados (issue #8 do VP pede algo próximo).
8. pt-BR de primeira classe no Windows, sem GBs de dependência.

Tudo isso foi implementado no Prompter MChiodi; ver `02-arquitetura.md` e `03-decisoes.md`.
