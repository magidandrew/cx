# No NPM Warning

> Suppress the "Claude Code has switched from npm to native installer" nag.

**ID** `no-npm-warning` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/no-npm-warning.ts)

## What it does

Stops the deprecation notification from appearing on every startup. If you install Claude Code from npm, this banner shows up on launch asking you to migrate to the native installer. cx does its work against the npm bundle by design, so the nag never goes away on its own.

## How it works

The warning is built by a function that returns an object with `key: "npm-deprecation-warning"`. That object literal is a unique anchor. The patch finds the `ReturnStatement` whose argument contains that key, and rewrites the whole return to `return null`. Downstream code already handles a null notification by rendering nothing.
