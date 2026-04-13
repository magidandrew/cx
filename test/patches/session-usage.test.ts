/**
 * session-usage.test.ts
 *
 * The patch has many sub-edits; most are hard to call in isolation
 * because they rely on React hooks, the Notifications queue, and a
 * real token-limit response. We cover regression via structural
 * checks: the key strings it injects and the module-scope ticker.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { getIsolatedBundle, getRawBundle } from '../harness/index.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('session-usage').source;
  raw = getRawBundle().source;
});

describe('session-usage', () => {
  test('raw bundle has the "Context low" anchor', () => {
    expect(raw.includes('Context low')).toBe(true);
  });

  test('patched bundle softens "Context low" to "Context"', () => {
    // The patch does not drop "Context low" from the bundle entirely —
    // it may still be referenced from TokenWarning's dead code path.
    // But the patched display should say "Context used" (with the
    // extra wording) rather than the unqualified "Context low".
    // Just check the softened "Context used" marker the patch adds.
    expect(patched.includes('context used')).toBe(true);
  });

  test('patched bundle contains "session used" label', () => {
    // The indicator format is "N% session used · N% context used".
    // The "session used" literal is a unique tell.
    expect(patched.includes('session used')).toBe(true);
  });

  test('patched bundle contains the "session resets in" flash template', () => {
    // Every 7 seconds the display flashes to reset time. The template
    // includes "session resets in" — unique to the patch.
    expect(patched.includes('session resets in')).toBe(true);
  });
});
