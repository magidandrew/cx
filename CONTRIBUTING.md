# Contributing to cx

## Development setup

```sh
git clone https://github.com/magidandrew/cx.git
cd cx
npm install
```

Use **bun** to run TypeScript source directly — no build step needed:

```sh
bun src/cli.ts          # run cx
bun src/cli.ts setup    # patch configurator
bun src/cli.ts list     # list patches
```

## Project structure

```
src/
├── cli.ts              # Entry point — cache, spawn, reload loop
├── setup.ts            # Interactive TUI patch configurator
├── transform.ts        # AST transform framework (acorn-based)
├── transform-worker.ts # Worker thread for non-blocking transforms
├── ast.ts              # AST index, source editor, query helpers
├── types.ts            # Shared types
└── patches/            # One file per patch
    ├── index.ts        # Re-exports all patches
    ├── queue.ts
    ├── reload.ts
    └── ...
cc-source/              # Reference copy of Claude Code source (for patch authoring)
```

### Key concepts

- **`src/transform.ts`** — Parses the Claude Code bundle with acorn, builds an AST index, and runs each patch's `apply()` function against a context object.
- **`src/ast.ts`** — Provides `ASTIndex` (structural queries over the AST), `SourceEditor` (non-destructive splice-based edits), and `buildContext()` which wires them together.
- **`src/patches/*.ts`** — Each patch exports a `Patch` object with `id`, `name`, `description`, `defaultEnabled`, and an `apply(ctx)` function.

## Writing a patch

### 1. Create the patch file

```sh
touch src/patches/my-patch.ts
```

### 2. Implement the patch

Every patch exports a default `Patch` object:

```ts
import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'my-patch',
  name: 'My Patch',
  description: 'What it does in one line',
  defaultEnabled: true,

  apply(ctx) {
    // ctx.source  — original source string
    // ctx.index   — ASTIndex for structural queries
    // ctx.editor  — SourceEditor for splicing changes
    // ctx.find()  — shorthand query helpers

    // Example: find a string literal and replace it
    const node = ctx.find.literal('some-target-string');
    if (node) {
      ctx.editor.replace(node.start, node.end, `"replacement"`);
    }
  },
};

export default patch;
```

### 3. Register it

Add an export line to `src/patches/index.ts`:

```ts
export { default as myPatch } from './my-patch.js';
```

### 4. Add it to a group in setup

Open `src/setup.ts` and add your patch ID to the appropriate group (Display, Input, Spinner, or Behavior). Ungrouped patches appear under "Other".

### Using `cc-source/`

The `cc-source/` directory contains a reference copy of the Claude Code source. Use it to find the exact strings, function shapes, and AST structures your patch needs to target. This is the bundle your transforms run against — grep it, read it, understand the structure before writing your `apply()` function.

```sh
# Find the code you want to patch
grep -n "targetString" cc-source/cli.js
```

### Tips

- **Be surgical.** Find the narrowest, most specific AST node possible. The bundle is minified — string literals and structural patterns are your best anchors.
- **Fail gracefully.** If your target isn't found, do nothing. Claude Code updates frequently and your target may move.
- **Test with bun.** Run `bun src/cli.ts` to verify your patch applies cleanly.
- **Check the cache.** If your patch doesn't seem to take effect, delete `.cache/` and re-run.

## Building for npm

The `dist/` bundle is only needed for publishing:

```sh
npm run build   # tsc → dist/
```

Do not run dist files during development — always use `bun src/cli.ts`.

## Branch naming

Prefix feature branches with `feat/`:

```
feat/my-new-patch
feat/session-timer
```

## Pull requests

1. Fork the repo
2. Create a feature branch (`feat/your-patch`)
3. Write your patch, register it, test it
4. Submit a PR with a clear description of what the patch does and why
