# How it works

1. `cx` locates your global `@anthropic-ai/claude-code/cli.js`
2. Parses the ~4MB minified bundle into an AST with [acorn](https://github.com/acornjs/acorn)
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
