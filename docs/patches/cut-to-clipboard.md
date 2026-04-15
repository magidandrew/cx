---
title: "Cut prompt to clipboard (Alt+X)"
description: "`Option/Alt+X` copies the current prompt text to the system clipboard and clears the input."
---
# Cut prompt to clipboard (Alt+X)

> `Option/Alt+X` copies the current prompt text to the system clipboard and clears the input.

**ID** `cut-to-clipboard` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/cut-to-clipboard.ts)

## What it does

Press `Option+X` (macOS) or `Alt+X` (Linux/Windows) and whatever is currently in the prompt box is copied to your system clipboard, and then the input is cleared. Useful when you've typed out a prompt, realized you want to come back to it from somewhere else, or want to stash a draft without submitting it. A "cut to clipboard" notification flashes briefly so you know it worked.

`Ctrl+X` isn't used because it's already a chord prefix in Claude Code (`Ctrl+X Ctrl+E` opens the external editor, `Ctrl+X Ctrl+K` kills subagents, plus cx's own `Ctrl+X Ctrl+R` reload). Alt+X avoids that collision.

## Usage

`Option+X` / `Alt+X` while the prompt box has focus. The input clears, and the text is on your system clipboard.

## How it works

The patch registers a new `chat:cut` action in `KEYBINDING_ACTIONS` and binds `alt+x` to it in `DEFAULT_BINDINGS`, the same way the queue and reload patches register their own actions.

For the handler, it reuses the bundle's existing `setClipboard` helper (identified by being an async function containing a `52;c;` OSC 52 template literal and a `.toString("base64")` call). It also walks `PromptInput` to find the minified name of `addNotification` (via its destructured prop key) and the current `chat:clearInput` handler. The injected callback reads the current input, writes it to the clipboard via `setClipboard`, fires the toast notification, and calls the clear-input handler. All of that goes into the `chatHandlers` memoized object under the `"chat:cut"` key.
