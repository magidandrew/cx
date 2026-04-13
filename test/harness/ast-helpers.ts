/**
 * test/harness/ast-helpers.ts
 *
 * Parse-once AST utilities for assertions over patched bundles.
 *
 * The raw-string "does the patched source contain X" check is cheap
 * but fragile — it can't distinguish a literal inside a comment from
 * the real thing, and it doesn't let us assert structural edits like
 * "there are exactly 4 max-effort array literals now." These helpers
 * re-parse the patched bundle so tests can make precise claims.
 *
 * We cache parsed ASTs by source-string key with a bounded LRU. An AST
 * of the 13MB minified cli.js pulls in hundreds of MB of node objects
 * plus the ASTIndex.allNodes flat array — if the cache were unbounded,
 * running ~30 test files with different patched bundles would retain
 * every AST for the life of the bun process, which is how we ended up
 * at 8–15 GB RSS. With `bun test --max-concurrency=1` files run
 * serially, so an LRU of 2 fits "raw + the patched bundle" per file
 * and evicts the previous file's patched AST on the way in.
 */

import * as acorn from 'acorn';
import { ASTIndex, walkAST } from '../../src/ast.js';
import type { ASTNode } from '../../src/types.js';

// Each test file typically parses at most two bundles: `raw` (shared
// across all files, so re-reads cache-hit) plus its own patched bundle.
// LRU=2 holds both without thrash — when the next file brings in its
// own patched bundle, the previous file's patched AST gets evicted while
// `raw` stays warm because it's re-accessed on every file that touches it.
const MAX_PARSED = 2;
const _parseCache = new Map<string, { ast: ASTNode; index: ASTIndex }>();

function parsedFor(source: string): { ast: ASTNode; index: ASTIndex } {
  const hit = _parseCache.get(source);
  if (hit) {
    _parseCache.delete(source);
    _parseCache.set(source, hit);
    return hit;
  }
  const ast = acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true,
  }) as unknown as ASTNode;
  const index = new ASTIndex(ast);
  const entry = { ast, index };
  _parseCache.set(source, entry);
  while (_parseCache.size > MAX_PARSED) {
    const oldest = _parseCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    _parseCache.delete(oldest);
  }
  return entry;
}

/**
 * Return the parsed AST for a bundle source. Memoized — safe to call
 * many times from different tests over the same bundle.
 */
export function parseBundle(source: string): { ast: ASTNode; index: ASTIndex } {
  return parsedFor(source);
}

// ── String presence ───────────────────────────────────────────────────────

/**
 * Count occurrences of a raw substring. Use when you want to verify
 * something like "the banner now appears exactly once" — a simple
 * `includes` would silently miss a duplicate-injection bug.
 */
export function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let idx = source.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = source.indexOf(needle, idx + needle.length);
  }
  return count;
}

// ── Literal-based queries ─────────────────────────────────────────────────

/** All Literal nodes whose value matches `value` (deep-equal for primitives). */
export function findLiterals(source: string, value: string | number | boolean): ASTNode[] {
  const { index } = parsedFor(source);
  return index.literalsByValue.get(value as any) ?? [];
}

export function hasLiteral(source: string, value: string | number | boolean): boolean {
  return findLiterals(source, value).length > 0;
}

// ── Generic shape queries ─────────────────────────────────────────────────

/**
 * Return every ArrayExpression whose first `prefix.length` element
 * values match `prefix`. Useful for finding the SPINNER_VERBS / EFFORT
 * arrays after a patch has edited them — we can assert the array is
 * shaped exactly like we expect without depending on bundle-order.
 */
export function findArraysStartingWith(
  source: string,
  prefix: (string | number | boolean)[],
): ASTNode[] {
  const { ast } = parsedFor(source);
  const out: ASTNode[] = [];
  for (const n of walkAST(ast)) {
    if (n.type !== 'ArrayExpression') continue;
    if (n.elements.length < prefix.length) continue;
    let match = true;
    for (let i = 0; i < prefix.length; i++) {
      const el = n.elements[i];
      if (!el || el.type !== 'Literal' || el.value !== prefix[i]) {
        match = false;
        break;
      }
    }
    if (match) out.push(n);
  }
  return out;
}

/**
 * Return every ObjectExpression that has *all* the requested key/value
 * pairs as literal Property entries. `value === undefined` matches any
 * value for that key (useful for "contains a property named X at all").
 */
export function findObjectsWithProps(
  source: string,
  requirements: Array<[string, (string | number | boolean) | undefined]>,
): ASTNode[] {
  const { ast } = parsedFor(source);
  const out: ASTNode[] = [];
  for (const n of walkAST(ast)) {
    if (n.type !== 'ObjectExpression') continue;
    let ok = true;
    for (const [k, v] of requirements) {
      const prop = (n as any).properties.find(
        (p: any) =>
          p.type === 'Property' &&
          ((p.key.type === 'Identifier' && p.key.name === k) ||
            (p.key.type === 'Literal' && p.key.value === k)),
      );
      if (!prop) {
        ok = false;
        break;
      }
      if (v !== undefined) {
        if (prop.value?.type !== 'Literal' || prop.value.value !== v) {
          ok = false;
          break;
        }
      }
    }
    if (ok) out.push(n);
  }
  return out;
}

/**
 * Extract the source text of a node from its containing bundle. Tests
 * use this when they want to grep a subtree — e.g. "the chatHandlers
 * object must reference __rH somewhere". It's a simple substring read.
 */
export function srcOf(source: string, node: ASTNode): string {
  return source.slice(node.start, node.end);
}
