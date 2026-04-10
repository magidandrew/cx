# Ctrl+Q Message Queue

> Queue messages with Ctrl+Q so they run one-by-one after the current turn finishes.

**ID** `queue` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/queue.ts)

## What it does

Adds a real message queue to the prompt input. While Claude is working, type your next instruction and press `Ctrl+Q`. The message disappears from the input and waits. When the current turn completes, the first queued message is injected as a user turn. If you queue several, they fire FIFO, one per turn.

This is different from the default behavior. Pressing Enter during a turn *steers* the current response — your message becomes extra context for what Claude is already doing. Queueing is for things you want Claude to do *next*, as a separate turn.

## Why

Without this, there's no way to line up follow-up work without interrupting the current turn. You either wait and type later, or you send a steering message that changes the response you were actually waiting for.

## Usage

Press `Ctrl+Q` instead of Enter to queue. Queued items run in FIFO order after the active turn finishes — one per turn.

## How it works

The patch finds `KEYBINDING_ACTIONS` and `DEFAULT_BINDINGS` in the bundle (both identified by the stable literal `"chat:submit"`) and registers a new `chat:queue` action bound to `Ctrl+Q`. It then walks into `PromptInput` and injects a `useCallback` handler that calls the existing `enqueue` function with `priority: "later"` instead of `"next"`.

The trickier part is `processQueueIfReady`. It's the function that drains the queue between turns, but it fast-paths bash-mode items so they don't clobber a pending conversation. The patch widens that fast-path test to also allow `priority === "later"`, and adds a priority filter to the `dequeueAllMatching` callback so bash-mode queueing still works alongside the new later-queue.

Nothing is hard-coded against minified names. Variable names like `setCursorOffset`, `trackAndSetInput`, `clearBuffer`, and `enqueue` are rediscovered each run by pattern-matching on React hook shapes and destructured prop keys.
