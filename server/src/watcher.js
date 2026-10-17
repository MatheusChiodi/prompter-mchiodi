import { existsSync, mkdirSync, readdirSync, statSync, watch, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const EXT = new Set(['.md', '.markdown', '.txt']);

export function createWatcher(dir, onChange) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'exemplo.md'), SAMPLE, 'utf8');
  }

  const timers = new Map();
  let watcher = null;
  try {
    watcher = watch(dir, (_event, filename) => {
      if (!filename || !EXT.has(extname(filename).toLowerCase())) return;
      // fs.watch dispara várias vezes por gravação no Windows: debounce por arquivo.
      clearTimeout(timers.get(filename));
      timers.set(filename, setTimeout(() => {
        timers.delete(filename);
        onChange(String(filename));
      }, 200));
    });
  } catch (e) {
    console.warn(`[watch] não foi possível monitorar ${dir}: ${e.message}`);
  }

  return {
    dir,
    list() {
      return readdirSync(dir)
        .filter((f) => EXT.has(extname(f).toLowerCase()))
        .map((name) => {
          const st = statSync(join(dir, name));
          return { name, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
    },
    resolve(name) {
      const safe = basename(String(name));
      if (!EXT.has(extname(safe).toLowerCase())) return null;
      const full = join(dir, safe);
      return existsSync(full) ? full : null;
    },
    close() {
      watcher?.close();
    },
  };
}

const SAMPLE = `# Deploy de React no Kubernetes

Fala, pessoal! Hoje eu vou mostrar como fazer o deploy de uma aplicação React dentro de um cluster Kubernetes, do zero.

[CORTE]

## O problema

Quando o projeto cresce, o \`useEffect\` vira uma bagunça e o build demora. A gente vai organizar isso antes de subir para produção.

- Primeiro, gerar a imagem com Docker.
- Depois, publicar no registry do GitHub.
- Por fim, aplicar os manifests com kubectl.

[B-ROLL: terminal rodando docker build]

## Mão na massa

Abra o VS Code e crie um Dockerfile na raiz. O Node.js vai servir os arquivos estáticos gerados pelo Vite.

> Nota: mostrar o Dockerfile em tela cheia.

[PAUSA]

Se ficou alguma dúvida, deixa nos comentários. Valeu e até a próxima!
`;
