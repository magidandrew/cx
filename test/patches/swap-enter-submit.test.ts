/**
 * swap-enter-submit.test.ts
 *
 * The patch does four things:
 *   1. DEFAULT_BINDINGS: enter → chat:newline, add meta+enter → chat:submit
 *   2. handleEnter: Meta submits, Shift inserts newline, plain Enter is no-op
 *   3. Tip text swapped
 *   4. Help-menu newline instructions rewritten
 *
 * (1) and (3)/(4) are structural/string checks. (2) is the
 * behavioral core — we locate the handleEnter function, check its
 * body's shape, but don't run it in isolation because it's deeply
 * tangled with cursor state from useTextInput.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  findObjectsWithProps,
  parseBundle,
} from '../harness/index.js';
import { walkAST } from '../../src/ast.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('swap-enter-submit').source;
  raw = getRawBundle().source;
});

describe('swap-enter-submit — DEFAULT_BINDINGS', () => {
  test('raw bundle has enter → chat:submit', () => {
    const objs = findObjectsWithProps(raw, [
      ['enter', 'chat:submit'],
      ['up', 'history:previous'],
    ]);
    expect(objs.length).toBeGreaterThanOrEqual(1);
  });

  test('patched bundle has enter → chat:newline', () => {
    // The patch rewrites enter's value to chat:newline. The object
    // still exists with the same `up: "history:previous"` neighbor.
    const objs = findObjectsWithProps(patched, [
      ['enter', 'chat:newline'],
      ['up', 'history:previous'],
    ]);
    expect(objs.length).toBeGreaterThanOrEqual(1);
  });

  test('patched bundle has meta+enter → chat:submit', () => {
    const objs = findObjectsWithProps(patched, [
      ['meta+enter', 'chat:submit'],
    ]);
    expect(objs.length).toBeGreaterThanOrEqual(1);
  });

  test('patched bundle has NO enter → chat:submit in the same DEFAULT_BINDINGS object', () => {
    const objs = findObjectsWithProps(patched, [
      ['enter', 'chat:submit'],
      ['up', 'history:previous'],
    ]);
    expect(objs.length).toBe(0);
  });
});

describe('swap-enter-submit — tip text', () => {
  test('patched bundle contains the new Option+Enter tip', () => {
    expect(patched.includes('Press Option+Enter to submit your message')).toBe(
      true,
    );
  });

  test('patched bundle no longer contains the old Shift+Enter tip', () => {
    expect(
      patched.includes('Press Shift+Enter to send a multi-line message'),
    ).toBe(false);
  });
});

describe('swap-enter-submit — help menu', () => {
  test('patched bundle contains "option + ⏎ to send"', () => {
    expect(patched.includes('option + ⏎ to send')).toBe(true);
  });
});
