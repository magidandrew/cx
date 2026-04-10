# No Attribution

> Strip Claude Code attribution from commits and PRs.

**ID** `no-attribution` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/no-attribution.ts)

## What it does

Commits Claude generates no longer carry a `Co-Authored-By: <model> <noreply@anthropic.com>` trailer. PR descriptions drop the `Generated with Claude Code` line and the newer enhanced `X% N-shotted by …` variant. Git history and PR bodies look like you wrote them yourself, because as far as the reader is concerned you did.

## How it works

Two functions produce the attribution strings: `getAttributionTexts()` (commit + PR defaults) and `getEnhancedPRAttribution()` (the longer PR variant). The patch finds the first by searching for the template element containing `"noreply@anthropic.com"` and walking up to the enclosing function, then inserts `return { commit: "", pr: "" };` as the first statement of the body. It finds the second by its debug string `"PR Attribution: returning default (no data)"` and inserts `return "";` at the top. The prompt templates that consume these functions already handle empty strings gracefully via ternary guards.
