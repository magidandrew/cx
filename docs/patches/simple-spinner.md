# Simple Spinner

> Replace the rotating spinner verbs with a static "working" / "worked".

**ID** `simple-spinner` · **Default** off · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/simple-spinner.ts)

## What it does

Instead of rotating through dozens of active verbs ("Thinking", "Analyzing", "Pondering", …) while Claude is working, the spinner just says "working". When a turn finishes, the completion verb is "worked" instead of "Baked", "Brewed", "Cooked", and the rest. The spinner animation — the dots — still runs. Only the text is flattened.

## How it works

Both verb lists are plain `ArrayExpression` nodes in the bundle. The patch uses `findArrayWithConsecutiveStrings` to identify them by the first two elements:

- `SPINNER_VERBS` starts with `"Accomplishing", "Actioning", …` → replaced with `["working"]`.
- `TURN_COMPLETION_VERBS` starts with `"Baked", "Brewed", …` → replaced with `["worked"]`.

Replacing the whole array with a one-element array means the rest of the render path — which picks a verb by index and animates through them — still works, it just always picks the same word.
