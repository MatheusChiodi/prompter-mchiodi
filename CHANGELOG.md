# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-17

### Added

- Voice-following prompter for pt-BR using the Web Speech API, with interim/final handling (committed vs provisional cursor).
- Local matcher:
  - near and confirmed-far matching;
  - phonetic key for Portuguese and anglicisms;
  - edit distance for long words;
  - glued spoken words (`use effect` → `useEffect`);
  - offline tech-term aliases;
  - global re-anchor with stopword weighting and nearest-wins tie-break.
- Markdown parser: sections with time estimates, lists, emphasis, inline code, and `[CUE]` / `<!-- note -->` / `> note` markers rendered as SMPTE-colored cues.
- Optional Claude Code CLI integration, without an API key:
  - script preparation cached by SHA-256;
  - async re-anchoring when lost;
  - take review listing skipped, repeated and ad-libbed passages.
- Graceful fallback when the CLI is missing, logged out, rate-limited or slow.
- Watched `roteiros/` folder with live reload that keeps the reading position.
- Clapperboard home screen, on-air tally, timecode, section progress track, horizontal and vertical mirror, adjustable reading line, keyboard shortcuts.
- Interface in Portuguese and English.
- `iniciar.bat` one-click launcher for Windows.

[Unreleased]: https://github.com/MatheusChiodi/prompter-mchiodi/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/MatheusChiodi/prompter-mchiodi/releases/tag/v0.1.0
