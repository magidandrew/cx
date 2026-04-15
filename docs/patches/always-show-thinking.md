---
title: "Always Show Thinking"
description: "Show thinking block content inline instead of collapsed behind \"∴ Thinking (ctrl+o to expand)\"."
---
# Always Show Thinking

> Show thinking block content inline instead of collapsed behind "∴ Thinking (ctrl+o to expand)".

**ID** `always-show-thinking` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/always-show-thinking.ts)

## What it does

Claude's thinking blocks render in full every turn, the way transcript mode and `--verbose` already show them. You never see the collapsed "∴ Thinking (ctrl+o to expand)" placeholder.

## Why

Claude Code hides thinking by default to save vertical space, but for anyone who actually reads what Claude is reasoning about, the collapse is pure friction — especially while debugging a prompt or a tool call. Tracked upstream at [anthropics/claude-code#8477](https://github.com/anthropics/claude-code/issues/8477) (195 reactions at time of writing).

## How it works

Inside `AssistantThinkingMessage`, the gate is:

```js
if (!(isTranscriptMode || verbose)) { return <collapsed view> }
```

The patch finds the function by searching for the `∴ Thinking` string (the "therefore" character, U+2234, is unique to this component), walks up to the enclosing function, finds the first `IfStatement` whose test is `!(X || Y)`, and replaces the test with `false`. The collapsed branch becomes dead code and the expanded render always runs.
