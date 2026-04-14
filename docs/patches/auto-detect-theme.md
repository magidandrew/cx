# Auto-Detect Terminal Theme

> Default to "auto" theme on first run so Claude matches your terminal background.

**ID** `auto-detect-theme` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/auto-detect-theme.ts)

## What it does

Claude Code ships with `theme: 'dark'` as the hardcoded first-run default, and the `/theme auto` option silently falls back to dark on most terminals because the OSC 11 watcher is gated behind a feature flag that's stripped from the public build. You end up with dark mode on a light-terminal system unless you know to dig into `/theme`.

This patch fixes both halves of the problem. New installs start on `auto`, so the TUI matches your terminal's background from the first render. Existing users who had `theme: 'dark'` stuck in their config from the old default get treated as if they'd picked `auto` — the bundle's theme reader rewrites `'dark'` to `'auto'` at read time without touching your settings file. If you actually want dark, disable the patch (`cx-setup`) and your saved value wins again. `light`, `light-daltonized`, and `dark-daltonized` pass through untouched because those are explicit choices nobody picks by default.

cx also probes your terminal over OSC 11 before spawning Claude and writes the answer into `COLORFGBG`, so the bundled synchronous detector picks it up on terminals that don't export the env var themselves (Ghostty, stock Terminal.app, Alacritty). The probe runs on a fresh `/dev/tty` fd with a 150ms timeout; terminals that don't answer cost nothing.

## Why

Filed as [anthropics/claude-code#2990](https://github.com/anthropics/claude-code/issues/2990) — "Automatic light/dark theme selection?" — with 450+ thumbs-up at time of writing. The infrastructure to do this is already in the bundle (`ThemeSetting` includes `'auto'`, `resolveThemeSetting` and `getSystemThemeName` are wired up, `$COLORFGBG` is honored). Only the defaults and the OSC path were missing.

## How it works

Three coordinated edits. The first two live in the AST transform:

1. The default-config factory — identified by its distinctive `numStartups: 0` sibling property — swaps `theme: 'dark'` for `theme: 'auto'` so the very first save carries the new default.
2. `defaultInitialTheme()` in the bundle's `ThemeProvider` (a zero-arg function whose entire body is `return X().theme`) gets its return value rewritten: `let _cxT = X().theme; return _cxT === "dark" ? "auto" : _cxT`. That's the single chokepoint where saved config flows into the React tree, so rewriting there propagates to the preview picker, the watcher, and the terminal tab title without touching anywhere else.

The third piece is the runtime probe in `src/term-bg.ts`. Before cx spawns Claude, it opens `/dev/tty` directly, snapshots `stty -g`, switches to raw mode with `VMIN=0 VTIME=1`, writes `\x1b]11;?\x07`, and reads the `rgb:RRRR/GGGG/BBBB` response. Luminance over 0.5 means light; the result is encoded as a synthetic `COLORFGBG` value (`15;15` or `15;0`) and pushed into the child's env. Using a fresh fd instead of `process.stdin` matters — Node's stdin stream wrapper enters flowing mode on first `resume()` and will steal bytes from the child even after `.pause()`, which manifested as input lag in Claude's chat when the earlier version of this patch used the shared fd.
