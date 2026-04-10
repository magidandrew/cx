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
 * `{ effortValue: newEffort }` consequent with `{}`. The surrounding
 * `...(cond ? {} : {})` spread then contributes nothing, so
 * `settings.effortLevel` still updates (keeping disk and in-memory
 * settings in sync) but top-level `effortValue` is never overwritten
 * from the watcher.
 *
 * Local writes are unaffected: the /effort command and the ModelPicker
 * submit path both call `setAppState(prev => ({ ...prev, effortValue }))`
 * directly, not through applySettingsChange.
 *
 * Identification: the bundle contains exactly one ConditionalExpression
 *   cond ? { effortValue: X } : {}
 * where the consequent is a single-property object with key "effortValue"
 * and the alternate is empty. Verified by grepping the public bundle for
 * `?{effortValue:` — single match, inside the applySettingsChange return.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'per-session-effort',
  name: 'Per-Session Effort',
  description:
    'Stop settings-file effort changes from clobbering other running sessions',

  apply(ctx) {
    const { ast, editor, find, assert } = ctx;
    const { findFirst } = find;

    const cond = findFirst(ast, (n: any) => {
      if (n.type !== 'ConditionalExpression') return false;
      const c = n.consequent;
      const a = n.alternate;
      if (c?.type !== 'ObjectExpression' || c.properties.length !== 1) {
        return false;
      }
      if (a?.type !== 'ObjectExpression' || a.properties.length !== 0) {
        return false;
      }
      const prop = c.properties[0];
      return (
        prop?.type === 'Property' &&
        prop.key?.type === 'Identifier' &&
        prop.key.name === 'effortValue'
      );
    });
    assert(
      cond,
      'Could not find (cond ? { effortValue: X } : {}) in applySettingsChange',
    );

    editor.replaceRange(cond.consequent.start, cond.consequent.end, '{}');
  },
};

export default patch;
