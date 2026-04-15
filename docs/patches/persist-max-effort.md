---
title: "Persist Max Effort"
description: "Save `\"max\"` effort to settings so it survives restarts."
---
# Persist Max Effort

> Save `"max"` effort to settings so it survives restarts.

**ID** `persist-max-effort` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/persist-max-effort.ts)

## What it does

Running `/effort max` sets your effort level for the rest of the session and also writes it to `settings.json` so the next `cx` launch starts with max effort already selected.

## Why

In the public build, `toPersistableEffort()` only accepts `"low"`, `"medium"`, and `"high"` — so even though `/effort max` takes effect for the current session, it never gets persisted. You have to `/effort max` again on every single launch. This patch restores the `"max"` check that was stripped.

## How it works

The patch searches for the unique three-way comparison chain `q === "low" || q === "medium" || q === "high"` (that exact shape only appears inside `toPersistableEffort`), then inserts `|| q === "max"` after the `"high"` literal. It also finds every `["low","medium","high"]` array in the bundle — the Zod schema and `EFFORT_LEVELS` both use one — and appends `,"max"` so settings validation doesn't silently drop a max value on read.

Composes with [`granular-effort`](./granular-effort): both patches edit the same effort enums but use zero-width inserts so they don't collide.
