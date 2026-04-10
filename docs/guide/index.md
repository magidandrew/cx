# What is cx?

`cx` is a thin wrapper around [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that applies modular, opt-in patches at runtime via AST transformation. The original `claude` binary is never modified — `cx` parses the bundle, applies your selected patches, caches the result, and spawns it. Everything else passes through untouched.

## Why cx?

Claude Code is great. But some things can't be configured with settings alone:

- **Message queue** — `Ctrl+Q` lets you steer Claude mid-response. Buffer your next instruction while it's still working — it gets injected as a user turn immediately.
- **Persistent max effort** — Claude resets effort level every session. cx saves "max" to settings so you don't have to `/model` it back every time.
- **See your pasted text** — Voice dictation and large pastes get collapsed into `[Pasted text #N]` which hides what you actually said. cx shows it inline so you can verify what was sent.
- **No attribution** — No more `Co-authored-by: Claude` in your commits and PRs.
- **Swap Enter / Option+Enter** — Enter inserts a newline, Option+Enter submits. Essential if you're on SSH, a non-English keyboard, or just prefer multiline-first input.
- **Context usage, always visible** — See how much context you've used at all times, not just when you're about to hit the wall.
- **Hot reload** — Change patches, tweak config, update Claude Code — press `Ctrl+X Ctrl+R` and the session restarts with fresh patches. Your conversation continues via `--continue`.
- **Quiet mode** — No spinner tips, no feedback surveys, no npm-to-native-installer nag.

See the [full patches list](/patches) for everything cx can do.
