---
title: "NSFW Spinner"
description: "Replace the rotating spinner verbs with a list of NSFW verbs."
---
# NSFW Spinner

> Replace the rotating spinner verbs with a list of NSFW verbs.

**ID** `nsfw-spinner` · **Default** off · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/nsfw-spinner.ts)

> Tagged `[nsfw]` in `cx setup`. Off by default. Do not enable this on a work machine, in a screen share, or anywhere you would be embarrassed to see the spinner read aloud.

## What it does

Instead of rotating through the neutral active verbs ("Thinking", "Analyzing", "Pondering", …) while Claude is working, the spinner cycles through a list of forty NSFW `-ing` verbs. The animation — the dots — still runs; only the text changes. Turn-completion verbs (`Baked`, `Brewed`, `Cooked`, …) are left alone, so the end-of-turn text stays work-safe.

Conflicts with [`simple-spinner`](./simple-spinner) since both patches rewrite the same `SPINNER_VERBS` array. `cx setup` draws a connector glyph between the two rows and auto-disables the other side when you toggle one on.

## How it works

The bundle keeps the active-spinner text in a plain `ArrayExpression` that starts with `"Accomplishing", "Actioning", …`. The patch finds it with `findArrayWithConsecutiveStrings(ast, "Accomplishing", "Actioning")` and replaces the whole node with a JSON-stringified array of NSFW verbs. The render path picks a verb by index and animates through them — same mechanism as before, just a different word list.

The matching past-tense `TURN_COMPLETION_VERBS` array is deliberately not touched, which is why finished turns still read like a normal cookbook.
