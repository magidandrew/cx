# docs/patches — formatting rules for per-patch reference pages

Every patch in `src/patches/` has a matching reference page in this directory, at `docs/patches/<patch-id>.md`. All pages share one template so readers know what to expect on every page. Keep the format consistent.

## Template

```markdown
# [Patch display name]

> [One-line description — the `description` field from the patch source]

**ID** `patch-id` · **Default** on|off · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/<file>.ts)

## What it does

[1-3 short paragraphs. Describe the feature from a user's point of view. What changes, what they see. No implementation talk here.]

## Why

[Optional. The original problem or upstream issue. Link to the GitHub issue if one exists, including the reaction count at the time you wrote the page.]

## Usage

[Optional. Keybindings, slash commands, or "automatic — runs on every session". Only include if there's something for the user to do.]

## How it works

[1-3 short paragraphs. Plain-English summary of the AST transform: what marker or shape identifies the target, and what the patch inserts or replaces. Don't paste the full implementation — point to the source file for that. This section is for "how did they even find that in the minified bundle?" curiosity.]
```

## Section rules

- **What it does** — required on every page.
- **How it works** — required on every page.
- **Why** — include when there's an upstream issue, a specific user complaint, or a non-obvious motivation. Skip when the name already explains the patch (e.g. "No Tips").
- **Usage** — include when there's a keybinding, command, or interaction. Skip for always-on patches with no surface.

Section headings use sentence case. Don't add sections that aren't in the template (no "Challenges", no "Future work", no "Trivia").

## Metadata line

A single line right under the one-liner:

```
**ID** `patch-id` · **Default** on|off · **Compatible** `*` · [Source](...)
```

- **ID** — the patch's `id` field from `src/patches/<file>.ts`. Always in backticks.
- **Default** — matches the `defaultEnabled` field (defaults to `on` when absent).
- **Compatible** — the Claude Code bundle version range(s) the patch supports.
- **Source** — link to the patch file on the main branch.

Separate the fields with middle dots (`·`), not pipes or commas.

### Compatible ranges

For a patch with a flat `apply` function, use `` `*` `` — it works on every version the daily test run has verified against, and the source has no version gate.

For a patch with `variants` in its source, list every variant range in declaration order, joined by middle dots:

```
**Compatible** `>=2.1.97` · `<2.1.97`
```

Each range goes in its own backticks. The order should match the `variants` array in the patch source (newest first). If the variant uses `` `*` `` as a catch-all fallback, still write it explicitly rather than hiding it.

When a patch has variants, the **How it works** section should also show the variant table — see `per-session-effort.md` for the format. Future readers skimming for "which version does this cover" should find the answer in two places: the metadata line for the TL;DR, the variant table for the details.

### Updating the compatibility matrix

`docs/patches/index.md` has two tables: the main patch list (with one **Compatible** column per row) and a **Version compatibility matrix** (per-patch × per-version grid of ✓ marks). Both are maintained by hand, informed by the output of `bun scripts/test-patches.ts <version>`.

When you add a patch or change its variant ranges:

1. Update the **Compatible** column in the main table to match the patch's metadata line.
2. Add a new row to the matrix table, marking any versions you've verified against. Leave cells blank for versions you haven't tested — don't assume, and don't backfill.
3. If the daily workflow discovers a new tested version, add it as a new column in the matrix and fill in the results.

The `per-session-effort` row in the matrix annotates each ✓ with the variant that applied (`*(ternary variant)*`, `*(&& variant)*`). Copy that convention for any future multi-variant patch so readers can see which branch they're on at a glance.

## Writing style

These pages should sound like a human wrote them. Avoid the usual AI patterns:

- No inflated importance words: *testament, pivotal, vital, crucial, underscores, highlights, reflects broader, key role, showcase, vibrant, enduring, seamless, robust*.
- No rule-of-three ("fast, reliable, and secure").
- No bold-header bullet lists ("**Performance:** improves speed…"). Just write sentences.
- No "not just X, but Y" parallelism.
- No fake hedging ("it could potentially possibly").
- Use *is* and *has* instead of *serves as, represents, boasts*.
- Title case is only for the page title (the patch display name). Sentence case for section headings.
- Em dashes are fine in moderation — they show up elsewhere in the docs — but don't lean on them.

Write like you're explaining to a colleague who's going to actually use the patch. Be specific. If the patch exists because of a particular annoyance, say so.

## Adding a new patch

When you add a patch to `src/patches/`:

1. Create `docs/patches/<patch-id>.md` using the template above.
2. Add a row to `docs/patches/index.md`'s table, linking the patch name to the new page.
3. Add the page to the sidebar in `docs/.vitepress/config.mts` under the Patches section, matching the table order.

## Updating an existing page

If you change a patch's behavior:

- Update **What it does** to reflect the new behavior.
- Update **How it works** if the AST strategy changed.
- Update the metadata line if the default flipped or the compatible range narrowed.

If you rename a patch or change its `id`, rename the `.md` file too and update the sidebar and the table. Leave a redirect only when someone's actually going to hit the old URL.
