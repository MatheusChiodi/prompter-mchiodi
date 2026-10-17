# Arquitetura: Prompter MChiodi

**Diagrama do fluxo:** [`fluxo.html`](fluxo.html) (abra no navegador; SVG auto-contido).

## Princípio

O **loop de tempo real é 100% local e síncrono**: STT → matcher → cursor → scroll. O Claude Code CLI fica **fora desse loop**, porque cada chamada leva segundos (medido: pré-processamento 16,5 s, reancoragem 5,3 s). Ele só entra em três usos assíncronos, cada um com fallback local:

| Uso | Quando | Fallback sem Claude |
|---|---|---|
| Pré-processamento | ao abrir o roteiro (cache por sha256) | parser local + dicionário `tech-aliases.ts` + estimativa a 150 ppm |
| Reancoragem | perdido por mais de N s (padrão 6), ou tecla R | reancoragem global do matcher local |
| Revisão pós-gravação | botão "Analisar com Claude" | revisão local por cobertura (`session-log.ts`) |

## Componentes

```
prompter-mchiodi/
├─ server/src/           Node puro (sem dependências)
│  ├─ index.js           HTTP + SSE + estático; rotas /api/*
│  ├─ claude.js          spawn do CLI, classificação de erros, cooldown, lanes
│  ├─ prompts.js         prompts pt-BR (preprocess / reanchor / review)
│  └─ watcher.js         fs.watch com debounce na pasta roteiros/
├─ web/src/
│  ├─ lib/markdown.ts    parser .md → blocos, palavras faláveis, cues, seções
│  ├─ lib/normalize.ts   norm (sem acento), chave fonética, Levenshtein limitado
│  ├─ lib/tech-aliases.ts aliases offline de termos técnicos
│  ├─ lib/tracker.ts     matcher puro + navegação por frase/seção
│  ├─ lib/speech.ts      Web Speech (interface SpeechEngine para trocar motor)
│  ├─ lib/session-log.ts registro da gravação e revisão local
│  ├─ lib/api.ts         cliente com timeout; nunca lança exceção
│  └─ components/        Home, Prompter, ScriptView, ReviewPanel
├─ roteiros/             pasta monitorada (criada com exemplo.md)
└─ .cache/preprocess/    <sha256>.json
```

## Fluxo de tempo real

1. `WebSpeechEngine` (pt-BR, `continuous` + `interimResults`) emite:
   - `onFinal(palavras)` para cada resultado final ainda não visto (rastreado por índice);
   - `onInterim(palavras)` com a cauda não final.
2. **Estado confirmado vs provisório.**
   - `committed = advance(committed, finais)`.
   - Cursor exibido = `advance(committed, interim)`, recalculado do zero a cada evento. Assim a revisão do interim nunca corrompe o estado (lacuna 2 da análise).
3. `advance()` é **função pura** (`tracker.ts`). Para cada palavra falada:
   - **perto** (`cursor..cursor+2`): basta casar;
   - **longe** (até 20): precisa de confirmação pela palavra falada anterior (até 3 antes) **ou** pela seguinte (até 2 depois);
   - **casar** = `matchLen()`: igualdade normalizada → chave fonética (palavras com 4 letras ou mais) → Levenshtein (1, ou 2 a partir de 9 letras, só com 5 letras ou mais) → concatenação de 2 ou 3 palavras faladas (`use`+`effect`) → aliases de 1 ou N palavras;
   - **erro** acumula `miss`. Com 4 erros, `globalAnchor()` alinha as últimas 7 palavras no roteiro inteiro: stopwords valem 0,5, saltos acima de 150 palavras exigem 4 pontos (perto exigem 3) e o empate vai para o **mais próximo do cursor**.
4. Render: `ScriptView` renderiza uma vez por roteiro (memo). Destaque e "passado" são aplicados **imperativamente** só no intervalo entre o cursor antigo e o novo, e o scroll persegue o alvo com rAF (lerp de 0,12).
5. Silêncio: sem evento, o cursor fica onde está. O status mostra "Silêncio" depois de 1,5 s sem fala.

## Reancoragem assíncrona

```
perdido = ouvindo ∧ ¬pausado ∧ fala nos últimos 1,5 s ∧ (agora − último match) > N s
```

Quando `perdido` e o Claude está disponível (com cooldown de 15 s):

