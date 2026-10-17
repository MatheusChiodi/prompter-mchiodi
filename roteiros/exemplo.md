# Deploy de React no Kubernetes

Fala, pessoal! Hoje eu vou mostrar como fazer o deploy de uma aplicação React dentro de um cluster Kubernetes, do zero.

[CORTE]

## O problema

Quando o projeto cresce, o `useEffect` vira uma bagunça e o build demora. A gente vai organizar isso antes de subir para produção.

- Primeiro, gerar a imagem com Docker.
- Depois, publicar no registry do GitHub.
- Por fim, aplicar os manifests com kubectl.

[B-ROLL: terminal rodando docker build]

## Mão na massa

Abra o VS Code e crie um Dockerfile na raiz. O Node.js vai servir os arquivos estáticos gerados pelo Vite.

> Nota: mostrar o Dockerfile em tela cheia.

[PAUSA]

Se ficou alguma dúvida, deixa nos comentários. Valeu e até a próxima!
