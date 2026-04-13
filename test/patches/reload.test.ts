/**
 * reload.test.ts — Ctrl+X Ctrl+R reload keybinding
 *
 * The patch makes three structural edits:
 *  1. KEYBINDING_ACTIONS array gets "chat:reload" appended.
 *  2. DEFAULT_BINDINGS object gets "ctrl+x ctrl+r": "chat:reload".
 *  3. chatHandlers useMemo gets a __rH useCallback that exits with 75,
 *     and "chat:reload" is routed to it.
 *
 * Each edit is verifiable from the patched source alone.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  parseBundle,
  findObjectsWithProps,
} from '../harness/index.js';
import { walkAST } from '../../src/ast.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('reload').source;
  raw = getRawBundle().source;
});

describe('reload — KEYBINDING_ACTIONS', () => {
  test('raw bundle contains a chat:submit/chat:newline array but no chat:reload', () => {
    // Scan for the ArrayExpression holding the known action strings.
    const { ast } = parseBundle(raw);
    let found = false;
    for (const n of walkAST(ast)) {
      if (n.type !== 'ArrayExpression') continue;
      const vals = (n as any).elements
        .filter((e: any) => e?.type === 'Literal')
        .map((e: any) => e.value);
      if (vals.includes('chat:submit') && vals.includes('chat:newline')) {
        found = true;
        expect(vals).not.toContain('chat:reload');
      }
    }
    expect(found).toBe(true);
  });

  test('patched bundle adds "chat:reload" to the actions array', () => {
    const { ast } = parseBundle(patched);
    let found = false;
    for (const n of walkAST(ast)) {
      if (n.type !== 'ArrayExpression') continue;
      const vals = (n as any).elements
        .filter((e: any) => e?.type === 'Literal')
        .map((e: any) => e.value);
      if (vals.includes('chat:submit') && vals.includes('chat:reload')) {
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});

describe('reload — DEFAULT_BINDINGS', () => {
  test('patched bundle has "ctrl+x ctrl+r" bound to "chat:reload"', () => {
    const objs = findObjectsWithProps(patched, [
      ['ctrl+x ctrl+r', 'chat:reload'],
    ]);
    expect(objs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('reload — chatHandlers', () => {
  test('patched bundle contains a process.exit(75) call', () => {
    // The __rH useCallback is `()=>{process.exit(75)}`. Scan for a
    // CallExpression on process.exit with a literal 75 argument.
    const { ast } = parseBundle(patched);
    let found = false;
    for (const n of walkAST(ast)) {
      if (n.type !== 'CallExpression') continue;
      const callee = (n as any).callee;
      if (
        callee?.type === 'MemberExpression' &&
        callee.object?.type === 'Identifier' &&
        callee.object.name === 'process' &&
        callee.property?.name === 'exit' &&
        (n as any).arguments?.[0]?.type === 'Literal' &&
        (n as any).arguments[0].value === 75
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test('raw bundle does NOT contain process.exit(75)', () => {
    // Differential — this exit code is unique to the reload patch.
    const { ast } = parseBundle(raw);
    let found = false;
    for (const n of walkAST(ast)) {
      if (n.type !== 'CallExpression') continue;
      const callee = (n as any).callee;
      if (
        callee?.type === 'MemberExpression' &&
        callee.object?.type === 'Identifier' &&
        callee.object.name === 'process' &&
        callee.property?.name === 'exit' &&
        (n as any).arguments?.[0]?.type === 'Literal' &&
        (n as any).arguments[0].value === 75
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(false);
  });
});
