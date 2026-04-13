/**
 * no-multi-install-warning.test.ts — suppress "Multiple installations found"
 *
 * The patch finds IfStatement nodes whose source contains
 * "Multiple installations found" and replaces them with empty strings.
 * After patching, the marker should be gone from every IfStatement in
 * the bundle.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  parseBundle,
} from '../harness/index.js';
import { walkAST } from '../../src/ast.js';

let patched: string;
let raw: string;

const MARKER = 'Multiple installations found';

beforeAll(() => {
  patched = getIsolatedBundle('no-multi-install-warning').source;
  raw = getRawBundle().source;
});

describe('no-multi-install-warning — static', () => {
  test('raw bundle contains the marker string', () => {
    expect(raw).toContain(MARKER);
  });

  test('patched bundle no longer contains the marker string', () => {
    expect(patched).not.toContain(MARKER);
  });
});

describe('no-multi-install-warning — structural', () => {
  test('raw bundle has at least one IfStatement containing the marker', () => {
    const { ast } = parseBundle(raw);
    let count = 0;
    for (const n of walkAST(ast)) {
      if (n.type !== 'IfStatement') continue;
      if (raw.substring(n.start, n.end).includes(MARKER)) count++;
    }
    expect(count).toBeGreaterThan(0);
  });

  test('patched bundle has no IfStatement containing the marker', () => {
    const { ast } = parseBundle(patched);
    let count = 0;
    for (const n of walkAST(ast)) {
      if (n.type !== 'IfStatement') continue;
      if (patched.substring(n.start, n.end).includes(MARKER)) count++;
    }
    expect(count).toBe(0);
  });
});
