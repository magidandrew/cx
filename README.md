<p align="center">
  <img src="docs/public/cx-logo.svg" alt="cx logo" width="140">
</p>

# cx — Claude Code Extensions

[![npm](https://img.shields.io/npm/v/claude-code-extensions)](https://www.npmjs.com/package/claude-code-extensions)
[![npm downloads](https://img.shields.io/npm/dm/claude-code-extensions)](https://www.npmjs.com/package/claude-code-extensions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/node/v/claude-code-extensions)](https://nodejs.org)

Modular, opt-in patches for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) applied at runtime via AST transformation. The original `claude` tool is never modified. `cx` parses the bundle, applies your selected patches, and spawns it. Everything else passes through untouched.

## Why cx?

Claude Code is great. But some things can't be configured with settings alone:

- **Real message queue** — Claude Code's default Enter steers mid-response, injecting your message into the current turn. `Ctrl+Q` instead buffers it as a true queued message that runs only after the current turn finishes.
- **Persistent max effort** — Claude resets effort level every session. cx saves "max" to settings so you don't have to `/model` it back every time.
- **See your pasted text** — Voice dictation and large pastes get collapsed into `[Pasted text #N]` which hides what you actually said. `cx` shows it inline so you can verify what was sent.
- **No attribution** — No more `Co-authored-by: Claude` in your commits and PRs.
- **Swap Enter / Option+Enter** — Enter inserts a newline, Option+Enter submits. Essential if you're on SSH, a non-English keyboard, or just prefer multiline-first input.
- **Context usage, always visible** — See how much context you've used at all times, not just when you're about to hit the wall.
- **Hot reload** — Change patches, tweak config, update Claude Code — press `Ctrl+X Ctrl+R` and the session restarts with fresh patches. Your conversation continues via `--continue`.
- **Auto theme** — First-run default is `auto` instead of dark, so Claude matches your terminal background out of the box. Flip to light at 9am and the TUI follows ([#2990](https://github.com/anthropics/claude-code/issues/2990)).
- **Quiet mode** — No spinner tips, no feedback surveys, or npm-to-native-installer nag.

19 patches total, 17 enabled by default. Toggle any combination on or off.

## Install

```sh
npm install -g claude-code-extensions
```

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed globally (`npm i -g @anthropic-ai/claude-code`).

## Quick start

```sh
cx          # launch patched Claude Code
cx-setup    # interactive TUI to toggle patches on/off
```

On first run, `cx` opens the setup TUI automatically. After that, just run `cx` — it caches the patched bundle and only re-transforms when patches change or Claude Code updates.

All `claude` arguments pass through: `cx --model sonnet -p "hello"` works exactly like `claude --model sonnet -p "hello"`.

## Patches

| Patch | Description | Default |
|---|---|:---:|
| `queue` | `Ctrl+Q` true message queue — buffer instructions to run after the current turn (vs. Enter, which steers mid-response) | on |
| `always-show-thinking` | Show thinking block content inline | on |
| `show-file-in-collapsed-read` | Show file paths in collapsed tool display | on |
| `disable-paste-collapse` | Show pasted text inline instead of collapsing | on |
| `persist-max-effort` | Save "max" effort to settings so it survives restarts | on |
| `reload` | `Ctrl+X Ctrl+R` hot reload — re-applies patches, keeps conversation | on |
| `no-tips` | Hide spinner tips | on |
| `no-feedback` | Remove feedback survey prompts | on |
| `no-npm-warning` | Suppress the npm-to-native-installer nag | on |
| `no-attribution` | Strip Claude Code attribution from commits and PRs | on |
| `disable-telemetry` | Strip Datadog and analytics calls | on |
| `random-clawd` | Randomize the Clawd mascot color on startup | on |
| `cx-badge` | Show a persistent "cx" indicator in the prompt footer | on |
| `cx-resume-commands` | Show `cx` instead of `claude` in resume hints | on |
| `cd-command` | `/cd <path>` — change working directory for bash commands | on |
| `auto-detect-theme` | Default theme to `auto` so it matches your terminal background on first run | on |
| `swap-enter-submit` | Enter inserts newline, Option+Enter submits | off |
| `simple-spinner` | Replace spinner verb cycling with static "working" | off |

## Hot reload

While Claude is running, type:

```
! cx reload
```

or press `Ctrl+X Ctrl+R`. The session restarts with fresh patches applied and your conversation resumes via `--continue`.

## How it works

1. `cx` locates your global `@anthropic-ai/claude-code/cli.js`
2. Parses the ~4MB minified bundle into an AST with [acorn](https://github.com/acornjs/acorn)
3. Each enabled patch finds its target via structural queries and splices in changes
4. The patched source is cached, so subsequent launches are instant
5. `cx` spawns Node on the cached bundle with your original arguments

Patches are pure AST transforms. They don't monkey-patch at runtime, don't wrap modules, and don't touch the original file on disk.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, patch authoring guide, and project structure.

## License

[MIT](https://opensource.org/licenses/MIT)
