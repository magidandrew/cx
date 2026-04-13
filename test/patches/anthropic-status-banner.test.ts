/**
 * anthropic-status-banner.test.ts
 *
 * The patch injects a module-scope function declaration named
 * `_cxStatusBanner` and inserts a createElement reference to it as
 * a column child of PromptInputFooterLeftSide. We verify both via
 * AST/string checks — actually running the polling UI needs Ink.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  parseBundle,
  countOccurrences,
} from '../harness/index.js';
import { walkAST } from '../../src/ast.js';

let patched: string;

beforeAll(() => {
  patched = getIsolatedBundle('anthropic-status-banner').source;
});

describe('anthropic-status-banner', () => {
  test('patched bundle contains a function declaration named _cxStatusBanner', () => {
    const { ast } = parseBundle(patched);
    let found = false;
    for (const n of walkAST(ast)) {
      if (n.type !== 'FunctionDeclaration') continue;
      if ((n as any).id?.name === '_cxStatusBanner') {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test('patched bundle references _cxStatusBanner in a createElement call', () => {
    // The injection point is `,createElement(_cxStatusBanner, {…})`.
    // The exact substring `_cxStatusBanner` as an identifier only
    // appears via our injection.
    expect(countOccurrences(patched, '_cxStatusBanner')).toBeGreaterThanOrEqual(2);
    // ≥2 because the declaration itself is one occurrence, and at
    // least one reference from a createElement call.
  });

  test('patched bundle queries status.claude.com', () => {
    // The polling function fetches summary.json. The URL is
    // deliberately unique and makes it grep-verifiable.
    expect(patched.includes('status.claude.com')).toBe(true);
  });
});
