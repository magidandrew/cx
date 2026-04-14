/**
 * auto-detect-theme.test.ts
 *
 * The patch flips the default `theme` literal in createDefaultGlobalConfig
 * from "dark" to "auto". Two complementary checks:
 *
 *  1. EXTRACT: locate the factory by its distinctive `numStartups: 0`
 *     opener, evaluate it, and assert the returned object's `theme` is
 *     "auto" in patched / "dark" in raw. Proves end-to-end behavior —
 *     a fresh install without a saved config would see "auto".
 *
 *  2. STATIC: assert the object-shape counts at the AST level, so we
 *     catch regressions where a future bundle adds a second object with
 *     `theme:"dark"` (the literal also appears in the `/theme` picker
 *     options, but never as a full property inside an object that also
 *     carries `numStartups`).
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  findFunctionContaining,
  findObjectsWithProps,
  evalFunction,
} from '../harness/index.js';
import type { ASTNode } from '../../src/types.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('auto-detect-theme').source;
  raw = getRawBundle().source;
});

// Anchor: the ObjectExpression containing `numStartups: 0`. This appears
// exactly once in the bundle (in createDefaultGlobalConfig's return) so
// the smallest-enclosing-function walk lands on the factory itself.
function extractDefaultConfigFactory(source: string): () => Record<string, any> {
  const fn = findFunctionContaining(source, (n: ASTNode) => {
    if (n.type !== 'Property') return false;
    const p = n as any;
    const keyOk =
      (p.key?.type === 'Identifier' && p.key.name === 'numStartups') ||
      (p.key?.type === 'Literal' && p.key.value === 'numStartups');
    if (!keyOk) return false;
    return p.value?.type === 'Literal' && p.value.value === 0;
  });
  return evalFunction(source, fn);
}

describe('auto-detect-theme', () => {
  test('raw bundle defaults theme to "dark"', () => {
    const factory = extractDefaultConfigFactory(raw);
    const cfg = factory();
    expect(cfg.theme).toBe('dark');
  });

  test('patched bundle defaults theme to "auto"', () => {
    const factory = extractDefaultConfigFactory(patched);
    const cfg = factory();
    expect(cfg.theme).toBe('auto');
  });

  test('patched bundle still ships all the other defaults untouched', () => {
    // Guard-rail: the patch must replace only the `theme` literal —
    // every other property of the factory object should round-trip
    // identically. We compare the raw and patched returns with theme
    // stripped out; they should be deep-equal.
    const rawCfg = extractDefaultConfigFactory(raw)();
    const patchedCfg = extractDefaultConfigFactory(patched)();
    const { theme: _r, ...rawRest } = rawCfg;
    const { theme: _p, ...patchedRest } = patchedCfg;
    expect(patchedRest).toEqual(rawRest);
  });

  test('raw bundle has exactly one default-config object with theme:"dark"', () => {
    // Anchor on the numStartups+theme pair. Only the factory object
    // carries both — if this count ever climbs, the bundle grew a
    // second factory and the patch's uniqueness assumption is broken.
    const matches = findObjectsWithProps(raw, [
      ['numStartups', 0],
      ['theme', 'dark'],
    ]);
    expect(matches.length).toBe(1);
  });

  test('patched bundle has zero objects with numStartups:0 + theme:"dark"', () => {
    const matches = findObjectsWithProps(patched, [
      ['numStartups', 0],
      ['theme', 'dark'],
    ]);
    expect(matches.length).toBe(0);
  });

  test('patched bundle has exactly one default-config object with theme:"auto"', () => {
    // Co-require numStartups so we don't collide with unrelated
    // `theme:"auto"` literals elsewhere (e.g. the picker UI).
    const matches = findObjectsWithProps(patched, [
      ['numStartups', 0],
      ['theme', 'auto'],
    ]);
    expect(matches.length).toBe(1);
  });
});

// ── Read-time override ─────────────────────────────────────────────────────
// defaultInitialTheme() is the zero-arg function that feeds the saved
// config setting into the ThemeProvider. We extract it and drive the
// stubbed getGlobalConfig with different theme values to prove that:
//   raw:     whatever config says, that's what the UI sees
//   patched: 'dark' becomes 'auto' on the way out, other settings pass through
function extractDefaultInitialTheme(
  source: string,
): { fn: () => string; setConfig: (cfg: any) => void } {
  let calleeName: string | null = null;
  const fn = findFunctionContaining(source, (n: ASTNode) => {
    if (n.type !== 'MemberExpression') return false;
    const m = n as any;
    if (m.property?.type !== 'Identifier' || m.property.name !== 'theme') return false;
    if (m.object?.type !== 'CallExpression') return false;
    if ((m.object.arguments ?? []).length !== 0) return false;
    const callee = m.object.callee;
    if (callee?.type !== 'Identifier') return false;
    // Must be inside a zero-arg function whose body is a single return.
    // The harness gives us the enclosing function; we check that here
    // on the callee name since that's what we need to stub anyway.
    calleeName = callee.name;
    return true;
  });
  if (!calleeName) throw new Error('could not resolve getGlobalConfig callee');

  let nextConfig: Record<string, any> = { theme: 'dark' };
  const scope: Record<string, any> = { [calleeName]: () => nextConfig };
  const callable = evalFunction<() => string>(source, fn, { scope });
  return {
    fn: callable,
    setConfig(cfg: any) { nextConfig = cfg; },
  };
}

describe('auto-detect-theme — read-time override', () => {
  test('raw bundle: "dark" config passes through unchanged', () => {
    const { fn, setConfig } = extractDefaultInitialTheme(raw);
    setConfig({ theme: 'dark' });
    expect(fn()).toBe('dark');
  });

  test('patched bundle: "dark" config becomes "auto"', () => {
    const { fn, setConfig } = extractDefaultInitialTheme(patched);
    setConfig({ theme: 'dark' });
    expect(fn()).toBe('auto');
  });

  test('patched bundle: "auto" config stays "auto"', () => {
    const { fn, setConfig } = extractDefaultInitialTheme(patched);
    setConfig({ theme: 'auto' });
    expect(fn()).toBe('auto');
  });

  test('patched bundle: "light" config stays "light" (no collateral damage)', () => {
    const { fn, setConfig } = extractDefaultInitialTheme(patched);
    setConfig({ theme: 'light' });
    expect(fn()).toBe('light');
  });

  test('patched bundle: daltonized variants pass through untouched', () => {
    const { fn, setConfig } = extractDefaultInitialTheme(patched);
    setConfig({ theme: 'dark-daltonized' });
    expect(fn()).toBe('dark-daltonized');
    setConfig({ theme: 'light-daltonized' });
    expect(fn()).toBe('light-daltonized');
  });
});
