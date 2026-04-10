# Random Clawd Color

> Picks a random color for the Clawd mascot on each startup.

**ID** `random-clawd` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/random-clawd.ts)

## What it does

Clawd — the little ASCII mascot at the top of a fresh Claude Code session — shows up in a different color every launch. Pure cosmetics. No functional change.

## How it works

The patch finds Clawd's component function by looking for one that contains both the string `"clawd_body"` and the literal feet characters `"▘▘ ▝▝"` — that combination is unique. It picks a random hex color from a hardcoded palette of 20, injects a `var __rc = palette[Math.floor(Math.random() * 20)];` right before the function declaration, and replaces every `"clawd_body"` literal inside the function with the `__rc` identifier. The color is rerolled on each process start because the `var` initializer runs once per launch.
