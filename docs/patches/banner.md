---
title: "Attribution Banner"
description: "Replace the \"Claude Code\" title line with cx's own name + an `@wormcoffee` link."
---
# Attribution Banner

> Replace the "Claude Code" title line with cx's own name + an `@wormcoffee` link.

**ID** `banner` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/banner.ts)

## What it does

The title line on startup reads `Claude Code Extensions (cx) v<version> by x.com/@wormcoffee` (the handle is an OSC 8 terminal hyperlink, so modern terminals render it as a clickable link to `https://x.com/@wormcoffee`). A dim "please star the repo" line shows up below the title on the same startup splash.

Works against both the condensed and the newer boxed startup layouts.

## How it works

Claude Code has two startup layouts in the bundle. The patch edits both:

1. **Condensed layout.** Finds every `"Claude Code"` literal via the string index, walks up to a `createElement` call whose props object has `bold: true`, and swaps the literal for the new title. Then it locates the enclosing column `Box` (by looking for `flexDirection: "column"` in its props) and inserts a dim `Text` element as the child right after the title.
2. **Boxed layout.** Finds the container by looking for a property object with both `borderColor: "claude"` and a `borderText` key, then injects the dim text after the last child of that box. It also handles the separate `b7("claude", o)("Claude Code")` title call that the newer layout uses by rewriting the `"Claude Code"` argument there.

The hyperlink is encoded as an OSC 8 escape sequence: `ESC ] 8 ; ; URL BEL TEXT ESC ] 8 ; ; BEL`. The escape characters are written as `\u001B` / `\u0007` in the injected JavaScript so they survive through acorn's string handling into the actual bytes at runtime.
