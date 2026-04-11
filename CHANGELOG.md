# Changelog

All notable changes to this project are documented in this file.

## [0.2.5] — 2026-04-11

### New patches

- **delete-sessions** — `Opt+D` in the `/resume` picker stages the focused session for deletion; a second `Opt+D` deletes the `.jsonl` transcript plus the per-session directories under `.claude/file-history`, `.claude/session-env`, and the sibling subagent dir. Any other key cancels. Adds an `Opt+D Delete` hint to the picker's keyboard-shortcut row. Addresses [anthropics/claude-code#13514](https://github.com/anthropics/claude-code/issues/13514).
- **nsfw-spinner** — Replaces the rotating `SPINNER_VERBS` array with a NSFW word list. Tagged `[nsfw]`, off by default, conflicts with `simple-spinner`.

### Changes

- **cx setup** — Patches can now declare a `tag` (e.g. `nsfw`, `experimental`); the TUI renders it in magenta next to the description, with the truncation budget adjusted so tagged rows still fit the terminal width. Adjacent conflicting rows are now connected by a gutter glyph (`╮`/`│`/`╯`) so conflict pairs are visually linked, and toggling either side on forces the other off live (the transform already resolves the same way, but the TUI now reflects it immediately instead of silently dropping the loser at save time).
- **banner** — Adds a "please star the repo" dim text line to the wide (LogoV2) Claude Code startup layout to match the existing condensed and boxed injections.

## [0.2.4] — 2026-04-10

### Fixes

- **Version check** now surfaces new releases within minutes instead of up to 24 hours. The old 24h cache meant fresh publishes often weren't shown for a full day after they landed on npm. Cache TTL dropped to 10 minutes, and on a stale cache we now block up to 500ms to refresh before printing — so the upgrade banner appears on the very first run after a publish, not one run later.
- Version-check state moved from the in-package `.cache/` dir (wiped on every `npm i -g`) to `~/.config/cx/cache/version-check.json`. Installing an older version no longer loses the "newer exists" knowledge, and the cache is now shared across node versions managed by fnm.

### Internal

- Hardened the version-check path end to end: shape-validated cache reads, atomic temp+rename writes, clock-skew-aware freshness checks, and single-settle guards on the fetch promise. Every failure mode (corrupt cache, disk full, registry timeout, stderr torn down) degrades to "print nothing" instead of crashing cx.

## [0.2.3] — 2026-04-10

### Fixes

- Patch config now lives at `~/.config/cx/patches.json` instead of inside the installed package directory, so it survives `npm i -g claude-code-extensions`. Previously every reinstall wiped the config and dropped you back into first-run setup.

## [0.2.2] — 2026-04-10

### New patches

- **auto-rename-first-message** — Persist the Haiku-generated first-message title to disk so `/resume` and the terminal tab show it immediately, no manual `/rename` required.
- **rename-random-color** — Reroll the prompt-bar color to a random pick from the eight built-in agent colors every time you run `/rename`.
- **per-session-effort** — Stop the cross-terminal effort clobber: `/effort` still writes to `settings.json` (last-write-wins for new sessions), but running instances no longer overwrite each other's in-memory `effortValue`.

### Changes

- **session-usage**, **cut-to-clipboard**, **granular-effort** — now default-on.
- **always-show-context** removed. Its behavior is fully covered by `session-usage`.
- `cx` writes a trailing newline on exit so zsh stops showing its `%` partial-line marker after Ctrl-C tears down the TUI.
- `cx setup` truncates long patch descriptions to fit the terminal width and removes stray newlines so the scroll region and `↑ more` / `↓ more` indicators stay accurate.

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
