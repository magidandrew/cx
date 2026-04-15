---
title: "Granular Effort Slider"
description: "Replace the `/model` effort picker with a 1-9 numeric slider."
---
# Granular Effort Slider

> Replace the `/model` effort picker with a 1-9 numeric slider.

**ID** `granular-effort` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/granular-effort.ts)

## What it does

Swaps the four-step low / medium / high / max effort picker in `/model` for a 1-9 scale. Cycle with `←` and `→`. Your exact chosen integer is what gets saved to `settings.json` and reloaded on the next launch — not a canonical low/medium/high mapping. The startup banner reads `with 4/9 effort` instead of `with medium effort`.

At the API boundary, the number is mapped to a conventional string so the upstream request still sees a valid effort level:

```
1-2 → low
3-5 → medium
6-7 → high
8-9 → max
```

5 is the default. 1 is minimal. 9 is max.

Composes with [`persist-max-effort`](./persist-max-effort) — both patches edit the same effort enums but use zero-width inserts that don't collide.

## Usage

Run `/model` and cycle with the arrow keys. The number shown in the picker is what gets saved and read back.

## How it works

Seven patch sites, each anchored by AST shape rather than minified names:

1. **`cycleEffortLevel`** — identified by containing a `ConditionalExpression` that picks between two effort arrays (`["low","medium","high","max"]` vs `["low","medium","high"]`). The patch prepends an early-return prelude that ignores the original body and cycles 1..9 directly. Using an early return rather than a wholesale replacement avoids conflicting with `persist-max-effort`, which inserts `,"max"` into the same arrays.
2. **`ModelPicker` display text** — found by locating the unique `" effort"` literal and walking to its parent `createElement` call. The patch swaps the `capitalize(e), " effort", (e === default ? " (default)" : "")` trio for a numeric expression + `"/9"` suffix.
3. **`convertEffortValueToLevel`** — the picker-init helper that the public build collapses to `"high"` for any number. Found by a one-parameter function containing a `typeof q === "string"` check and two `"high"` return literals. An early return is prepended so numbers pass straight through.
4. **`toPersistableEffort`** — identified by the unique `q === "low" || q === "medium" || q === "high"` logical chain. Prepend a numeric passthrough so raw integers get written to `settings.json`.
5. **Settings Zod schema** — the `h.enum(["low","medium","high"])` call is wrapped in `h.union([ ..., h.number().int() ])` so numeric values survive the schema's `.catch(void 0)` guard on read.
6. **API effort assignment** — the function containing the `"effort" in K` `BinaryExpression` (unique in the bundle) gets a prepended number-to-string mapper so the request body always receives a valid enum value.
7. **`getEffortSuffix`** — the `" with ${...} effort"` template literal whose expression is a `convertEffortValueToLevel` call (disambiguated from an unrelated template that wraps a `chalk.bold` call) is rewritten to render `${n}/9` instead of the string name.
