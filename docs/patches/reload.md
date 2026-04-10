# Ctrl+X Ctrl+R Reload

> Reload the cx session with a keystroke. Re-applies patches and keeps the conversation.

**ID** `reload` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/reload.ts)

## What it does

Press `Ctrl+X Ctrl+R` and the current Claude Code process exits with code 75. The `cx` wrapper catches that exit code and respawns `claude --continue`, so your conversation resumes from exactly where it was — but against a freshly-patched bundle.

This is the loop you want while authoring or toggling patches. Edit a patch, hit `Ctrl+X Ctrl+R`, and the change takes effect without losing context.

## Usage

`Ctrl+X Ctrl+R` inside any running cx session.

## How it works

Like the other keybinding patches, this one registers a new `chat:reload` action in `KEYBINDING_ACTIONS` (found via the `"chat:submit"` literal) and binds `Ctrl+X Ctrl+R` to it in `DEFAULT_BINDINGS`. The handler is a `useCallback` with an empty deps array that just calls `process.exit(75)`. The action is added to the memoized `chatHandlers` object under the `"chat:reload"` key.

The second half of the loop — catching exit code 75 and respawning — lives in `src/cli.ts`, not in this patch.
