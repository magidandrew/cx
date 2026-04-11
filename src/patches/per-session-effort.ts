/**
 * Per-Session Effort Patch
 *
 * By default, changing `/effort` (or picking effort in /model) writes to
 * settings.json, and a chokidar watcher in every other running Claude Code
 * instance picks up the change and clobbers that instance's in-memory
 * effortValue — so setting effort in one terminal retroactively rewrites
 * every other open terminal's effort.
 *
 * We want last-write-wins on disk (new sessions pick up the latest at
 * startup) but each running terminal to hold its own live state. The
 * propagation happens in applySettingsChange:
 *
 *   // cc-source/src/utils/settings/applySettingsChange.ts
 *   const prevEffort = prev.settings.effortLevel
 *   const newEffort  = newSettings.effortLevel
 *   const effortChanged = prevEffort !== newEffort
 *   return {
 *     ...prev,
 *     settings: newSettings,
 *     toolPermissionContext: newContext,
 *     ...(effortChanged && newEffort !== undefined
 *       ? { effortValue: newEffort }
 *       : {}),
 *   }
 *
 * We neutralize that single propagation by replacing the
 * `{ effortValue: newEffort }` object with `{}`. The surrounding spread
 * then contributes nothing, so `settings.effortLevel` still updates
 * (keeping disk and in-memory settings in sync) but top-level
 * `effortValue` is never overwritten from the watcher.
 *
 * Local writes are unaffected: the /effort command and the ModelPicker
 * submit path both call `setAppState(prev => ({ ...prev, effortValue }))`
 * directly, not through applySettingsChange.
 *
 * ── Why this patch has variants ──
 *
 * The minifier emits different AST shapes for the same source logic
 * depending on the compiler pass. Somewhere in the 2.1.97 release the
 * bundle stopped rendering the effort spread as a ternary
 *
 *   ...(cond ? { effortValue: X } : {})
 *
 * and started rendering it as a logical-and
 *
 *   ...cond && { effortValue: X }
 *
 * which is a `LogicalExpression` in ESTree terms, not a
 * `ConditionalExpression`. The fix is the same — replace the
 * `{ effortValue: X }` object with `{}` — but the find logic differs,
 * so we express each as its own variant gated by version range.
 *
 * Identification: in both forms the bundle contains exactly one object
 * literal whose only property is `effortValue`, and it's the right
 * operand / consequent of the spread we're targeting. Verified by
 * grepping the bundle for `{effortValue:` — single match, inside
 * `applySettingsChange`.
 */

import type { Patch } from '../types.js';

/** Returns true if node is an ObjectExpression with exactly one `effortValue: X` property. */
function isEffortValueObject(n: any): boolean {
  if (n?.type !== 'ObjectExpression' || n.properties.length !== 1) return false;
  const prop = n.properties[0];
  return (
    prop?.type === 'Property' &&
    prop.key?.type === 'Identifier' &&
    prop.key.name === 'effortValue'
  );
}

const patch: Patch = {
  id: 'per-session-effort',
  name: 'Per-Session Effort',
  description:
    'Stop settings-file effort changes from clobbering other running sessions',

  variants: [
    {
      // 2.1.97+ bundles render the effort spread as a logical-and:
      //   ...(cond1 && cond2 && { effortValue: w })
      // We find the outermost `&&` whose right operand is the single-
      // property `{ effortValue: X }` object, and overwrite that
      // right operand with `{}`. The spread of `{}` (when the full
      // condition is truthy) or of a falsy primitive (when it's not)
      // both contribute zero keys, so the effect is identical to the
      // old variant: settings update locally, effortValue untouched.
      version: '>=2.1.97',
      apply(ctx) {
        const { ast, editor, find, assert } = ctx;
        const { findFirst } = find;

        const log = findFirst(ast, (n: any) =>
          n.type === 'LogicalExpression' &&
          n.operator === '&&' &&
          isEffortValueObject(n.right),
        );
        assert(
          log,
          'Could not find (cond && { effortValue: X }) in applySettingsChange',
        );

        editor.replaceRange(log.right.start, log.right.end, '{}');
      },
    },
    {
      // Pre-2.1.97 bundles used a ternary:
      //   ...(cond ? { effortValue: X } : {})
      // with an empty-object alternate. Replacing the consequent with
      // `{}` collapses the ternary to `cond ? {} : {}`, which spreads
      // nothing regardless of the test.
      version: '*',
      apply(ctx) {
        const { ast, editor, find, assert } = ctx;
        const { findFirst } = find;

        const cond = findFirst(ast, (n: any) => {
          if (n.type !== 'ConditionalExpression') return false;
          if (!isEffortValueObject(n.consequent)) return false;
          return n.alternate?.type === 'ObjectExpression' &&
                 n.alternate.properties.length === 0;
        });
        assert(
          cond,
          'Could not find (cond ? { effortValue: X } : {}) in applySettingsChange',
        );

        editor.replaceRange(cond.consequent.start, cond.consequent.end, '{}');
      },
    },
  ],
};

export default patch;
