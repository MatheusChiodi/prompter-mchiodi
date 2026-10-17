# Security Policy

## Supported versions

Only the latest commit on `main` receives fixes.

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private reporting instead:

1. Go to the [Security tab](https://github.com/MatheusChiodi/prompter-mchiodi/security).
2. Click **Report a vulnerability**.
3. Describe the issue, how to reproduce it, and its impact.

You can expect a first response within 7 days.

## Security model

Prompter MChiodi is designed to run **on your own machine**:

- The backend listens on `127.0.0.1` by default. Exposing it with `HOST=0.0.0.0` lets anyone on your network read files from the watched folder and trigger Claude Code calls billed to your subscription. Don't do this on untrusted networks.
- The Claude Code CLI is spawned with the prompt sent over stdin, with all tools disabled (`--tools ""`), no MCP servers, and `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` removed from its environment.
- `/api/file` only serves `.md`, `.markdown` and `.txt` files from the watched folder, resolved by base name.
- Speech recognition uses the browser's Web Speech API. In Chrome and Edge, **audio is processed by Google or Microsoft servers**. Don't read confidential material with the microphone on if that matters to you.
- Script content you open may be sent to Claude through your own CLI session when the AI features are available.
