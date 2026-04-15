---
title: "Disable Telemetry"
description: "Strip Datadog and first-party analytics calls from the bundle."
---
# Disable Telemetry

> Strip Datadog and first-party analytics calls from the bundle.

**ID** `disable-telemetry` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/disable-telemetry.ts)

## What it does

Stops both outbound analytics paths in a running Claude Code:

- The Datadog log exporter (`https://http-intake.logs.us5.datadoghq.com/...`) never flushes, and its endpoint URL is blanked as an extra safeguard.
- The first-party event logger (OpenTelemetry exporter tagged `com.anthropic.claude_code.events`) never initializes, which also stops retries of previously-queued events.

Nothing gets sent over the wire. If analytics events are produced internally, they just sit in a queue that never drains.

## How it works

Three surgical cuts:

1. **Kill the analytics sink.** `initializeAnalyticsSink()` calls `attachAnalyticsSink({ logEvent, logEventAsync })`. The patch finds that call by looking for a `CallExpression` whose sole argument is an object literal containing both `logEvent` and `logEventAsync` keys, then rewrites it to `void 0`. With no sink attached, `logEvent()` just pushes to an internal queue that nothing drains.
2. **Noop the Datadog flush.** `flushLogs()` is identified by containing the `"DD-API-KEY"` header string. The patch picks the smallest zero-parameter function that contains the string (there's a module wrapper around it) and inserts `return;` at the top of its body. It also replaces the Datadog endpoint literal with `""` as belt-and-braces.
3. **Noop the 1P init.** `initialize1PEventLogging()` is identified by the instrumentation-scope string `"com.anthropic.claude_code.events"`. Same treatment — smallest zero-parameter container, early return at the top.
