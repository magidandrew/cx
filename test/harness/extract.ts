/**
 * test/harness/extract.ts
 *
 * Function extraction: pull a specific FunctionDeclaration out of the
 * patched bundle and turn it into something a test can actually call.
 *
 * This is how we verify EXTRACT-bucket patches — patches that modify a
 * pure-ish function (cycleEffortLevel, toPersistableEffort, kebab-case
 * in auto-rename, etc.) The test locates the function by structural
 * shape, gets its source text, rewrites it to be callable in isolation,
 * and evals it in a Node `vm` sandbox with stubs for any outer-scope
 * references.
 *
 * Why not just require() the patched cli.js and grab the export?
 * Because the bundle is minified and re-namespaced — there's no stable
 * export surface. Every helper is an internal binding with a
 * minification-generated name. We have to surgically lift the function
 * out of the AST, not import it.
 */

import * as vm from 'vm';
import * as acorn from 'acorn';
import type { ASTNode } from '../../src/types.js';
import { parseBundle } from './ast-helpers.js';
import { walkAST } from '../../src/ast.js';

const FUNC_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

// ── Locate a function by structural predicate ─────────────────────────────

/**
 * Return the single function node in the bundle matching `predicate`.
 * Throws if zero or more than one match — the test's predicate is
 * assumed to be unique, so ambiguity is a test bug we want to surface
 * loudly rather than silently picking the wrong one.
 */
export function findUniqueFunction(
  source: string,
  predicate: (node: ASTNode) => boolean,
): ASTNode {
  const { ast } = parseBundle(source);
  const matches: ASTNode[] = [];
  for (const n of walkAST(ast)) {
    if (!FUNC_TYPES.has(n.type)) continue;
    if (predicate(n)) matches.push(n);
  }
  if (matches.length === 0) {
    throw new Error('findUniqueFunction: no matches');
  }
  if (matches.length > 1) {
    throw new Error(
      `findUniqueFunction: expected 1 match, got ${matches.length} — predicate is not specific enough`,
    );
  }
  return matches[0];
}

/**
 * Find the innermost function that encloses the FIRST AST node in the
 * bundle matching `anchorPredicate`. This is the "anchor + walk up"
 * pattern: the test picks a cheap-to-locate anchor (a unique literal,
 * a distinctive BinaryExpression, etc.), and the helper walks up the
 * parent chain until it hits a function boundary.
 *
 * This is usually what you want for EXTRACT tests — picking the anchor
 * is much easier than writing a predicate for the whole function, and
 * "smallest enclosing function" disambiguates automatically.
 */
export function findFunctionContaining(
  source: string,
  anchorPredicate: (n: ASTNode) => boolean,
): ASTNode {
  const { ast, index } = parseBundle(source);
  let anchor: ASTNode | null = null;
  for (const n of walkAST(ast)) {
    if (anchorPredicate(n)) {
      anchor = n;
      break;
    }
  }
  if (!anchor) throw new Error('findFunctionContaining: no anchor match');

  let cur: ASTNode | undefined = anchor;
  while (cur) {
    const parent: ASTNode | undefined = (index as any).parentMap.get(cur);
    if (!parent) break;
    if (FUNC_TYPES.has(parent.type)) return parent;
    cur = parent;
  }
  throw new Error('findFunctionContaining: no enclosing function');
}

/**
 * Pull the text of a function out of the bundle, turned into an
 * expression we can assign to a variable. FunctionDeclarations get
 * prefixed with an empty comment to keep them as statements until we
 * wrap them; FunctionExpressions/Arrows are already expressions.
 */
function functionText(source: string, node: ASTNode): string {
  return source.slice(node.start, node.end);
}

// ── Evaluation in a sandbox ──────────────────────────────────────────────

export interface EvalOptions {
  /**
   * Outer-scope identifiers the function closes over. Each key becomes
   * a local binding inside the sandbox. Use to stub minified helpers
   * (e.g. { Rw6: (x: any) => x, HZ1: 'effort_tag' }) — the test is
   * responsible for figuring out what to pass by reading the
   * surrounding source if needed.
   */
  scope?: Record<string, any>;
  /**
   * When true, the sandbox context itself is a Proxy that answers
   * every unknown identifier lookup with a safe stub (a function
   * returning undefined). Use for messy functions that close over
   * many minified helpers we can't enumerate. Specific bindings in
   * `scope` take precedence over the fallback.
   *
   * Don't use this for correctness-sensitive tests — stubbing every
   * unknown call means the function's real logic is bypassed. It's
   * mostly useful to prove "the patched version reaches `return null`
   * without throwing".
   */
  fallbackStub?: boolean;
  /**
   * Timeout for the sandbox eval. Default is aggressive since these
   * functions should be synchronous and fast — a hanging eval
   * indicates an infinite loop introduced by a broken patch.
   */
  timeoutMs?: number;
}

/**
 * Build a vm context that answers every identifier lookup. The base
 * keys the test explicitly passed get first crack; anything else
 * returns a do-nothing function that always resolves to undefined.
 * vm's context-as-Proxy support makes this work — reads and writes
 * on the "global" of the sandbox both funnel through the Proxy.
 */
