/**
 * Auto-Detect Terminal Theme
 *
 * Makes Claude's TUI match the user's terminal background — both for
 * brand-new installs and for existing users who already have a saved
 * `theme: 'dark'` from the old default. Two coordinated edits:
 *
 * 1. Default-config flip: `createDefaultGlobalConfig().theme` changes
 *    from `'dark'` to `'auto'`, so fresh installs get `'auto'` saved
 *    from the first write.
 *
 * 2. Read-time override: `defaultInitialTheme()` (the sole function the
 *    ThemeProvider calls to seed its themeSetting state from config)
 *    rewrites `'dark'` → `'auto'` on the way out. A user with saved
 *    `theme: 'dark'` therefore flows through the system-theme path on
 *    every render without ever writing to disk.
 *
 * Upstream plumbing we reuse as-is: `ThemeSetting` already includes
 * `'auto'`, `/theme` lists it, `resolveThemeSetting` maps `'auto'` →
 * `getSystemThemeName()`, the COLORFGBG env var seeds the cache
 * synchronously at startup, and `systemThemeWatcher.ts` live-updates via
 * OSC 11 when the terminal palette flips (dark-at-9am, etc).
 *
 * Why override 'dark' specifically rather than forcing 'auto' globally:
 * `'light'` and `'*-daltonized'` are explicit user choices that we
 * should never override. `'dark'` is the one value that's ambiguous —
 * it might mean "I chose dark" or "I never touched it and the default
 * stuck". Since users who actually want dark can disable this patch,
 * we take the ambiguous case as "apply auto-detect".
 *
 * Source (utils/config.ts):
 *   function createDefaultGlobalConfig() {
 *     return { numStartups: 0, ..., theme: 'dark', ... }
 *   }
 * Source (components/design-system/ThemeProvider.tsx):
 *   function defaultInitialTheme(): ThemeSetting {
 *     return getGlobalConfig().theme
 *   }
 * Bundle (minified):
 *   function lo(){return{numStartups:0,...,theme:"dark",...}}
 *   function av_(){return J8().theme}
 */

import type { Patch, ASTNode } from '../types.js';

const patch: Patch = {
  id: 'auto-detect-theme',
  name: 'Auto-Detect Terminal Theme',
  description: 'Default to "auto" theme on first run so Claude matches your terminal background',

  apply(ctx) {
    const { ast, editor, find, assert } = ctx;
    const { findFirst } = find;

    // Locate the default-config factory by its object shape. Both
    // `theme:"dark"` and `numStartups:0` appear together only in
    // createDefaultGlobalConfig — no other object in the bundle carries
    // that pair.
    const hasProp = (
      obj: ASTNode,
      key: string,
      pred: (value: ASTNode) => boolean,
    ): ASTNode | null => {
      for (const prop of obj.properties ?? []) {
        if (prop.type !== 'Property') continue;
        const k = prop.key;
        const matchesKey =
          (k?.type === 'Identifier' && k.name === key) ||
          (k?.type === 'Literal' && k.value === key);
        if (matchesKey && pred(prop.value)) return prop;
      }
      return null;
    };

    const isLiteral = (v: unknown) =>
      (n: ASTNode) => n.type === 'Literal' && n.value === v;

    const configObj = findFirst(ast, (n: ASTNode) => {
      if (n.type !== 'ObjectExpression') return false;
      if (!hasProp(n, 'numStartups', isLiteral(0))) return false;
      return hasProp(n, 'theme', isLiteral('dark')) !== null;
    });
    assert(
      configObj,
      'auto-detect-theme: could not find default-config object (numStartups:0 + theme:"dark")',
    );

    const themeProp = hasProp(configObj, 'theme', isLiteral('dark'));
    assert(themeProp, 'auto-detect-theme: lost theme property on second lookup');

    // Replace only the literal value; leaving the `theme:` key and the
    // surrounding comma/braces untouched keeps offsets stable for any
    // other patch that edits nearby.
    const themeLiteral = themeProp.value;
    editor.replaceRange(themeLiteral.start, themeLiteral.end, '"auto"');

    // -- Part 2: rewrite defaultInitialTheme ---------------------------
    // Locate the zero-arg function whose entire body is
    // `return X().theme` — this is defaultInitialTheme in the bundle,
    // the ONE place where the saved setting crosses into the React
    // tree. `function av_(){return J8().theme}` is its minified form.
    //
    // Structural predicate: function with no params, body is a single
    // ReturnStatement whose argument is a `.theme` MemberExpression
    // read off a zero-arg CallExpression. This matches only
    // defaultInitialTheme — the other `.theme` reads in the bundle are
    // either inside multi-statement functions or have different call
    // shapes (e.g. `gQ(J8().theme)` reads into a call argument, not a
    // raw return).
    const looksLikeGetTheme = (n: ASTNode): boolean => {
      if (
        n.type !== 'FunctionDeclaration' &&
        n.type !== 'FunctionExpression' &&
        n.type !== 'ArrowFunctionExpression'
      ) return false;
      if ((n.params ?? []).length !== 0) return false;
      const body = n.body;
      if (body?.type !== 'BlockStatement') return false;
      if ((body.body ?? []).length !== 1) return false;
      const stmt = body.body[0];
      if (stmt?.type !== 'ReturnStatement') return false;
      const arg = stmt.argument;
      if (arg?.type !== 'MemberExpression') return false;
      if (arg.computed) return false;
      const prop = arg.property;
      if (prop?.type !== 'Identifier' || prop.name !== 'theme') return false;
      const obj = arg.object;
      if (obj?.type !== 'CallExpression') return false;
      if ((obj.arguments ?? []).length !== 0) return false;
      return true;
    };

    const getTheme = findFirst(ast, looksLikeGetTheme);
    assert(
      getTheme,
      'auto-detect-theme: could not find defaultInitialTheme (zero-arg fn returning X().theme)',
    );

    // Rewrite body: `{return X().theme}` → `{let _=X().theme;return _==="dark"?"auto":_}`.
    // We take the return's argument source text verbatim so we don't
    // have to care about the minified name of getGlobalConfig. The
    // identifier `_cxT` is obscure enough not to collide with any free
    // binding the minifier might introduce in a nested scope.
    const retStmt = getTheme.body.body[0];
    const exprSrc = ctx.src(retStmt.argument);
    editor.replaceRange(
      retStmt.start,
      retStmt.end,
      `let _cxT=${exprSrc};return _cxT==="dark"?"auto":_cxT;`,
    );
  },
};

export default patch;
