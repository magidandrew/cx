/**
 * remote-control-default-on.test.ts
 *
 * Behaviour test for the getRemoteControlAtStartup flip.
 *
 *   raw:     returns false when config has no remoteControlAtStartup set
 *   patched: returns true in the same situation
 *   both:    explicit true/false still wins over the default
 *
 * We anchor the function via the unique `.remoteControlAtStartup`
 * member-access whose object is a CallExpression — that shape is
 * only used by getRemoteControlAtStartup itself (every other site in
 * the bundle reads it off a parameter or destructure, see the patch
 * comment for the enumeration).
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  findFunctionContaining,
  evalFunction,
} from '../harness/index.js';
import type { ASTNode } from '../../src/types.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('remote-control-default-on').source;
  raw = getRawBundle().source;
});

function extractGetRemoteControl(source: string): (cfg?: any) => boolean {
  // First pick out the `getGlobalConfig().remoteControlAtStartup` read
  // so we know both the enclosing function AND the minified callee
  // name to stub. The stub returns whatever config we hand it per call.
  let calleeName: string | null = null;
  const fn = findFunctionContaining(source, (n: ASTNode) => {
    if (n.type !== 'MemberExpression') return false;
    const m = n as any;
    if (m.property?.type !== 'Identifier' || m.property.name !== 'remoteControlAtStartup') return false;
    if (m.object?.type !== 'CallExpression') return false;
    const callee = m.object.callee;
    if (callee?.type !== 'Identifier') return false;
    calleeName = callee.name;
    return true;
  });
  if (!calleeName) throw new Error('could not resolve getGlobalConfig callee');

  // One closure variable that each invocation rewrites before calling.
  let nextConfig: Record<string, any> = {};
  const scope: Record<string, any> = {
    [calleeName]: () => nextConfig,
  };
  const callable = evalFunction<() => boolean>(source, fn, { scope });
  return (cfg?: any) => {
    nextConfig = cfg ?? {};
    return callable();
  };
}

describe('remote-control-default-on', () => {
  test('raw bundle: default (no explicit setting) returns false', () => {
    const fn = extractGetRemoteControl(raw);
    expect(fn({})).toBe(false);
  });

  test('patched bundle: default (no explicit setting) returns true', () => {
    const fn = extractGetRemoteControl(patched);
    expect(fn({})).toBe(true);
  });

  test('patched bundle: explicit `false` still wins', () => {
    const fn = extractGetRemoteControl(patched);
    expect(fn({ remoteControlAtStartup: false })).toBe(false);
  });

  test('patched bundle: explicit `true` still returns true', () => {
    const fn = extractGetRemoteControl(patched);
    expect(fn({ remoteControlAtStartup: true })).toBe(true);
  });
});