1. Monta uma janela do roteiro de `cursor−150` a `cursor+300` em linhas por frase (`índice:palavra`) e as últimas 50 palavras transcritas.
2. `POST /api/reanchor` → `claude -p --model haiku` → `{index, confidence}`.
3. Aplica `cursor = index+1` só se `confidence ≥ 0,55` **e** o matcher local não casou nada desde o pedido (snapshot de `lastMatchAny`). Com a tecla R, aplica sem checar o snapshot.

O scroll local continua durante a chamada (lane `reanchor`: uma por vez).

## Pré-processamento

`POST /api/preprocess {markdown}`:

1. sha256 → procura em `.cache/preprocess/<hash>.json`.
2. Se não achar, faz uma chamada (pedidos concorrentes do mesmo hash são agrupados) e devolve `{sections[{title, estimatedSeconds}], aliases{termo:[variantes]}, cues[]}`, sanitizado.
3. No front, `parseScript` reaplica:
   - `aliases` → `Word.alts`;
   - `cues` → envolve o trecho literal como cue antes do parse;
   - `sections` → `estSeconds`, se a contagem de seções bater.

## Parser Markdown

| Entrada | Vira | Falado? |
|---|---|---|
| `#`…`######` | nova seção + divisor com tempo estimado | não (opção "ler headings") |
| parágrafo, `- item`, `1. item` | blocos com palavras | sim |
| `**negrito**`, `*itálico*`, `` `código` `` | estilo na palavra | sim |
| `[CORTE]`, `[B-ROLL: …]`, `[PAUSA]`, `[qualquer]` | cue colorida (cut/broll/pause/note) | não |
| `<!-- nota -->` | cue note | não |
| `> citação` | nota visual | não |
| ```` ``` ```` bloco | código esmaecido | não |
| `[texto](url)` | texto do link | sim |
| `![alt](img)` | cue IMG | não |

## Integração com o Claude Code CLI

- Comando: `claude -p --output-format json --tools "" --strict-mcp-config --setting-sources local --no-session-persistence [--model X]`, com o **prompt via stdin**, para que nenhum texto do usuário passe pela linha de comando ou pelo shell.
- `cwd` = pasta temporária neutra (não carrega o CLAUDE.md do projeto).
- `ANTHROPIC_API_KEY` e `ANTHROPIC_AUTH_TOKEN` são **removidas do env do filho**, então o CLI só pode usar o login OAuth da assinatura. `--bare` foi descartado de propósito: o `--help` diz que ele lê apenas `ANTHROPIC_API_KEY`.
- No Windows, `shell: true` para aceitar `claude.cmd` (instalação via npm). Os argumentos são constantes.
- Resultado: parse do JSON (`subtype === "success"`, `is_error === false`) e do `result` (extrai o primeiro `{…}`).
- Classificação de falhas e o que acontece em cada uma:

| Código | Detecção | Efeito |
|---|---|---|
| `not_installed` | ENOENT / exit 9009/127 / "not recognized" | reprova por 60 s e tenta de novo; o app segue sem IA |
| `not_logged_in` | `/login`, "not logged", "authenticat", "invalid api key" | mensagem para rodar `claude` e fazer `/login` |
| `rate_limited` | "usage limit", "rate limit", 429, "overloaded" | cooldown de 15 min (`CLAUDE_RATE_LIMIT_COOLDOWN_MS`) |
| `timeout` | timer por uso (preprocess 180 s, reanchor 30 s, review 240 s) | `taskkill /T /F` na árvore de processos |
| `busy` | lane ocupada | 409; o front só ignora |
| `bad_output` | JSON inválido | 502; o front usa o fallback |

## API local

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/health` | status do CLI + pasta monitorada |
| POST | `/api/claude/probe` | roda `claude --version` de novo |
| POST | `/api/preprocess` | ver acima |
| POST | `/api/reanchor` | `{transcript, lines[]}` → `{index, confidence}` |
| POST | `/api/review` | `{segments[{t,text}], sentences[{from,to,text}]}` → `{improvised, skipped, repeated, summary}` |
| GET | `/api/files`, `/api/file?name=` | listar e ler `.md` (só `basename`, extensões permitidas) |
| GET | `/api/events` | SSE: `files` e `changed` (recarrega o roteiro aberto mantendo o cursor) |

O servidor escuta em `127.0.0.1` por padrão.
