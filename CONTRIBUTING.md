# Contributing

Thanks for wanting to make Prompter MChiodi better. Issues and pull requests are welcome in **English or Portuguese**.

## Before you start

- **Bugs:** open an issue with the [bug template](.github/ISSUE_TEMPLATE/bug_report.yml). For matcher bugs, include the script excerpt and what the recognizer heard (it's shown in the bottom bar of the prompter).
- **Features:** open an issue first so we can agree on the approach before you write code.
- **Security problems:** don't open a public issue. See [SECURITY.md](SECURITY.md).

## Setup

```bash
git clone https://github.com/MatheusChiodi/prompter-mchiodi.git
cd prompter-mchiodi
npm install
npm run dev        # backend :5179 + app http://localhost:5173
```

You need Node 20+ and Chrome or Edge. Claude Code is optional. Everything except the AI extras works without it.

## Before opening a PR

```bash
npm test           # matcher + parser suite
npm run build      # typecheck + production build
```

CI runs both on every push and pull request.

## Guidelines

- **The real-time loop stays local and synchronous.** Nothing slow (network, CLI, LLM) may sit between a recognized word and the cursor moving.
- **The app must work without Claude Code.** Every AI feature needs a local fallback.
- **Never use an API key.** The Claude integration goes through the logged-in `claude` CLI only.
- **Matcher changes need tests.** Add a case to [`web/src/lib/tracker.test.ts`](web/src/lib/tracker.test.ts) that fails before your change.
- **Every UI string goes through i18n.** Add it to both `pt` and `en` in [`web/src/lib/i18n.tsx`](web/src/lib/i18n.tsx).
- Code style: 2-space indent, English identifiers, comments only for the *why*.
- Commits: short imperative, e.g. `feat: add number normalization`, `fix: keep cursor on interim rewrite`.

## Good first contributions

- New entries in [`tech-aliases.ts`](web/src/lib/tech-aliases.ts) for terms the recognizer gets wrong.
- Spoken-number normalization ("dois mil e vinte e seis" ↔ "2026").
- A local speech engine (Vosk or whisper.cpp) behind the `SpeechEngine` interface.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
