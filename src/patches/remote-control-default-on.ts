/**
 * Remote Control on by default
 *
 * Flips the `remoteControlAtStartup` fallback so every new window joins
 * Remote Control automatically — no more opening a fresh session and
 * realising ten minutes later that you forgot to toggle it on.
 *
 * Source (bridgeEnabled.ts → utils/config.ts):
 *   export function getRemoteControlAtStartup(): boolean {
 *     const explicit = getGlobalConfig().remoteControlAtStartup
 *     if (explicit !== undefined) return explicit
 *     if (feature('CCR_AUTO_CONNECT')) {
 *       if (ccrAutoConnect?.getCcrAutoConnectDefault()) return true
 *     }
 *     return false
 *   }
 *
 * In the public build the CCR_AUTO_CONNECT branch is compile-stripped,
 * so the function simplifies to:
 *   function FQ(){let q=J8().remoteControlAtStartup;if(q!==void 0)return q;return!1}
 *
 * The precedence rule the source comment spells out is "explicit setting
 * always wins", so we only touch the final `return false` — users who
 * have `remoteControlAtStartup: false` in their config still opt out.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'remote-control-default-on',
  name: 'Remote Control on by Default',
  description: 'Join Remote Control automatically on each new session (explicit config still wins)',
  defaultEnabled: false,

  apply(ctx) {
    const { index, editor, find, assert } = ctx;
    const { findFirst } = find;

    // Anchor: the `q !== void 0` (or `x !== undefined`) test inside a
    // function whose member-access is `.remoteControlAtStartup`. Rather
    // than looking at the whole function we walk up from the property
    // access itself — the innermost enclosing function is the target
    // by construction, so there's no smallest-function tiebreaker.
    const memberNode = findFirst(ctx.ast, (n: any) =>
      n.type === 'MemberExpression' &&
      n.property?.type === 'Identifier' &&
      n.property.name === 'remoteControlAtStartup' &&
      // The read we want is the one inside getRemoteControlAtStartup,
      // which is `getGlobalConfig().remoteControlAtStartup` — the
      // object is a direct CallExpression, not a deeper chain. This
      // single shape filter excludes every other `.remoteControlAtStartup`
      // reference in the bundle (ConfigTool enum handlers, BridgeDialog
      // diffs, etc.) because they all read it off a parameter or local
      // destructure, never a call.
      n.object?.type === 'CallExpression');
    assert(memberNode, 'remote-control-default-on: could not find getGlobalConfig().remoteControlAtStartup read');

    const fn = index.enclosingFunction(memberNode);
    assert(fn, 'remote-control-default-on: property read had no enclosing function');

    // Find the function's own `return false` — not a nested closure's.
    // We walk the body and stop descending into nested functions so
    // this stays surgical even if the upstream adds a closure wrapper.
    const body = (fn as any).body;
    assert(body?.type === 'BlockStatement', 'remote-control-default-on: expected block body');

    const isFalseReturn = (ret: any): boolean => {
      const arg = ret?.argument;
      if (!arg) return false;
      if (arg.type === 'Literal' && arg.value === false) return true;
      // Minifiers emit `return !1` for `return false`.
      return arg.type === 'UnaryExpression' && arg.operator === '!' &&
        arg.argument?.type === 'Literal' && arg.argument.value === 1;
    };

    let target: any = null;
    const stack: any[] = [body];
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== 'object' || !n.type) continue;
      if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
        if (n !== fn) continue;
      }
      if (n.type === 'ReturnStatement' && isFalseReturn(n)) {
        target = n;
        // Don't break — prefer the LAST false-return in source order
        // (the `return false` tail is always last).
      }
      for (const key of Object.keys(n)) {
        if (key === 'type' || key === 'start' || key === 'end' || key === 'raw') continue;
        const child = (n as any)[key];
        if (Array.isArray(child)) {
          for (const c of child) if (c && typeof c === 'object' && c.type) stack.push(c);
        } else if (child && typeof child === 'object' && child.type) {
          stack.push(child);
        }
      }
    }
    assert(target, 'remote-control-default-on: could not find `return false` inside getRemoteControlAtStartup');

    // Replace the `false`/`!1` expression itself — leaving the
    // surrounding `return` and statement terminator untouched so the
    // bundle's offset map stays valid for subsequent edits.
    const falseExpr = target.argument;
    editor.replaceRange(falseExpr.start, falseExpr.end, '!0');
  },
};

export default patch;
