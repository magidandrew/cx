---
title: "Swap Enter / Meta+Enter"
description: "Enter inserts a newline, Option/Alt+Enter submits."
---
# Swap Enter / Meta+Enter

> Enter inserts a newline, Option/Alt+Enter submits.

**ID** `swap-enter-submit` · **Default** off · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/swap-enter-submit.ts)

## What it does

Flips the default behavior of the Enter key. Pressing Enter inserts a newline into the prompt. Submitting takes a deliberate `Option+Enter` (macOS) or `Alt+Enter` (Linux/Windows). `Shift+Enter` still inserts a newline too, for terminals that speak CSI u.

## Why

CJK users, SSH users, and anyone with Slack-style muscle memory constantly submit half-written prompts by accident. This patch makes Enter safe and submission intentional. Tracked upstream at [anthropics/claude-code#2054](https://github.com/anthropics/claude-code/issues/2054) (72 reactions at time of writing).

## Usage

After enabling the patch:

- `Enter` — inserts a newline
- `Option+Enter` (mac) / `Alt+Enter` (linux/win) — submits
- `Shift+Enter` — inserts a newline (where terminals distinguish it)
- `\⏎` (backslash + return) — still inserts a newline

## How it works

Keybinding changes alone aren't enough for this one. The Enter key's submit behavior is hard-coded inside `useTextInput.ts`'s `handleEnter` function, which calls `onSubmit()` directly for plain Enter and `cursor.insert('\n')` for Meta/Shift+Enter — it bypasses the keybinding system entirely.

The patch modifies three layers:

1. **`DEFAULT_BINDINGS`** — rewrites `enter: "chat:submit"` to `enter: "chat:newline"` and adds `"meta+enter": "chat:submit"` so the help menu and shortcut hints match reality.
2. **`handleEnter`** — found by looking for the smallest function containing the literal `"Apple_Terminal"`, a `cursor.insert('\n')` call, and a `key.meta || key.shift` logical expression. Inside that function, the patch rewrites the `meta || shift` branch so `meta` submits and `shift` stays as a newline, removes the Apple Terminal fallback branch, and replaces the trailing `onSubmit(...)` with `return cursor` so plain Enter becomes a no-op at this layer. Plain Enter then flows through the keybinding system to `chat:newline`.
3. **Tip/help text** — rewrites the `"Press Shift+Enter to send a multi-line message"` hint and the `shift + ⏎ for newline` / `\⏎ for newline` help-menu strings so instructions match the new behavior.

Meta+Enter is the only modifier combination that works reliably across all terminals because it sends `ESC + CR` as a distinct byte sequence. Ctrl+Enter and Shift+Enter both collapse to the same byte as plain Enter in most terminals.
