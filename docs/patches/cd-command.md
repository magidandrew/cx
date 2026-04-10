# /cd Command

> `/cd <path>` changes where bash commands run, without losing your conversation.

**ID** `cd-command` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/cd-command.ts)

## What it does

Adds a `/cd` slash command. Type `/cd some/other/dir` and the session's working directory switches — the same way a shell `cd` works — so subsequent bash tool calls resolve relative paths against the new location. Project settings and conversation state are untouched.

Without an argument, `/cd` prints the current working directory. Leading `~` expands to `$HOME`.

## Why

The only way to move a Claude Code session to a different directory is to quit and relaunch, which drops your conversation. Tracked upstream at [anthropics/claude-code#3473](https://github.com/anthropics/claude-code/issues/3473) (54 reactions at time of writing).

## Usage

```
/cd                        # print current directory
/cd src                    # relative path
/cd ~/Developer/other      # absolute with ~ expansion
```

## How it works

Two bundled helpers do the real work: `setCwd` (validates the path, resolves symlinks, updates internal state, fires a `tengu_shell_set_cwd` analytics event) and `getCwdState` (returns the current cwd). The patch resolves their minified names by:

- finding the sync `FunctionDeclaration` that contains `"tengu_shell_set_cwd"` for `setCwd`, and
- finding the `Property` whose key is literally `getCwdState` and whose value is a zero-parameter arrow function for `getCwdState`.

It then finds the `COMMANDS` array by starting from the built-in `compact` command's definition, tracing its assignment and re-export, and looking for the large `ArrayExpression` (20+ elements) that contains that re-exported identifier.

Finally, the patch appends a new `LocalCommand` object to the array. Its `call` function trims the input, handles the no-argument and `~` cases, and calls `setCwd(path)` inside a try/catch so a bad path returns an error message instead of crashing.