function makeFallbackContext(base: Record<string, any>): any {
  const stub = () => undefined;
  const overrides: Record<string, any> = { ...base };
  return new Proxy(overrides, {
    has: () => true,
    get(target, key) {
      if (key in target) return target[key as string];
      if (typeof key === 'symbol') return undefined;
      // Everything else becomes a callable that returns undefined.
      // Property reads on the stub (e.g. X.default) also return the
      // stub via the next Proxy tier.
      return stubProxy();
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  });
}

function stubProxy(): any {
  const fn: any = () => stubProxy();
  return new Proxy(fn, {
    get(_, key) {
      if (key === Symbol.toPrimitive) return () => '';
      if (key === 'then') return undefined; // avoid accidental Promise detection
      return stubProxy();
    },
    apply() {
      return stubProxy();
    },
  });
}

/**
 * Eval a function node as a callable and return it. Tests can then
 * invoke it like any other function, with real inputs and assertions
 * on the return value.
 *
 * Implementation: we build a tiny JS program that declares all the
 * scope stubs as `let` bindings, then the function, then returns a
 * reference to it. Running it under `vm.runInNewContext` gives us a
 * real Function we can call from the host side.
 */
export function evalFunction<F extends (...a: any[]) => any>(
  source: string,
  node: ASTNode,
  opts: EvalOptions = {},
): F {
  const body = functionText(source, node);
  const scope = opts.scope ?? {};
  const program =
    `var __fn = (${body});\n` +
    `__fn;`;

  let context: any;
  if (opts.fallbackStub) {
    // Proxy-as-sandbox: every free identifier in the function body
    // is resolved through the Proxy, which returns a callable stub
    // for anything the test didn't explicitly provide.
    context = makeFallbackContext(scope);
  } else {
    // Plain sandbox: the test is responsible for naming every
    // closed-over identifier it cares about, and unknown ones will
    // ReferenceError — which is exactly what we want for strict
    // correctness tests.
    context = { ...scope };
  }
  vm.createContext(context);
  const fn = vm.runInContext(program, context, {
    timeout: opts.timeoutMs ?? 1000,
  });
  if (typeof fn !== 'function') {
    throw new Error('evalFunction: extracted node did not eval to a function');
  }
  return fn as F;
}

/**
 * Eval an arbitrary expression from the bundle source. Used for things
 * like extracting an object literal or array — passed by slicing
 * `source.slice(node.start, node.end)` — and running it under scope
 * stubs to get a real runtime value.
 *
 * Two shapes are supported:
 *
 *  1. Plain object scope — each key becomes a `var k = value;` line in
 *     the sandbox, then the expression evaluates. Use when the caller
 *     knows exactly which identifiers to stub.
 *
 *  2. Proxy scope — the passed object is used directly as the vm
 *     context, so every bare identifier in the expression resolves
 *     through the Proxy. Use when the caller doesn't know which
 *     helpers the expression will reach for. Detected automatically
 *     by `util.types.isProxy` via a sentinel flag, or explicitly via
 *     the `proxy` option.
 */
export function evalExpression<T = unknown>(
  text: string,
  scope: Record<string, any> = {},
  timeoutMs = 1000,
): T {
  // Heuristic: if the caller passed a Proxy (has() trap returns true
  // for every key), use the context-as-sandbox path. We detect via a
  // round-trip: ask for a non-standard Symbol key and see if the
  // Proxy answered or it came back genuinely undefined.
  const looksLikeProxy = (() => {
    try {
      const probe = Symbol('__cx_probe__');
      return scope && (probe as any) in scope;
    } catch {
      return false;
    }
  })();

  if (looksLikeProxy) {
    // The Proxy itself is the context. vm will use its has/get traps
    // for every identifier lookup in the evaluated code.
    vm.createContext(scope as any);
    return vm.runInContext(`(${text})`, scope as any, {
      timeout: timeoutMs,
    }) as T;
  }

  const scopeKeys = Object.keys(scope);
  const program =
    scopeKeys.map(k => `var ${k} = __scope[${JSON.stringify(k)}];`).join('\n') +
    '\n' +
    `(${text});`;
  const context: Record<string, any> = { __scope: scope };
  vm.createContext(context);
  return vm.runInContext(program, context, { timeout: timeoutMs }) as T;
}

// ── Convenience: find top-level CallExpression inside a function ──────────

/**
 * Collect every CallExpression in a subtree whose callee is an
 * Identifier with the given name. Useful after extracting a function
 * to audit which helpers it references — the test then knows what to
 * stub in `scope`.
 */
export function callsInside(
  subtree: ASTNode,
  calleeName: string,
): ASTNode[] {
  const out: ASTNode[] = [];
  for (const n of walkAST(subtree)) {
    if (
      n.type === 'CallExpression' &&
      (n as any).callee?.type === 'Identifier' &&
      (n as any).callee.name === calleeName
    ) {
      out.push(n);
    }
  }
  return out;
}

/**
 * Parse a snippet of JS source and return its top-level ExpressionStatement
 * expression. Used by tests that want to pass a predicate to
 * findUniqueFunction but start from a source string.
 */
export function parseExpression(text: string): ASTNode {
  const ast = acorn.parse(text, { ecmaVersion: 'latest' }) as any;
  return ast.body[0].expression as ASTNode;
}
