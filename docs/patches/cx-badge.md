# CX Badge

> Show a persistent `cx` indicator in the prompt footer.

**ID** `cx-badge` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/cx-badge.ts)

## What it does

Adds a small inverse-orange `cx` tag to the left of the permission-mode text in the footer (next to things like "bypass permissions on" or "accept edits on"). When there's no mode active, the badge still renders so you can tell at a glance that the session is running under cx rather than bare claude.

## How it works

The patch locates `ModeIndicator` by walking up from its unique `"? for shortcuts"` string literal. Inside that function it finds the final outer `createElement` call — a `Box` with `height: 1` and `overflow: "hidden"` — and the separator call that renders `" · "` (which gives it the minified names for the `Box` and `Text` components, plus the React namespace).

From there it inserts a new first child into the outer Box: a nested Box with `flexShrink: 0` containing a Text with `inverse: true, color: "claude"` around the literal `"cx"`, followed by a space.
