# Always Show Context

> Always display context usage as a percentage, not just when you're about to hit the limit.

**ID** `always-show-context` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/always-show-context.ts)

## What it does

Shows a dim "X% context used" line in the footer on every turn. Without the patch, Claude Code only renders its `TokenWarning` component when you're within 20,000 tokens of the threshold — which on a 1M context window is about 98% full. Far too late to do anything useful.

The indicator renders neutrally when context is low, then escalates to warning and error colors as it fills up.

## Why

The default behavior means you can't tell how much room you have until there's no room left. Tracked upstream at [anthropics/claude-code#18456](https://github.com/anthropics/claude-code/issues/18456) (51 reactions at time of writing).

## How it works

The patch finds `TokenWarning` via its unique `"Context low"` string, then makes four edits inside the function:

1. Removes the `!isAboveWarningThreshold` half of the early-return gate so the component renders on every turn.
2. Softens the color from `"warning"` to `void 0` (default) when the threshold hasn't been crossed, so the always-on indicator doesn't scream yellow at you.
3. Rewrites the `"Context low"` label to just `"Context"` for the always-on state.
4. Replaces the auto-compact template `` `${X}% until auto-compact` `` with `` `${100-X}% context used` `` so the number reads as used rather than remaining.

If you enable `session-usage` instead, that patch takes over the same spot and shows session utilization alongside context.
