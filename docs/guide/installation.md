# Installation

```sh
npm install -g claude-code-extensions
```

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed globally:

```sh
npm i -g @anthropic-ai/claude-code
```

## Quick start

```sh
cx          # launch patched Claude Code
cx-setup    # interactive TUI to toggle patches on/off
```

On first run, `cx` opens the setup TUI automatically. After that, just run `cx` — it caches the patched bundle and only re-transforms when patches change or Claude Code updates.

All `claude` arguments pass through untouched:

```sh
cx --model sonnet -p "hello"
```

works exactly like:

```sh
claude --model sonnet -p "hello"
```

## Hot reload

While Claude is running, type:

```
! cx reload
```

or press `Ctrl+X Ctrl+R`. The session restarts with fresh patches applied and your conversation resumes via `--continue`.
