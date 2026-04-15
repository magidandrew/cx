---
title: "No Feedback Prompts"
description: "Remove every feedback survey prompt Claude Code can show you."
---
# No Feedback Prompts

> Remove every feedback survey prompt Claude Code can show you.

**ID** `no-feedback` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/no-feedback.ts)

## What it does

Hides session rating prompts ("How is Claude doing this session?"), post-compact surveys, memory surveys, transcript share prompts, and frustration-detection prompts. All of them.

## How it works

Everything those prompts render comes from a single React component called `FeedbackSurvey`. The patch finds it by searching for the unique string `" Thanks for sharing your transcript!"` (with the leading space, which disambiguates it from any other occurrence), picks the smallest enclosing function — the component itself, not a wrapper — and inserts `return null;` as the first statement of its body. The component still mounts but immediately returns nothing.
