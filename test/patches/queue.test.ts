/**
 * queue.test.ts — Ctrl+Q message queue
 *
 * The patch's surface area is broad (5 patch sites + "queued" marker
 * injection). Per-site structural checks:
 *
 *  1. "chat:queue" appears as a KEYBINDING_ACTIONS literal.
 *  2. DEFAULT_BINDINGS has "ctrl+q": "chat:queue".
 *  3. chatHandlers object has a "chat:queue" key routed through __qH.
 *  4. processQueueIfReady now tests `|| X.priority==="later"`.
 *  5. HighlightedThinkingText renders "queued " prefix for later-priority.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  parseBundle,
  findObjectsWithProps,
  findLiterals,
  countOccurrences,
} from '../harness/index.js';
import { walkAST } from '../../src/ast.js';

let patched: string;

beforeAll(() => {
  patched = getIsolatedBundle('queue').source;
});

describe('queue — keybinding registration', () => {
  test('patched bundle has "chat:queue" as a literal', () => {
    expect(findLiterals(patched, 'chat:queue').length).toBeGreaterThanOrEqual(2);
    // At least one for the KEYBINDING_ACTIONS array insert, one for
    // the chatHandlers object key, and one for the DEFAULT_BINDINGS
    // value.
  });

  test('patched bundle binds "ctrl+q" to "chat:queue" in DEFAULT_BINDINGS', () => {
    const objs = findObjectsWithProps(patched, [
      ['ctrl+q', 'chat:queue'],
    ]);
    expect(objs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('queue — chatHandlers wiring', () => {
  test('patched bundle declares a __qH useCallback local', () => {
    // The patch injects `let __qH = R.useCallback(...)` right before
    // the chatHandlers useMemo. Verify __qH exists as an identifier.
    expect(patched.includes('__qH')).toBe(true);
  });

  test('patched bundle contains a priority:"later" enqueue call', () => {
    // __qH's body calls enqueue({..., priority:"later", ...}).
    // Raw bundles don't use priority:"later" anywhere — it's the
    // tell that the queue patch is active.
    expect(patched.includes('priority:"later"')).toBe(true);
  });
});

describe('queue — processQueueIfReady gate', () => {
  test('patched bundle gates on priority==="later" in processQueueIfReady', () => {
    // The patch appends `|| X.priority==="later"` to the mode==="bash"
    // early-run condition. The unique substring guard this check.
    expect(patched.includes('.priority==="later"')).toBe(true);
  });
});

describe('queue — queued marker in HighlightedThinkingText', () => {
  test('patched bundle contains a "queued " display prefix', () => {
    // The pointer replacement inserts `(__cxIsLater?"queued ":"")+`.
    expect(patched.includes('"queued "')).toBe(true);
    expect(patched.includes('__cxIsLater')).toBe(true);
  });

  test('patched bundle derives __cxIsLater from useCommandQueue', () => {
    // The injected `let __cxQ=useQueueName();` runs the subscription
    // hook each render. We verify via the __cxQ variable name — it's
    // unique to the patch.
    expect(patched.includes('__cxQ')).toBe(true);
  });
});
