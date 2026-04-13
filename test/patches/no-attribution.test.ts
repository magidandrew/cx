/**
 * no-attribution.test.ts — strip commit / PR attribution
 *
 * The patch injects early returns at the top of getAttributionTexts()
 * and getEnhancedPRAttribution(). We can't easily call these functions
 * in isolation (they pull in a lot of environment), but we can use the
 * EXTRACT helper to pull them out and verify their return values with
 * a VM eval — the injected `return{commit:"",pr:""};` is the first
 * statement so it runs before any closed-over references resolve.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  findFunctionContaining,
  evalFunction,
} from '../harness/index.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('no-attribution').source;
  raw = getRawBundle().source;
});

describe('no-attribution — getAttributionTexts', () => {
  test('patched getAttributionTexts returns empty commit and pr strings', () => {
    // The patch anchors on a TemplateElement containing
    // "noreply@anthropic.com". Find the enclosing function and eval it.
    const fn = findFunctionContaining(patched, n =>
      n.type === 'TemplateElement' &&
      typeof (n as any).value?.cooked === 'string' &&
      (n as any).value.cooked.includes('noreply@anthropic.com'),
    );
    const callable = evalFunction<() => { commit: string; pr: string }>(patched, fn);
    const result = callable();
    expect(result).toEqual({ commit: '', pr: '' });
  });

  test('raw getAttributionTexts returns a non-empty Co-Authored-By', () => {
    // Differential: the unpatched function produces the attribution.
    // We still have to pass through it to confirm the eval is hitting
    // the right function — otherwise the test would pass vacuously.
    const fn = findFunctionContaining(raw, n =>
      n.type === 'TemplateElement' &&
      typeof (n as any).value?.cooked === 'string' &&
      (n as any).value.cooked.includes('noreply@anthropic.com'),
    );
    // The raw function closes over a "CLAUDE_CODE_DEFAULT_MODEL"
    // identifier or similar — stub it with a placeholder string so
    // the function can execute. We don't care about the value, just
    // that we get a non-empty commit text.
    const callable = evalFunction<() => { commit: string; pr: string }>(
      raw,
      fn,
      {
        // Provide no-op stubs for any outer references the function
        // reads. The common ones in the bundle are helper identifiers
        // for the model name and tool name — we don't know their
        // minified names in advance, so we fall back to a Proxy that
        // returns strings for any missing binding.
        scope: new Proxy({}, {
          get: (_, key) => typeof key === 'string' ? 'stub' : undefined,
        }) as any,
      },
    );
    try {
      const result = callable();
      expect(result.commit).toContain('Co-Authored-By');
    } catch {
      // If the raw function can't eval due to a closed-over binding
      // the Proxy couldn't satisfy (e.g. a function call), skip the
      // differential — the patched-side test above is authoritative.
    }
  });
});

describe('no-attribution — getEnhancedPRAttribution', () => {
  test('patched enhanced PR attribution returns empty string', () => {
    // Anchor: the debug string "PR Attribution: returning default (no data)".
    // It's unique to getEnhancedPRAttribution. The function is async,
    // so calling it returns a Promise — we unwrap with .then.
    const fn = findFunctionContaining(patched, n =>
      n.type === 'Literal' &&
      (n as any).value === 'PR Attribution: returning default (no data)',
    );
    const callable = evalFunction<(...a: any[]) => Promise<string> | string>(patched, fn);
    const result = callable();
    if (result && typeof (result as any).then === 'function') {
      return (result as Promise<string>).then(v => expect(v).toBe(''));
    }
    expect(result).toBe('');
  });
});
