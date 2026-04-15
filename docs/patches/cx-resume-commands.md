---
title: "cx Resume Commands"
description: "Rewrite resume/continue command hints so they point at `cx` instead of bare `claude`."
---
# cx Resume Commands

> Rewrite resume/continue command hints so they point at `cx` instead of bare `claude`.

**ID** `cx-resume-commands` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/cx-resume-commands.ts)

## What it does

When Claude Code prints a hint like `"Run claude --continue to pick up where you left off"`, the text is rewritten to say `cx --continue`. Same for `claude --resume` and `claude -p --resume`. If you copy-paste the suggestion, you get the cx wrapper instead of the unpatched binary.

## How it works

This is the simplest kind of string-rewrite patch. It walks every string `Literal` and every `TemplateElement` in the AST and runs a fixed list of substring replacements against each:

- `claude --continue` → `cx --continue`
- `claude --resume` → `cx --resume`
- `claude -p --resume` → `cx -p --resume`

Matches are replaced in-place with `editor.replaceRange`. There's no attempt to understand minified variable names because the command snippets are stable verbatim strings regardless of how the surrounding code is packaged. The patch asserts it made at least four rewrites so a future bundle reshuffle that drops the strings fails loudly.
