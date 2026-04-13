/**
 * cx-resume-commands.test.ts — hint strings point at cx
 *
 * The patch rewrites every `claude --continue`, `claude --resume`, and
 * `claude -p --resume` substring in the bundle to the `cx ...` form.
 * This is a pure string-replacement patch, so static checks are
 * sufficient: the patched bundle should contain the cx forms and the
 * raw bundle should contain the claude forms — and neither should
 * mix-and-match (i.e. we shouldn't have left any stragglers behind).
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  countOccurrences,
  parseBundle,
} from '../harness/index.js';
import { walkAST } from '../../src/ast.js';

/**
 * Count TemplateLiteral adjacency pairs where one chunk ends in
 * "claude " and the next begins with "--resume" or "--continue".
 * Template literals with an interpolation (e.g. `claude ${worktreeFlag}--resume ${id}`)
 * split the literal `claude --resume` across two TemplateElement nodes,
 * so substring scans miss them.
 *
 * In the RAW 2.1.101 bundle this returns 1 (the shutdown hint —
 * worktree slot between "claude " and "--resume"). After the
 * cx-resume-commands patch runs, it MUST return 0 — otherwise the
 * hint that the user sees still reads "claude --resume …".
 */
function countSplitAdjacencyPairs(source: string): number {
  const { ast } = parseBundle(source);
  let n = 0;
  for (const node of walkAST(ast)) {
    if (node.type !== 'TemplateLiteral') continue;
    const quasis = (node as any).quasis;
    if (!Array.isArray(quasis)) continue;
    for (let i = 0; i < quasis.length - 1; i++) {
      const aRaw: unknown = quasis[i]?.value?.raw;
      const bRaw: unknown = quasis[i + 1]?.value?.raw;
      if (typeof aRaw !== 'string' || typeof bRaw !== 'string') continue;
      if (!aRaw.endsWith('claude ')) continue;
      if (!/^(?:--resume|--continue)\b/.test(bRaw)) continue;
      n++;
    }
  }
  return n;
}

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('cx-resume-commands').source;
  raw = getRawBundle().source;
});

describe('cx-resume-commands — forward rewrites', () => {
  test('patched bundle contains cx --continue', () => {
    expect(countOccurrences(patched, 'cx --continue')).toBeGreaterThan(0);
  });

  test('patched bundle contains cx --resume', () => {
    expect(countOccurrences(patched, 'cx --resume')).toBeGreaterThan(0);
  });

  test('patched bundle contains cx -p --resume', () => {
    expect(countOccurrences(patched, 'cx -p --resume')).toBeGreaterThan(0);
  });
});

describe('cx-resume-commands — differential', () => {
  test('raw bundle contains the claude forms to begin with', () => {
    // Baseline sanity: if these are gone upstream, the patch has
    // nothing to rewrite and should fail assert() at apply time.
    expect(countOccurrences(raw, 'claude --continue')).toBeGreaterThan(0);
    expect(countOccurrences(raw, 'claude --resume')).toBeGreaterThan(0);
  });

  test('patched bundle replaces every claude --continue occurrence', () => {
    // There should be at least as many cx --continue as there were
    // claude --continue in the raw. We don't require exact parity
    // because the patch replaces substrings inside larger strings
    // and the new strings might contain different surrounding chars.
    const rawCount = countOccurrences(raw, 'claude --continue');
    const patchedCount = countOccurrences(patched, 'cx --continue');
    expect(patchedCount).toBeGreaterThanOrEqual(rawCount);
  });

  test('no bare "claude --continue" substrings remain in the patched bundle', () => {
    // The patch rewrites *all* matches, not just some. If this fires,
    // the replacement missed a site (new string template, split across
    // bundle chunks, etc.) and users would see mixed hints.
    expect(patched.includes('claude --continue')).toBe(false);
    expect(patched.includes('claude --resume')).toBe(false);
  });
});

describe('cx-resume-commands — split template literals (regression guard)', () => {
  // claude-code 2.1.101 rewrote the shutdown hint as
  //   `Resume this session with:\nclaude ${Y}--resume ${_}\n`
  // which splits the `claude --resume` literal across two
  // TemplateElement nodes. A substring scan can't see it because the
  // bytes `claude --resume` never appear contiguously in the source.
  // cx-resume-commands fixed this by walking TemplateLiteral quasis
  // pairwise and rewriting the trailing "claude " in the first chunk.
  //
  // These tests exist to catch that regression if anyone ever drops
  // the adjacent-pair pass. They check the AST shape directly rather
  // than byte-level substrings.

  test('raw bundle has at least one split "claude " / "--resume|--continue" pair', () => {
    // If upstream stops using a worktree interpolation in the hint
    // this becomes 0 and the test goes soft — intentional. The point
    // is to catch regressions against the bundle we patch today.
    expect(countSplitAdjacencyPairs(raw)).toBeGreaterThanOrEqual(1);
  });

  test('patched bundle has zero split adjacency pairs', () => {
    // If this fails, the adjacent-pair pass of the patch is broken
    // and the shutdown hint still reads "claude --resume ..." at
    // runtime, even though the substring tests above all pass.
    // That exact situation was the 2.1.101 regression.
    expect(countSplitAdjacencyPairs(patched)).toBe(0);
  });
});
