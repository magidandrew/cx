# Anthropic Status Banner

> Warn in the footer when status.claude.com reports issues affecting Claude Code.

**ID** `anthropic-status-banner` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/anthropic-status-banner.ts)

## What it does

Adds a one-line yellow warning to the prompt footer whenever Anthropic's status page reports a problem with Claude Code or the Claude API. The banner sits directly under the `⏵⏵ bypass permissions on` row on the left side of the footer, so it doesn't fight with the context usage indicator on the right. When everything is green, the banner is not rendered at all.

The text is wrapped in an OSC 8 hyperlink pointing at `status.claude.com`, so Cmd+click opens the status page in terminals that support it — the same mechanism Claude Code already uses for PR URLs. The banner is sticky: it stays up until the next poll sees a clean status.

## Why

The usual way to find out Claude Code is having an incident is to watch a request hang, try again, hang again, and eventually check Twitter or the status page manually. Having the status page poll itself right in the footer turns "is it me or them?" into a glance.

## Usage

Automatic — the banner polls `https://status.claude.com/api/v2/summary.json` once a minute and renders itself whenever a Claude-Code-relevant component is degraded or an incident targets one.

For layout testing without waiting for a real incident, set `CX_STATUS_FORCE=1` (or any string — it's used as the banner label) before launching cx. The banner will render a fake "Test: …" line until you unset the variable.

## How it works

The footer is minified into two adjacent functions: an outer `PromptInputFooterLeftSide` wrapper and an inner core that actually renders the `? for shortcuts` row. The patch chains through them — it anchors on the unique `"? for shortcuts"` literal to find the inner function, finds the sole `createElement(Inner, …)` site to identify the outer wrapper, then finds the sole `createElement(Outer, …)` site. That last call sits directly inside the left column `Box` (verified by asserting `flexDirection: "column"` on the parent), which gives it references to React, `Box`, and `Text` in the right scope.

Because the bundler creates parallel React bindings in that scope — one used only for `createElement`, another used for hooks — the patch also grabs a hooks namespace by finding any `*.useMemo` / `*.useState` / `*.useEffect` member expression inside the footer function. Using the wrong binding would make `useState` come back undefined at runtime.

Then it appends a hoisted `_cxStatusBanner` function declaration at module end that owns the polling, state, React hooks, and OSC 8 hyperlink wrapping, and inserts `createElement(_cxStatusBanner, {R, H, Box, Text})` as the next argument-child of the column `Box` — so it renders as the sibling right below the bypass-permissions row. Self-initialization via `globalThis` makes sure re-mounts don't spawn duplicate poll intervals, and the interval is `unref`'d so it doesn't keep the process alive.
