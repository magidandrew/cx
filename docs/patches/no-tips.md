---
title: "No Tips"
description: "Hide the `Tip: …` messages that appear in the spinner while Claude is working."
---
# No Tips

> Hide the `Tip: …` messages that appear in the spinner while Claude is working.

**ID** `no-tips` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/no-tips.ts)

## What it does

Claude Code normally rotates through little suggestions while it's thinking — "Use /clear to start fresh when switching topics" and the like. This patch hides them. The spinner still spins; it just doesn't advertise at you.

## How it works

The tip content is assigned to a local variable called `effectiveTip` inside the spinner component. That variable's initializer embeds the string `"Use /clear to start fresh when switching topics and free up context"`, which only appears in one place in the bundle. The patch looks up that literal via the string index, walks up to the enclosing `VariableDeclarator`, and replaces its initializer with `void 0`. The render path already handles an undefined tip by showing nothing.
