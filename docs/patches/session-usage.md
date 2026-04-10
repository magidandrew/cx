# Session Usage

> Always show `25% session used · 15% context used` in the footer.

**ID** `session-usage` · **Default** off · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/session-usage.ts)

## What it does

Replaces the `TokenWarning` label with a combined indicator that renders every turn. The session percentage comes from the unified rate-limit headers (`five_hour.utilization`) that Claude Code already tracks per API call. The context percentage is whatever the bundle was going to show you when it was about to hit the wall.

When the five-hour session data isn't available yet (cold start, API keys without a Claude.ai subscription, anything else that skips rate-limit reporting), the prefix is omitted and you just see `X% context used`.

This patch supersedes [`always-show-context`](./always-show-context) — both patches edit the same TokenWarning template and will collide if enabled at the same time. cx auto-resolves the conflict by dropping `always-show-context` when you enable this one.

## How it works

The patch reuses most of the `always-show-context` surgery: find `TokenWarning` via `"Context low"`, drop the early-return threshold gate, soften the color to `void 0` below the warning threshold, rewrite `"Context low"` to `"Context"`.

The new piece is resolving the minified name of `getRawUtilization()` so the injected template can call it. That's done by chaining through the bundle:

1. Find the `ArrayExpression` `["five_hour", "5h"]` — it only appears inside `extractRawUtilization`.
2. Walk up to the enclosing function to get `extractRawUtilization`'s minified name.
3. Scan every `AssignmentExpression` for the form `X = extractRawUtilization(...)` to get the top-level `rawUtilization` variable name.
4. Scan every zero-parameter `FunctionDeclaration` whose body is `return rawUtilization` to get `getRawUtilization`'s minified name.

With that name in hand, the `` `${X}% until auto-compact` `` template gets replaced with one that reads `` `${getRawUtilization().five_hour ? Math.round(getRawUtilization().five_hour.utilization * 100) + "% session used · " : ""}${100-X}% context used` ``.
