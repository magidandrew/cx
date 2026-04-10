# Patches

Every cx patch is a pure AST transform against the Claude Code bundle. Patches are opt-in and toggleable via `cx-setup`. The table below lists all available patches, their default state, and which versions of `@anthropic-ai/claude-code` they're known to work against.

> The **Compatible** column tracks the range of Claude Code bundle versions the patch has been verified against. `*` means the patch has no known version constraints.

## All patches

| Patch | Name | Description | Default | Compatible |
| --- | --- | --- | :---: | --- |
| `queue` | Ctrl+Q Message Queue | Queue messages with `Ctrl+Q` to run sequentially after the current turn | on | `*` |
| `always-show-thinking` | Always Show Thinking | Show thinking block content inline instead of collapsed | on | `*` |
| `always-show-context` | Always Show Context | Always display context usage percentage, not just when near the limit | on | `*` |
| `show-file-in-collapsed-read` | Show File in Collapsed Read | Show file paths and search patterns in collapsed tool display | on | `*` |
| `disable-paste-collapse` | Disable Paste Collapse | Show pasted text inline instead of collapsing into `[Pasted text #N]` | on | `*` |
| `persist-max-effort` | Persist Max Effort | Save "max" effort to settings so it survives restarts | on | `*` |
| `reload` | Ctrl+X Ctrl+R Reload | Reload the cx session — re-applies patches and keeps the conversation | on | `*` |
| `no-tips` | No Tips | Hide spinner tips | on | `*` |
| `no-feedback` | No Feedback Prompts | Remove feedback survey prompts | on | `*` |
| `no-npm-warning` | No NPM Warning | Suppress the "switched from npm to native installer" nag | on | `*` |
| `no-attribution` | No Attribution | Strip Claude Code attribution from commits and PRs | on | `*` |
| `disable-telemetry` | Disable Telemetry | Strip Datadog and 1P analytics calls | on | `*` |
| `random-clawd` | Random Clawd Color | Randomize the Clawd mascot color on each startup | on | `*` |
| `cx-badge` | CX Badge | Show a persistent "cx" indicator in the prompt footer | on | `*` |
| `cx-resume-commands` | cx Resume Commands | Show `cx` instead of `claude` in resume/continue command hints | on | `*` |
| `cd-command` | /cd Command | `/cd <path>` — change where bash commands run (same as shell `cd`, keeps project settings) | on | `*` |
| `banner` | Attribution Banner | Show "@wormcoffee" on the Claude Code title line | on | `*` |
| `swap-enter-submit` | Swap Enter / Meta+Enter | Enter inserts a newline, Option/Alt+Enter submits | off | `*` |
| `simple-spinner` | Simple Spinner | Replace spinner verb cycling with static "working" / "worked" | off | `*` |

## Toggling patches

Run the interactive TUI to toggle any patch on or off:

```sh
cx-setup
```

Your selection is persisted and applied on the next `cx` launch. To re-apply without restarting, press `Ctrl+X Ctrl+R` inside a running session (the `reload` patch).
