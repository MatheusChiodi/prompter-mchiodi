# Decisões e trade-offs

## 1. STT: Web Speech API (padrão) vs Whisper/Nemotron/Vosk local

**Decisão:** Web Speech (Chrome/Edge, `pt-BR`) atrás da interface `SpeechEngine` (`web/src/lib/speech.ts`). Um motor local fica plugável depois.

| | Web Speech | Nemotron (LT) | Whisper local | Vosk |
|---|---|---|---|---|
| pt-BR | ✅ nativo | ❓ não verificado | ✅ | ✅ (modelo pt) |
| Streaming por palavra | ✅ interim | ✅ | ⚠️ janelas de chunk, latência alta sem GPU | ✅ |
| Windows | ✅ | ❌ (bash/NeMo) | ⚠️ (whisper.cpp ok) | ✅ |
| Offline | ❌ (nuvem) | ✅ | ✅ | ✅ |
| Setup | zero | GBs | médio | pequeno (~50 MB) |
| Termos técnicos EN | fraco | ? | melhor (multilíngue) | fraco |

**Por quê:** é zero setup no Windows, tem streaming de palavras em pt-BR e atende o requisito de seguir palavra a palavra. As fraquezas são compensadas no matcher (fonética + aliases).

**Custo:** o áudio sai da máquina (Google/Microsoft). Sem internet, o STT para (erro `network` aparece na tela). Próximo passo natural: um motor `VoskEngine`/`WhisperCppEngine` servido pelo backend Node via WebSocket, mantendo o mesmo `SpeechHandlers`.

## 2. O Claude fora do loop de tempo real

Medido no Windows (Claude Code 2.1.302): pré-processamento 16,5 s, reancoragem 5,3 s (o modelo levou 2,2 s, o resto é startup do CLI). Valores dessa ordem só servem para trabalho assíncrono. O loop local responde a cada evento do STT. Quando a reancoragem do Claude chega atrasada e o matcher local já se achou, ela é descartada (snapshot de `lastMatchAny`).

## 3. Subscription-only

Prompt via stdin. `ANTHROPIC_API_KEY` e `ANTHROPIC_AUTH_TOKEN` são removidas do env. Não usa `--bare` (que exige API key). `--tools ""` e `--strict-mcp-config` reduzem o que o CLI pode fazer e o tempo de startup. `--setting-sources local` com cwd neutro evita hooks e plugins do usuário (por exemplo o `SessionStart` do memory-team).

**Trade-off:** se o usuário depender de alguma configuração de `user` para autenticar, como um proxy, precisa sobrescrever com `CLAUDE_ARGS`.

## 4. Matcher sequencial (LT) + fonética/aliases (novo) em vez do Set do VP

O Set do VP ignora a ordem e reprocessa as mesmas palavras. O cursor + lookahead + bigrama do LT é robusto. O que foi adicionado:

- confirmação também pela palavra **seguinte** (útil no primeiro termo de um lote);
- chave fonética pt-BR;
- aliases de várias palavras;
- concatenação ("use effect");
- stopwords com peso 0,5 e limiar maior para saltos longos;
- **desempate por proximidade** (o LT pega a 1ª ocorrência).

**Trade-off:** a chave fonética aumenta os falsos positivos em palavras médias. Por isso ela só vale com 4 letras ou mais, e salto longo continua exigindo confirmação. Os testes em `tracker.test.ts` cobrem leitura linear, alias técnico, "use effect", palavra pulada, stopword, improviso e releitura.

## 5. Estado confirmado + cursor provisório

Interim é recalculado do zero sobre o estado confirmado a cada evento: custo O(lote × lookahead), desprezível. Isso evita o bug do LT (revisão de mesmo tamanho não reprocessada). Pode haver tremulação de 1 ou 2 palavras quando o STT reescreve o interim, o que é aceitável.

## 6. Render imperativo

O destaque é aplicado por `classList` só no intervalo que mudou, e o React renderiza o roteiro uma vez. Com milhares de spans, isso evita reconciliação a cada palavra (o `updateHighlight` do VP é O(n)).

## 7. Backend Node sem dependências

`node:http`, `fs.watch` e SSE à mão. Fica menor, sem supply chain e sobe instantâneo. O custo é um roteador mínimo e `fs.watch`, que no Windows dispara eventos duplicados (resolvido com debounce de 200 ms).

## 8. Markdown com parser próprio em vez de remark/markdown-it

O matcher precisa de índice estável por palavra falável e da separação fala/cue no nível do token. Um AST genérico exigiria uma segunda passada de qualquer forma. Limitações: não suporta tabelas, HTML inline nem ênfase aninhada complexa.

## 9. Citação `>` = nota não falada

Em roteiro de vídeo, `>` costuma ser uma nota para o apresentador. Se você usa `>` para citar algo que vai ler em voz alta, remova o `>` ou altere `paraKind` em `markdown.ts`.

## 10. Espelho por `transform: scale(±1, ±1)`

H e V são independentes (M e V no teclado), resolvendo a issue #12 do VP. A linha de foco fica dentro da área espelhada para continuar alinhada no vidro.

## Limitações conhecidas / não verificado

- **Não testei o reconhecimento de fala real no navegador.** Microfone e Web Speech exigem interação humana. Testado: parser + matcher (10 testes), typecheck + build, backend e chamadas reais ao `claude -p` (preprocess, cache e reanchor) e o fallback sem CLI.
- `/api/review` não foi chamado de ponta a ponta; usa o mesmo caminho do preprocess.
- A detecção de `not_logged_in` e `rate_limited` usa regex sobre mensagens do CLI, que podem mudar entre versões.
- Números falados ("dois mil e vinte e seis" e "2026") não são normalizados.
- Aliases com chave de várias palavras ("Visual Studio Code") são ignorados; só chaves de uma palavra.
- Sem comandos de voz (escolha consciente: atalhos de teclado não competem com a fala).
