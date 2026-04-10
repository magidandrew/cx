# Changelog

All notable changes to this project are documented in this file.

## [0.2.1] — 2026-04-10

- Point the npm `homepage` field at [cx.worms.coffee](https://cx.worms.coffee) so the npm sidebar links to the docs site instead of the GitHub README.

## [0.2.0] — 2026-04-10

### New patches

- **session-usage** — Display `25% session used · 15% context used` in the TokenWarning slot. Every 7 seconds the prefix flashes to the 5-hour window reset time (`session resets in 2h 14m · 15% context used`). Supersedes `always-show-context`.
- **cut-to-clipboard** — Cut the current prompt to the system clipboard.
- **granular-effort** — Replace the coarse effort slider with a granular control.
- **disable-text-truncation** — Stop Claude Code from collapsing long text blocks.
- **anthropic-status-banner** — Surface anthropic.com status in the banner.

### Features

- **Ctrl+Q marker** — Messages enqueued via Ctrl+Q now render with a `queued ❯` prefix so they stand out from regular Enter submissions that pass through the queue.
- **`conflictsWith` framework** — Patches can declare mutual exclusions; `cx setup` surfaces and auto-resolves conflicts at transform time.
- **vim-magic find in cx setup** — New search helper, regrouped sections.
- **Banner x.com handle** — Wrapped in OSC 8 hyperlink so terminals that support it render it as a clickable link.

### Docs

- New VitePress docs site at [magidandrew.github.io/cx](https://magidandrew.github.io/cx) with a per-patch reference, logo, and brand-matched theme.
- Copyable `npm i -g claude-code-extensions` install box on the homepage.
- README.

## [0.1.2]

- Star-the-repo banner.
- Pure `cx` wrapper (removed `session-export` and `session-timer`).
- Fix npm trusted publishing: add repository field, use `--provenance`, upgrade to Node 24.
