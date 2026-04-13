# cx — Claude Code Extensions

## Running during development

Use **bun** to run TypeScript source files directly — no build step needed:

```sh
bun src/cli.ts          # run cx (patched claude)
bun src/cli.ts setup    # run cx setup
bun src/cli.ts list     # list patches
```

For one-off testing of a patch or transform:

```sh
bun src/transform.ts    # (import and call transform() directly)
```

## Building (for npm publish)

The `dist/` bundle is only needed for the published npm package:

```sh
npm run build   # tsc → dist/
```

Do not run dist files during development — use bun on src/ instead.

## Releasing

**Never `npm publish` locally.** Releases are triggered by publishing a GitHub Release; `.github/workflows/publish.yml` runs on `release: published`, sets the package version from the tag (`v<X.Y.Z>` → `<X.Y.Z>`), builds, and publishes to npm with provenance.

To cut a release:

1. Bump `package.json` version and commit on `main`.
2. Push the commit.
3. `gh release create vX.Y.Z --title vX.Y.Z --notes "..."` — the workflow takes it from there.

## Project structure

- `src/patches/` — individual patch modules, one per file
- `src/transform.ts` — AST transform framework (acorn-based)
- `src/cli.ts` — cx entry point (cache, spawn, reload loop)
- `src/setup.ts` — interactive patch configurator (`cx setup`)
- `cc-source/` — reference copy of Claude Code source for patch authoring
- `test/harness/` — per-patch test infrastructure (fixture cache, AST helpers, function extraction, spawn)
- `test/patches/` — per-patch behavioral tests (one *.test.ts file per patch)
- `scripts/test-patches.ts` — standalone check that every patch *applies* cleanly to a target version

## Tests

Two layers, both `bun`-native:

```sh
npm test                    # behavioral tests in test/patches/ — per-patch regression suite
npm run test:patches        # apply-only check against @anthropic-ai/claude-code@latest
CC_VERSION=2.1.101 bun test test/patches/banner.test.ts   # target a specific version
```

The behavioral suite uses `bun test` with `--max-concurrency=1` — parsing a 13MB minified bundle in parallel blows memory. Per-file serial is still fast because the harness memoizes the patched source in-process.

Every new patch should ship with a `test/patches/<id>.test.ts` file. Start from one of the existing files in the same bucket as your patch (STATIC = grep, EXTRACT = vm eval, etc.) and mirror the anchor-and-differential pattern. See `test/harness/index.ts` for the public API.

## Branch naming

When creating a branch for a new feature, prefix it with `feat/` (e.g., `feat/session-timer`, `feat/no-feedback`).
