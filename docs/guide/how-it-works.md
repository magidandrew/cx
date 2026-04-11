# How it works

1. `cx` locates your global `@anthropic-ai/claude-code/cli.js`
2. Parses the ~13.5MB minified bundle into an AST with [acorn](https://github.com/acornjs/acorn)
3. Each enabled patch finds its target via structural queries and splices in changes
4. The patched source is cached, so subsequent launches are instant
5. `cx` spawns Node on the cached bundle with your original arguments

Patches are pure AST transforms. They don't monkey-patch at runtime, don't wrap modules, and don't touch the original file on disk.

## Caching

The patched bundle is cached keyed by:

- Claude Code version (from its `package.json`)
- cx version
- The set of enabled patches

A new cache entry is built whenever any of those change. The cache lives under your user config directory, so multiple projects share the same patched bundle.

## Authoring patches

See [CONTRIBUTING.md](https://github.com/magidandrew/cx/blob/main/CONTRIBUTING.md) in the repo for the patch-authoring guide. Every patch lives in `src/patches/` as a single file exporting a `Patch` object with an `apply(ctx)` function that operates on the AST.

## Per-version variants

Claude Code ships minor versions almost every day, and the minifier sometimes emits different AST shapes for the same source logic between releases. Rather than race the patches against each upstream build, `cx` lets a single patch provide multiple implementations gated by a semver range:

```ts
const patch: Patch = {
  id: 'per-session-effort',
  name: 'Per-Session Effort',
  description: '...',

  variants: [
    { version: '>=2.1.97', apply(ctx) { /* new AST shape */ } },
    { version: '*',        apply(ctx) { /* older AST shape — catch-all fallback */ } },
  ],
};
```

At patch time, `cx` reads the version from the `package.json` sitting next to the installed `cli.js`, then walks the variant list top-to-bottom and runs the first one whose range matches. Variants are evaluated in declaration order, so authors put the newest version first and let older fallbacks trail behind. If no variant matches, the transform throws `no variant matches claude-code@<version>` — a loud failure so you know a new variant is needed.

The range syntax is minimal on purpose — just the comparisons that actually come up in practice: `>=X.Y.Z`, `<=X.Y.Z`, `>X.Y.Z`, `<X.Y.Z`, `=X.Y.Z` (or a bare version), `*`, and whitespace-separated compound ranges like `">=2.1.96 <2.2"`. No tildes, no carets, no `x` wildcards. See [`src/semver.ts`](https://github.com/magidandrew/cx/blob/main/src/semver.ts) for the full grammar.

A patch with a flat `apply` (no `variants`) keeps working unchanged — it just runs on every version. Only add variants when you actually need to branch on the bundle shape.

## Regression testing

`cx` runs a [GitHub Actions workflow](https://github.com/magidandrew/cx/actions/workflows/test-patches.yml) every morning that fetches the newest `@anthropic-ai/claude-code` from npm and applies every patch against it in isolation — one failure never masks another. The workflow:

1. Downloads the latest `cli.js` via `npm pack`.
2. Runs `bun scripts/test-patches.ts` which calls `transform()` once per patch with `only: [id]` so each is tested against a fresh AST parse of the untouched source.
3. Builds a markdown report from the per-patch pass/fail results.
4. Opens or updates a single `[auto] cx patches broken against latest claude-code` issue in the repo if anything failed; auto-closes it when everything is green again.
5. Uploads `report.json` as a workflow artifact with 30-day retention.

You can run the same test locally:

```sh
bun scripts/test-patches.ts          # against claude-code@latest
bun scripts/test-patches.ts 2.1.96   # against a specific published version
npm run test:patches                 # same as the first, through npm
```

The live compatibility picture — which patches work against which versions, as of the most recent test run — is maintained by hand in [`docs/patches/index.md`](/patches/) and cross-referenced against the workflow's recent runs.

## Claude Code source

Writing a patch means targeting specific nodes in Claude Code's bundle — but the npm package ships as a single ~13.5MB minified `cli.js` with no readable source. You need the original source to find the strings, function shapes, and structural anchors your patch will query against.

The source has been extracted from npm sourcemaps and posted to GitHub. One mirror:

- [yasasbanukaofficial/claude-code](https://github.com/yasasbanukaofficial/claude-code)

Clone it into `cc-source/` at the repo root (it's gitignored, only a README is tracked):

```sh
git clone https://github.com/yasasbanukaofficial/claude-code cc-source
```

Then grep it while authoring patches:

```sh
grep -n "targetString" cc-source/cli.js
```

This is a reference copy only — `cx` never reads from `cc-source/` at runtime. It patches your globally installed `@anthropic-ai/claude-code/cli.js` directly.
