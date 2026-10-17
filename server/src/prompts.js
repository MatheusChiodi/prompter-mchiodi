export function preprocessPrompt(markdown) {
  return `Você prepara roteiros para um teleprompter que segue a voz em português do Brasil usando reconhecimento de fala do navegador (Google/Microsoft, pt-BR).
Analise o roteiro Markdown abaixo e responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, exatamente neste formato:
{
  "sections": [{ "title": string, "estimatedSeconds": number }],
  "aliases": { "<termo exatamente como aparece no roteiro>": ["<variante>", "..."] },
  "cues": ["<trecho literal do roteiro que é instrução de produção>"]
}
Regras:
- sections: uma por heading Markdown (#, ##, ###...) na ordem em que aparecem. Se houver texto antes do primeiro heading, a primeira seção tem title "". estimatedSeconds: ~150 palavras por minuto em pt-BR, somando ~2 s por marcação de pausa. Headings, marcações entre [colchetes], comentários HTML, citações (>) e blocos de código NÃO são falados.
- aliases: termos que o reconhecimento de fala pt-BR costuma transcrever errado quando falados por um brasileiro: palavras em inglês, siglas, nomes de produtos/bibliotecas, identificadores de código (camelCase, com ponto), números e unidades. Para cada termo, 2 a 5 variantes em minúsculas, do jeito que o STT pt-BR escreveria. Exemplos: "Kubernetes": ["cubernetes", "kubernets", "cuber netes"]; "useEffect": ["use effect", "iusefect", "use efect"]; "deploy": ["deploi", "diploi"]; "API": ["a p i", "api"]; "Node.js": ["node js", "nodejs", "noud jeis"]. Não inclua palavras comuns do português. A chave deve ser uma única palavra do roteiro (sem espaços).
- cues: apenas instruções de produção que NÃO estejam entre colchetes, em comentários HTML ou em citações (ex.: "(olhar para a câmera 2)"). Copie o trecho literalmente. Pode ser [].

<roteiro>
${markdown}
</roteiro>`;
}

export function reanchorPrompt({ transcript, lines }) {
  return `Um teleprompter perdeu a posição do apresentador (fala em pt-BR; o STT erra principalmente termos em inglês).
Abaixo: (1) as últimas palavras transcritas e (2) um trecho do roteiro em que cada palavra falável vem prefixada pelo seu índice no formato índice:palavra.
Determine o índice da ÚLTIMA palavra do roteiro que o apresentador acabou de falar. Se a fala recente for improviso sem correspondência no trecho, use null.
Responda SOMENTE com JSON: {"index": number | null, "confidence": number entre 0 e 1}

<transcricao>
${transcript}
</transcricao>

<roteiro>
${lines.join('\n')}
</roteiro>`;
}

export function reviewPrompt({ segments, sentences }) {
  const transcript = segments.map((s) => `[${fmt(s.t)}] ${s.text}`).join('\n');
  const script = sentences.map((s) => `#${s.from}-${s.to}: ${s.text}`).join('\n');
  return `Compare a transcrição de uma gravação (pt-BR, com erros de STT em termos técnicos em inglês) com o roteiro planejado.
O roteiro está dividido em frases no formato #primeiraPalavra-últimaPalavra: texto.
Liste, para ajudar na edição do vídeo:
- improvised: trechos falados que não estão no roteiro (improviso), com o tempo [mm:ss] aproximado.
- skipped: frases ou trechos do roteiro que não foram falados.
- repeated: trechos do roteiro falados mais de uma vez (regravação/tropeço), com tempo e quantidade.
Ignore diferenças pequenas causadas por erro de transcrição.
Responda SOMENTE com JSON:
{"improvised":[{"at":"mm:ss","text":string}],"skipped":[{"fromWord":number,"toWord":number,"text":string}],"repeated":[{"at":"mm:ss","text":string,"times":number}],"summary":string}

<transcricao>
${transcript}
</transcricao>

<roteiro>
${script}
</roteiro>`;
}

function fmt(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
