/**
 * no-feedback.test.ts — FeedbackSurvey returns null
 *
 * The patch injects `return null;` as the first statement of
 * FeedbackSurvey. Any subsequent survey logic still exists as dead
 * code but never runs. We verify by extracting the function and
 * calling it — it should return null regardless of arguments.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  findFunctionContaining,
  evalFunction,
  findLiterals,
} from '../harness/index.js';

let patched: string;

const MARKER = ' Thanks for sharing your transcript!';

beforeAll(() => {
  patched = getIsolatedBundle('no-feedback').source;
});

describe('no-feedback', () => {
  test('marker literal still present (we only inject, never remove)', () => {
    // The patch inserts `return null;` — it doesn't strip existing
    // code. The marker survives in the dead branch.
    expect(findLiterals(patched, MARKER).length).toBeGreaterThan(0);
  });

  test('FeedbackSurvey returns null when called', () => {
    // Anchor on the marker literal, walk to enclosing function.
    // Component takes props and closes over React — use fallbackStub.
    const fn = findFunctionContaining(patched, n =>
      n.type === 'Literal' && (n as any).value === MARKER,
    );
    const callable = evalFunction<(props?: any) => any>(patched, fn, {
      fallbackStub: true,
    });
    expect(callable({})).toBe(null);
    // Calling with other shapes of props should also return null —
    // the injected early return ignores its argument entirely.
    expect(callable(undefined)).toBe(null);
    expect(callable({ feedbackId: 'x', sessionId: 'y' })).toBe(null);
  });
});
