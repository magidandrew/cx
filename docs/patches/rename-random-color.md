---
title: "Random Color on /rename"
description: "Randomize the prompt-bar color each time you run /rename."
---
# Random Color on /rename

> Randomize the prompt-bar color each time you run /rename.

**ID** `rename-random-color` · **Default** off · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/rename-random-color.ts)

## What it does

Every time you run `/rename` (with or without an argument), the session's prompt-bar color is rerolled to a random pick from the eight built-in agent colors: red, blue, green, yellow, purple, orange, pink, cyan.

It's a small cosmetic hook on top of an action you already take when a session starts to feel like a different project. Rename the session, get a new color as a visual marker — no extra keystrokes.

The change is session-scoped. Closing and reopening the session brings back whatever color was last saved via `/color`, so if you find a color you like you can lock it in explicitly.

## Usage

Automatic whenever `/rename` runs. No configuration, no keybinding. If you want the old behavior back, disable the patch in `cx setup`.

## How it works

The patch locates rename's `call` function by searching for a unique string literal it emits on the teammate-block early return (`"Cannot rename: This session is a swarm teammate..."`). That wording appears nowhere else in the bundle and is a plain string rather than a template literal, so it survives minification verbatim and anchors the search unambiguously.

From there it finds the `ObjectExpression` passed to `setAppState`'s functional updater — specifically the inner object under the `standaloneAgentContext` key that also carries a `name` property. Both keys are preserved through bundling because the state reducer reads them by name. A `var __cxC = [...][Math.floor(Math.random() * 8)]` declaration is injected at the top of the `call` function body, and `,color:__cxC` is spliced in right after the existing `name` property. Because the injected property sits after the `...prev.standaloneAgentContext` spread, the random color wins over whatever was previously in state.

Persistence across restarts is deliberately skipped — the rename already updates `standaloneAgentContext` in-place via `setAppState`, and that's enough for an immediate visual change. If you want the color to stick, run `/color <name>` afterward.
