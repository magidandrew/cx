/**
 * Granular Effort Slider Patch
 *
 * Replaces the discrete low/medium/high/max effort picker in `/model` with
 * a numeric slider. Users cycle the value with ← →, the integer persists
 * across sessions as-is (not the mapped canonical level), and the API call
 * receives a conventional low/medium/high/max string derived at the
 * request boundary.
 *
 * Per-model range mirrors what the model actually supports:
 *   - Opus 4.6   → 1..9 (low/medium/high/max)
 *   - Sonnet 4.6 → 1..7 (low/medium/high — no max)
 *   - Haiku      → no slider, no banner suffix (effort param is unsupported)
 *
 * Scale (1 = minimal, 5 = default, max = 7 or 9):
 *   1-2 → low
 *   3-5 → medium
 *   6-7 → high
 *   8-9 → max (only sent when the model supports it)
 *
 * Patch sites:
 *   1. cycleEffortLevel — numeric cycle via early-return prelude. Honors
 *      the function's third arg (includeMax) so non-max models top out at 7.
 *   2. ModelPicker display — "<capitalize(e)> effort" → " N/M" where M is
 *      9 for max-supporting models and 7 otherwise (read from the same
 *      focusedSupportsMax variable the picker already computes).
 *   3. convertEffortValueToLevel — pass numbers through unchanged so the
 *      picker re-initializes to the same integer the user picked.
 *   4. toPersistableEffort — allow numbers to flow to settings.
 *   5. Settings Zod schema — widen effortLevel from enum-of-strings to
 *      a union with int.
 *   6. API-layer effort assignment — map number → string right before the
 *      request body is built.
 *   7. getEffortSuffix template — startup banner says "with N/M effort",
 *      gated on model: omitted for haiku, /9 for opus-4-6, /7 otherwise.
 *
 * Works alongside persist-max-effort (which already appends "max" to the
 * effort enums). All edits are zero-width insertions so they compose
 * correctly with persist-max-effort's own zero-width insertions.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'granular-effort',
  name: 'Granular Effort Slider',
  description: 'Replace /model effort picker with a 1-9 numeric slider',
  defaultEnabled: true,

  apply(ctx) {
    const { ast, editor, find, src, assert } = ctx;
    const { findFirst } = find;

    // ── 1. cycleEffortLevel: prepend early-return 1..9 cycle ─────────
    //
    // Source (bundle):
    //   function J0Y(q,K,_){
    //     let z=_?["low","medium","high","max"]:["low","medium","high"],
    //         Y=z.indexOf(q), O=Y!==-1?Y:z.indexOf("high");
    //     if(K==="right") return z[(O+1)%z.length];
    //     else return z[(O-1+z.length)%z.length];
    //   }
    //
    // Identified by its ConditionalExpression selecting between two
    // ArrayExpressions whose first three elements are "low","medium","high".
    //
    // We prepend an unconditional early-return sequence at the top of the
    // body rather than replacing it wholesale. This avoids a conflict with
    // persist-max-effort, which inserts `,"max"` into the 3-element array
    // literal inside this same body — a replaceRange here would partially
    // overlap that insert and corrupt the output. With an early return, the
    // original body becomes dead code and inserts inside it are harmless.
    const cycleFn = findFirst(ast, (n: any) => {
      if (n.type !== 'FunctionDeclaration' || n.params.length !== 3) return false;
      const cond = findFirst(n, (c: any) => {
        if (c.type !== 'ConditionalExpression') return false;
        const isLevelArr = (a: any, len: number) =>
          a?.type === 'ArrayExpression' &&
          a.elements.length === len &&
          a.elements[0]?.type === 'Literal' && a.elements[0].value === 'low' &&
          a.elements[1]?.type === 'Literal' && a.elements[1].value === 'medium' &&
          a.elements[2]?.type === 'Literal' && a.elements[2].value === 'high';
        return isLevelArr(c.consequent, 4) && isLevelArr(c.alternate, 3);
      });
      return cond !== null;
    });
    assert(cycleFn, 'Could not find cycleEffortLevel function');

    const [pV, pDir, pAllowMax] = cycleFn.params.map((p: any) => p.name);

    // The third arg (includeMax) is the picker's focusedSupportsMax bool.
    // When the model doesn't support max, top out at 7 ("high") so the
    // slider mirrors the original low/medium/high range. Also clamp the
    // current value down to the cap when switching models — otherwise a
    // 9 carried over from Opus would render as "9/7" on Sonnet.
    const cyclePrelude =
      `var _cxMax=${pAllowMax}?9:7;` +
      `var _cxY=typeof ${pV}==="number"?${pV}:` +
      `(${pV}==="low"?2:${pV}==="medium"?5:${pV}==="max"?9:7);` +
      `if(_cxY>_cxMax)_cxY=_cxMax;` +
      `if(${pDir}==="right")return _cxY>=_cxMax?1:_cxY+1;` +
      `return _cxY<=1?_cxMax:_cxY-1;`;
    editor.insertAt(cycleFn.body.start + 1, cyclePrelude);

    // ── 2. ModelPicker display text ──────────────────────────────────
    //
    // Source (bundle):
    //   createElement(ULK,{effort:e})," ",La(e)," effort",e===l?" (default)":""," ",...
    //
    // " effort" is a unique literal in the bundle. Walk up to its parent
    // CallExpression, then swap
    //   [ La(e), " effort", e===l ? " (default)" : "" ]
    // for
    //   [ Math.min(N, M), "/", M ]
    // where N is the numeric form of the displayEffort and M is the per-model
    // cap (9 if focusedSupportsMax, else 7). The "(default)" marker is
    // dropped because the numeric display makes the current value explicit.
    //
    // To find the focusedSupportsMax variable name in the bundle, locate
    // the displayEffort clamp ConditionalExpression that the picker writes
    // as `T==="max" && !X ? "high" : T` — `X` is focusedSupportsMax.
    const effortLit = findFirst(ast, (n: any) =>
      n.type === 'Literal' && n.value === ' effort');
    assert(effortLit, 'Could not find " effort" literal');

    const effortCall = findFirst(ast, (n: any) =>
      n.type === 'CallExpression' && n.arguments.some((a: any) => a === effortLit));
    assert(effortCall, 'Could not find createElement call containing " effort"');

    const callArgs = effortCall.arguments;
    const effortIdx = callArgs.indexOf(effortLit);
    assert(effortIdx >= 1 && effortIdx < callArgs.length - 1,
      '" effort" literal not surrounded by expected siblings');

    const laCall = callArgs[effortIdx - 1];
    assert(
      laCall?.type === 'CallExpression' && laCall.arguments.length === 1,
      'Expected capitalize(e) CallExpression before " effort"',
    );
    const eCode = src(laCall.arguments[0]);

    const defaultCond = callArgs[effortIdx + 1];
    assert(
      defaultCond?.type === 'ConditionalExpression',
      'Expected " (default)" ConditionalExpression after " effort"',
    );
    const defaultLit = findFirst(defaultCond, (n: any) =>
      n.type === 'Literal' && n.value === ' (default)');
    assert(defaultLit, 'Default-marker conditional did not contain " (default)"');

    // Find `T==="max" && !X ? "high" : T` — extract X (focusedSupportsMax).
    const dispEffortClamp = findFirst(ast, (n: any) => {
      if (n.type !== 'ConditionalExpression') return false;
      if (n.consequent?.type !== 'Literal' || n.consequent.value !== 'high') return false;
      if (n.alternate?.type !== 'Identifier') return false;
      const t = n.test;
      if (t?.type !== 'LogicalExpression' || t.operator !== '&&') return false;
      const l = t.left, r = t.right;
      if (
        l?.type !== 'BinaryExpression' || l.operator !== '===' ||
        l.left?.type !== 'Identifier' ||
        l.right?.type !== 'Literal' || l.right.value !== 'max'
      ) return false;
      if (
        r?.type !== 'UnaryExpression' || r.operator !== '!' ||
        r.argument?.type !== 'Identifier'
      ) return false;
      return l.left.name === n.alternate.name;
    });
    assert(dispEffortClamp, 'Could not find displayEffort `T==="max"&&!X?"high":T` clamp');
    const supportsMaxVar = dispEffortClamp.test.right.argument.name;

    const numExpr =
      `(typeof ${eCode}==="number"?${eCode}:` +
      `({low:2,medium:5,high:7,max:9})[${eCode}]||5)`;
    const capExpr = `(${supportsMaxVar}?9:7)`;
    editor.replaceRange(
      laCall.start, defaultCond.end,
      `Math.min(${numExpr},${capExpr}),"/",${capExpr}`,
    );

    // ── 3. convertEffortValueToLevel: preserve numbers ───────────────
    //
    // Source (bundle, stripped for non-ants):
    //   function Rw6(q){if(typeof q==="string")return lN8(q)?q:"high";return"high"}
    //
    // This is called at picker init (to seed the `effort` useState from
    // AppState.effortValue). Public-build behavior collapses every number
    // to "high", so a saved 4 would rehydrate as "high" and display as 7.
    // Prepend a numeric passthrough so the picker round-trips the user's
    // exact integer.
    //
    // Identified structurally: a 1-param function whose body has a
    // `typeof q === "string"` check and returns the string literal "high"
    // at least twice (the two fallback returns).
    const convertFn = findFirst(ast, (n: any) => {
      if (
        (n.type !== 'FunctionDeclaration' && n.type !== 'FunctionExpression') ||
        n.params.length !== 1
      ) {
        return false;
      }
      const hasStringTypeof = findFirst(n, (c: any) =>
        c.type === 'BinaryExpression' &&
        c.operator === '===' &&
        c.left?.type === 'UnaryExpression' && c.left.operator === 'typeof' &&
        c.right?.type === 'Literal' && c.right.value === 'string',
      );
      if (!hasStringTypeof) return false;
      // At least two "high" return literals.
      let highCount = 0;
      const scan = (node: any): void => {
        if (!node || typeof node !== 'object' || highCount >= 2) return;
        if (node.type === 'Literal' && node.value === 'high') highCount++;
        for (const k of Object.keys(node)) {
          if (k === 'type' || k === 'start' || k === 'end') continue;
          const v = node[k];
          if (Array.isArray(v)) for (const it of v) scan(it);
          else if (v && typeof v === 'object') scan(v);
        }
      };
      scan(n.body);
      return highCount >= 2;
    });
    assert(convertFn, 'Could not find convertEffortValueToLevel function');

    const convertParam = convertFn.params[0].name;
    editor.insertAt(
      convertFn.body.start + 1,
      `if(typeof ${convertParam}==="number")return ${convertParam};`,
    );

    // ── 4. toPersistableEffort: allow numbers through ───────────────
    //
    // Source (bundle):
    //   function Lw6(q){if(q==="low"||q==="medium"||q==="high")return q;return}
    //
    // After persist-max-effort patches it, the chain also includes "max".
    // Prepend a numeric passthrough so the picker can hand a raw integer
    // to updateSettingsForSource → settings.json.
    //
    // Identified structurally: a 1-param function whose body's first
    // statement is an `if (q==="low" || q==="medium" || q==="high") return q`.
    const persistFn = findFirst(ast, (n: any) => {
      if (
        (n.type !== 'FunctionDeclaration' && n.type !== 'FunctionExpression') ||
        n.params.length !== 1
      ) {
        return false;
      }
      // Find the unique q==="low" || q==="medium" || q==="high" chain.
      const chain = findFirst(n, (c: any) => {
        if (c.type !== 'LogicalExpression' || c.operator !== '||') return false;
        // Walk down the left chain collecting the literal values.
        const values: string[] = [];
        let cur: any = c;
        while (cur && cur.type === 'LogicalExpression' && cur.operator === '||') {
          const r = cur.right;
          if (r?.type !== 'BinaryExpression' || r.operator !== '===' ||
              r.right?.type !== 'Literal') return false;
          values.unshift(r.right.value as string);
          cur = cur.left;
        }
        if (cur?.type !== 'BinaryExpression' || cur.operator !== '===' ||
            cur.right?.type !== 'Literal') return false;
        values.unshift(cur.right.value as string);
        return (
          values.length === 3 &&
          values[0] === 'low' &&
          values[1] === 'medium' &&
          values[2] === 'high'
        );
      });
      return chain !== null;
    });
    assert(persistFn, 'Could not find toPersistableEffort function');

    const persistParam = persistFn.params[0].name;
    editor.insertAt(
      persistFn.body.start + 1,
      `if(typeof ${persistParam}==="number")return ${persistParam};`,
    );

    // ── 5. Settings Zod schema: effortLevel accepts numbers ─────────
    //
    // Source (bundle):
    //   effortLevel:h.enum(["low","medium","high"]).optional().catch(void 0)
    //
    // persist-max-effort widens the enum to include "max"; we then wrap
    // the whole `h.enum([...])` call in `h.union([ ..., h.number().int() ])`
    // so numeric values survive the `.catch(void 0)` guard on read.
    //
    // Identified structurally: a CallExpression where
    //   callee = MemberExpression { object: h, property: "enum" }
    // and the first argument is the 3-element ["low","medium","high"] array
    // (there is exactly one such call in the public bundle — the cycleFn
    // variant uses a raw ArrayExpression, not h.enum(...)).
    const zodEnumCall = findFirst(ast, (n: any) => {
      if (n.type !== 'CallExpression') return false;
      if (
        n.callee.type !== 'MemberExpression' ||
        n.callee.property?.type !== 'Identifier' ||
        n.callee.property.name !== 'enum'
      ) {
        return false;
      }
      const arg = n.arguments[0];
      if (arg?.type !== 'ArrayExpression' || arg.elements.length !== 3) return false;
      return (
        arg.elements[0]?.type === 'Literal' && arg.elements[0].value === 'low' &&
        arg.elements[1]?.type === 'Literal' && arg.elements[1].value === 'medium' &&
        arg.elements[2]?.type === 'Literal' && arg.elements[2].value === 'high'
      );
    });
    assert(zodEnumCall, 'Could not find h.enum(["low","medium","high"]) call');

    const zodRoot = src(zodEnumCall.callee.object);
    editor.insertAt(zodEnumCall.start, `${zodRoot}.union([`);
    editor.insertAt(zodEnumCall.end, `,${zodRoot}.number().int()])`);

    // ── 6. API effort assignment: map number → string ───────────────
    //
    // Source (bundle):
    //   function VdY(q,K,_,z,Y){
    //     if(!Ch(Y)||"effort"in K)return;
    //     if(q===void 0)z.push(HZ1);
    //     else if(typeof q==="string")K.effort=q,z.push(HZ1)
    //   }
    //
    // Prepend a number→string conversion so a numeric appState.effortValue
    // still results in a valid string effort being attached to the API
    // request body. Without this, the `typeof q === "string"` guard would
    // skip the assignment and the API would receive its default effort.
    //
    // Identified structurally: a FunctionDeclaration whose body contains a
    // `"effort" in X` BinaryExpression (unique in the bundle) AND assigns
    // to a MemberExpression with property name "effort".
    const apiEffortFn = findFirst(ast, (n: any) => {
      if (n.type !== 'FunctionDeclaration' || n.params.length < 1) return false;
      const hasInEffort = findFirst(n, (c: any) =>
        c.type === 'BinaryExpression' &&
        c.operator === 'in' &&
        c.left?.type === 'Literal' && c.left.value === 'effort',
      );
      if (!hasInEffort) return false;
      const hasEffortAssign = findFirst(n, (c: any) =>
        c.type === 'AssignmentExpression' &&
        c.left?.type === 'MemberExpression' &&
        c.left.property?.type === 'Identifier' &&
        c.left.property.name === 'effort',
      );
      return hasEffortAssign !== null;
    });
    assert(apiEffortFn, 'Could not find API effort assignment function');

    const apiParam = apiEffortFn.params[0].name;
    editor.insertAt(
      apiEffortFn.body.start + 1,
      `if(typeof ${apiParam}==="number")` +
        `${apiParam}=${apiParam}<=2?"low":${apiParam}<=5?"medium":${apiParam}<=7?"high":"max";`,
    );

    // ── 7. getEffortSuffix: render "N/M effort" in the startup banner ──
    //
    // Source (bundle):
    //   function IV6(q,K){
    //     if(K===void 0)return"";
    //     let _=bV6(q,K);
    //     if(_===void 0)return"";
    //     return ` with ${Rw6(_)} effort`
    //   }
    //
    // Rewrite the template literal so the banner reads
    //   "Opus 4.6 (1M context) with 4/9 effort · Claude Max"
    //   "Sonnet 4.6 with 5/7 effort · Claude Max"          (no max)
    //   "Haiku 4.5 · Claude Max"                            (no effort)
    // instead of the stock "with medium effort" wording.
    //
    // Gating uses the enclosing function's model param. The mirroring of
    // modelSupportsEffort/modelSupportsMaxEffort here is intentionally
    // conservative — we only know the public Claude family, and any
    // unfamiliar model string falls through to the /9 branch (matching
    // stock CC's "default to true on 1P" behavior).
    //
    // Match: a TemplateLiteral whose quasis are exactly [" with ", " effort"]
    // and whose single expression is a call to convertFn (Rw6). There is
    // another template literal in the bundle with the same quasis — the
    // /model picker's "Set model to X with Y effort" toast — but its
    // expression is a chalk.bold(...) call, not a Rw6(...) call, so the
    // callee-name filter disambiguates.
    const convertName = convertFn.id?.name;
    assert(convertName, 'convertEffortValueToLevel must be a named declaration');

    const suffixTmpl = findFirst(ast, (n: any) => {
      if (n.type !== 'TemplateLiteral') return false;
      if (n.quasis.length !== 2 || n.expressions.length !== 1) return false;
      if (n.quasis[0]?.value?.cooked !== ' with ') return false;
      if (n.quasis[1]?.value?.cooked !== ' effort') return false;
      const expr = n.expressions[0];
      return (
        expr?.type === 'CallExpression' &&
        expr.callee?.type === 'Identifier' &&
        expr.callee.name === convertName
      );
    });
    assert(suffixTmpl, 'Could not find getEffortSuffix template literal');

    const suffixFn = ctx.index.enclosingFunction(suffixTmpl);
    assert(
      suffixFn && suffixFn.params.length >= 1,
      'getEffortSuffix enclosing function missing expected model param',
    );
    const modelParam = suffixFn.params[0].name;

    // The expression argument is `_` (the resolveAppliedEffort result).
    // Reuse it directly so the replacement stays in scope.
    const suffixInner = src(suffixTmpl.expressions[0].arguments[0]);
    // IIFE: model + suffixInner → "" | " with N/M effort". Inline because
    // the original site is a single expression returning a string.
    const newSuffixTmpl =
      '(function(_m,_v){' +
        'if(/haiku/i.test(_m))return"";' +
        'var _n=typeof _v==="number"?_v:' +
          '({low:2,medium:5,high:7,max:9})[_v]||5;' +
        'var _M=/opus-4-6/i.test(_m)?9:7;' +
        'if(_n>_M)_n=_M;' +
        'return" with "+_n+"/"+_M+" effort";' +
      '})(' + modelParam + ',' + suffixInner + ')';
    editor.replaceRange(suffixTmpl.start, suffixTmpl.end, newSuffixTmpl);
  },
};

export default patch;
