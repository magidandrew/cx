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

## Project structure

- `src/patches/` — individual patch modules, one per file
- `src/transform.ts` — AST transform framework (acorn-based)
- `src/cli.ts` — cx entry point (cache, spawn, reload loop)
- `src/setup.ts` — interactive patch configurator (`cx setup`)
- `cc-source/` — reference copy of Claude Code source for patch authoring

## Branch naming

When creating a branch for a new feature, prefix it with `feat/` (e.g., `feat/session-timer`, `feat/no-feedback`).
