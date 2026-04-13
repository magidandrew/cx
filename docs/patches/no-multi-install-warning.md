# No Multi-Install Warning

> Suppress "Multiple installations found" nag in update/doctor.

**ID** `no-multi-install-warning` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/no-multi-install-warning.ts)

## What it does

Hides the "Warning: Multiple installations found" message that appears during `claude update` and `claude doctor` when both an npm and a native installation are detected on the same machine. Since cx requires the npm bundle alongside whatever native install you use, this warning is always a false positive — there's nothing to fix.

## Why

cx deliberately keeps the npm package around for its AST patching pipeline. The native installer doesn't know that, so `claude doctor` and `claude update` both flag the "dual install" as a problem. The warning is harmless but annoying — it shows up every time and there's no built-in way to silence it.

## How it works

The warning text `"Multiple installations found"` appears inside two `IfStatement` nodes in the bundle: one in the `update()` codepath and one in the `Doctor.tsx` component. The patch walks the AST looking for every `IfStatement` whose source contains that marker string, sorts by size to prefer the tightest match, and replaces each unique occurrence with an empty string — effectively removing both the update warning and the doctor warning in one pass. Already-patched ranges are tracked so nested if-statements don't get double-patched.
