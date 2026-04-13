/**
 * always-show-thinking.test.ts
 *
 * The patch replaces the gate `if (!(Y || O))` (the collapsed-view
 * branch in AssistantThinkingMessage) with `if (false)`. We verify
 * by extracting the enclosing function for the "∴ Thinking" literal
 * and scanning for an IfStatement whose test is Literal(false).
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  findFunctionContaining,
  findLiterals,
} from '../harness/index.js';
import type { ASTNode } from '../../src/types.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('always-show-thinking').source;
  raw = getRawBundle().source;
});

describe('always-show-thinking', () => {
  test('"∴ Thinking" marker present in both raw and patched', () => {
    const anchor = '\u2234 Thinking';
    // The anchor's the ONLY stable locator — if upstream renames it,
    // the patch breaks.
    const rawHits = findLiterals(raw, `${anchor} (ctrl+o to expand)`).length;
    // cc-source may use slightly different template, so just check
    // for the raw "∴ Thinking" partial via includes.
    expect(raw.includes(anchor)).toBe(true);
    expect(patched.includes(anchor)).toBe(true);
    void rawHits;
  });

  test('AssistantThinkingMessage contains an `if(false)` IfStatement', () => {
    // Walk every IfStatement inside the enclosing function of the
    // "∴ Thinking" literal and check one has a literal-false test.
    const fn = findFunctionContaining(patched, n =>
      n.type === 'Literal' &&
      typeof (n as any).value === 'string' &&
      (n as any).value.includes('\u2234 Thinking'),
    );

    let found = 0;
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (
        node.type === 'IfStatement' &&
        node.test?.type === 'Literal' &&
        node.test.value === false
      ) {
        found++;
      }
      for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end') continue;
        const v = (node as any)[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(fn);

    expect(found).toBeGreaterThanOrEqual(1);
  });

  test('raw AssistantThinkingMessage does NOT contain an `if(false)` gate', () => {
    // Differential — the collapsed-view gate in the raw bundle uses
    // a real LogicalExpression, not a literal false.
    const fn = findFunctionContaining(raw, n =>
      n.type === 'Literal' &&
      typeof (n as any).value === 'string' &&
      (n as any).value.includes('\u2234 Thinking'),
    );
    let found = 0;
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (
        node.type === 'IfStatement' &&
        node.test?.type === 'Literal' &&
        node.test.value === false
      ) {
        found++;
      }
      for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end') continue;
        const v = (node as any)[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(fn);
    expect(found).toBe(0);
  });
});
