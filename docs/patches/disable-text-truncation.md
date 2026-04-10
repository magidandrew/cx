# Disable Long-Text Truncation

> Show long input inline instead of collapsing into `[...Truncated text #N +X lines...]`.

**ID** `disable-text-truncation` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/disable-text-truncation.ts)

## What it does

Prompt content longer than about 10,000 characters stays visible in the input. Without the patch, long content gets replaced with a `[...Truncated text #N +X lines...]` placeholder even if you typed it yourself.

This is a different mechanism from [`disable-paste-collapse`](./disable-paste-collapse). That patch turns off the "Pasted text #N" collapse that runs on each paste event. This one turns off the length-based truncation that runs in a React effect against the current input value, regardless of how the text got there.

## How it works

`useMaybeTruncateInput` runs a `useEffect` whose callback destructures `{ newInput, newPastedContents }` from a call to `maybeTruncateInput` whenever input length crosses the limit. The property name `newPastedContents` only appears as an `ObjectPattern` inside that one callback, so the patch uses it as a unique anchor: find the `ObjectPattern`, walk up to the enclosing arrow function, and inject `return;` as the first statement of its body. The effect still runs but returns early before doing any work.
