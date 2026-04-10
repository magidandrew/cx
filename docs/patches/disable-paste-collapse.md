# Disable Paste Collapse

> Pasted text stays inline in the prompt instead of collapsing into `[Pasted text #N]`.

**ID** `disable-paste-collapse` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/disable-paste-collapse.ts)

## What it does

Every paste lands in the prompt as its full text, so you can read and edit it before submitting. No `[Pasted text #N +X lines]` placeholder.

## Why

Voice dictation and large pastes both go through the same collapse path. If you dictate a paragraph and it gets turned into `[Pasted text #1]`, you have no way to check what Claude is actually about to see. Tracked upstream at [anthropics/claude-code#23134](https://github.com/anthropics/claude-code/issues/23134) (77 reactions at time of writing).

See also [`disable-text-truncation`](./disable-text-truncation), which turns off the length-based collapse that fires on the current input regardless of where the text came from.

## How it works

The patch first locates `formatPastedTextRef` (the function that builds the `Pasted text #N` placeholder) by scanning for the literal `"Pasted text #"`. Then it finds the `IfStatement` in `onTextPaste` whose consequent calls that function — that's the collapse gate. Replacing the test expression with `false` routes every paste through the else branch, which inserts the text directly.
