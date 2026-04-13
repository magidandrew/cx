/**
 * Random Color on /rename Patch
 *
 * Each time the user runs `/rename`, the session's prompt-bar color
 * is rerolled to a random pick from the AGENT_COLORS palette. Purely
 * cosmetic — rename already does an in-place setAppState update for
 * the name, and we piggyback on that to also set `color`.
 *
 * Effect is session-scoped (ephemeral across restarts). We don't call
 * `saveAgentColor` because that would require discovering a second
 * minified identifier for marginal UX value — the user can still run
 * `/color <name>` to lock in a color permanently if they like one.
 *
 * Target: the `call` export from cc-source/src/commands/rename/rename.ts.
 * After bundling we locate it by a unique plain-string literal from
 * the teammate-block early return. That string survives minification
 * unchanged and is used nowhere else in the codebase.
 */

import type { Patch } from '../types.js';

// Must match AGENT_COLORS in cc-source/src/tools/AgentTool/agentColorManager.ts.
// Hardcoded here so we don't have to chase a second minified identifier at
// patch time. If Anthropic ever grows this list, update it here too.
//
// Exported so auto-rename-first-message can reuse the same pool when
// both patches are enabled — keeps the source of truth in one place.
export const AGENT_COLORS = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'cyan',
];

const patch: Patch = {
  id: 'rename-random-color',
  name: 'Random Color on /rename',
  description: 'Randomize the prompt-bar color each time you run /rename',
  defaultEnabled: false,

  apply(ctx) {
    const { ast, editor, find, index, assert } = ctx;
    const { findFirst } = find;

    // ── 1. Find rename's `call` function ───────────────────────────
    // The teammate-block onDone() error is a plain string literal
    // (not a template literal) with wording only the rename command
    // uses, so it's unambiguous and survives minification verbatim.
    const marker = findFirst(ast, (n: any) =>
      n.type === 'Literal' &&
      typeof n.value === 'string' &&
      n.value.startsWith('Cannot rename: This session is a swarm teammate'));
    assert(marker, 'Could not find rename teammate-block string literal');

    const renameFn = index.enclosingFunction(marker);
    assert(renameFn, 'Could not find enclosing rename call function');
    assert(renameFn.body?.type === 'BlockStatement',
      'Expected rename call function to have a BlockStatement body');

    // ── 2. Find the standaloneAgentContext inner ObjectExpression ──
    // Scoped to the rename function. It's the only place inside
    // `call` where an ObjectExpression property keyed
    // `standaloneAgentContext` carries another ObjectExpression
    // containing a `name` key — that's the inner object passed to
    // setAppState's functional updater:
    //
    //   setAppState(prev => ({
    //     ...prev,
    //     standaloneAgentContext: {
    //       ...prev.standaloneAgentContext,
    //       name: newName,     // <- our anchor
    //     },
    //   }))
    //
    // Both the outer `standaloneAgentContext` key and the inner
    // `name` key are preserved through bundling — terser doesn't
    // mangle object property names by default, and the state reducer
    // downstream reads them by those exact names.
    const ctxProp = findFirst(renameFn, (n: any) => {
      if (n.type !== 'Property') return false;
      const keyIsCtx =
        (n.key.type === 'Identifier' && n.key.name === 'standaloneAgentContext') ||
        (n.key.type === 'Literal' && n.key.value === 'standaloneAgentContext');
      if (!keyIsCtx) return false;
      if (n.value.type !== 'ObjectExpression') return false;
      return n.value.properties.some((p: any) =>
        p.type === 'Property' &&
        ((p.key.type === 'Identifier' && p.key.name === 'name') ||
         (p.key.type === 'Literal' && p.key.value === 'name')));
    });
    assert(ctxProp, 'Could not find standaloneAgentContext update object in rename');

    const innerObj = ctxProp.value;
    const nameProp = innerObj.properties.find((p: any) =>
      p.type === 'Property' &&
      ((p.key.type === 'Identifier' && p.key.name === 'name') ||
       (p.key.type === 'Literal' && p.key.value === 'name')));
    assert(nameProp, 'Could not find name property inside standaloneAgentContext object');

    // ── 3. Inject the random pick at the top of the function body ──
    // Runs exactly once per /rename invocation. Keeping the variable
    // local (`var __cxC`) and function-scoped means the arrow passed
    // to setAppState closes over it correctly. The `__cx` prefix
    // avoids collision with any bundler-emitted identifiers.
    const poolLiteral = JSON.stringify(AGENT_COLORS);
    editor.insertAt(
      renameFn.body.start + 1,
      `var __cxC=${poolLiteral}[Math.floor(Math.random()*${AGENT_COLORS.length})];`,
    );

    // ── 4. Append `color:__cxC` to the inner object ────────────────
    // Inserting after the name property's `.end` (which sits before
    // any trailing comma) keeps both shapes valid:
    //   {...spread,name:X}   ->  {...spread,name:X,color:__cxC}
    //   {...spread,name:X,}  ->  {...spread,name:X,color:__cxC,}
    //
    // Crucially, this sits AFTER the `...prev.standaloneAgentContext`
    // spread, so our random color overrides whatever color was
    // previously in state rather than being silently shadowed by it.
    editor.insertAt(nameProp.end, `,color:__cxC`);
  },
};

export default patch;
