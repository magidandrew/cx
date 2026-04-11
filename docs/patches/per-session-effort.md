# Per-Session Effort

> Stop settings-file effort changes from clobbering other running sessions.

**ID** `per-session-effort` · **Default** on · **Compatible** `>=2.1.97` · `<2.1.97` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/per-session-effort.ts)

## What it does

Changes you make to effort in one `cx` window stop leaking into every other `cx` window. If you're running a low-effort explore in one terminal and a max-effort heavy refactor in another, both keep their own state. New sessions still pick up the latest value from `settings.json`, so last-write-wins on disk.

## Why

Claude Code writes `effortLevel` to `settings.json` whenever you run `/effort` or pick an effort in `/model`. Every other running session has a chokidar watcher on that file, so the write propagates into their in-memory `effortValue` — silently clobbering whatever they were set to. Setting effort in one terminal retroactively rewrites every other open terminal's effort.

The fix should be: writes go to disk so the *next* launch picks them up, but they don't stomp on live state in other running instances.

## How it works

Claude Code's `applySettingsChange` is the single function that propagates a settings-file update into an in-memory app state. It has exactly one branch that copies the new effort value into `effortValue`, and that's the branch we neutralize. The shared idea in both variants below: find the single-key `{ effortValue: X }` object in that branch and replace it with an empty object, so the surrounding spread contributes nothing. `settings.effortLevel` still updates locally (keeping the on-disk and in-memory settings object in sync), but the top-level `effortValue` is never overwritten from the watcher.

Local `/effort` and ModelPicker submits are unaffected — both call `setAppState(prev => ({ ...prev, effortValue }))` directly, not through `applySettingsChange`.

### Two variants, one semantic fix

The patch declares two variants because the minifier emits different AST shapes for the same source logic in different Claude Code versions:

| Variant | Range | AST | Finder |
| --- | --- | --- | --- |
| **New** | `>=2.1.97` | `...cond && { effortValue: w }` | `LogicalExpression` with `operator === '&&'` and a single-property `{ effortValue }` right operand |
| **Old** | `<2.1.97` | `...(cond ? { effortValue: X } : {})` | `ConditionalExpression` with a single-property `{ effortValue }` consequent and empty-object alternate |

Both variants call `editor.replaceRange(target.start, target.end, '{}')` on the matched object literal. For the `&&` form, `cond && {}` evaluates to `{}` when the condition is truthy and to the falsy `cond` otherwise — object spread of either contributes zero keys. For the ternary form, `cond ? {} : {}` obviously spreads nothing. Both results are identical at runtime: effort changes from disk no longer touch the live `effortValue`.

The transform picks the variant by consulting the `version` on the patch context, which `cx` reads from the `package.json` sitting next to the installed `cli.js`. See [Per-version variants](/guide/how-it-works#per-version-variants) for the selection mechanism.
