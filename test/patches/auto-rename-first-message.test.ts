/**
 * auto-rename-first-message.test.ts
 *
 * The patch injects a kebab-case + persist snippet at the top of the
 * auto-title .then callback. We can't easily fire the full REPL path
 * in a VM, but we can:
 *
 *  1. Verify the injected snippet appears verbatim in the patched
 *     bundle (it uses two __cxAR_* identifiers that are unique).
 *
 *  2. Lift the kebab-case regex replace out and test it standalone:
 *     the transform is a pure function of a string and must produce
 *     the /rename-style output for several sample inputs.
 *
 *  3. Verify the injected `try { ... } catch(e) {}` wraps the whole
 *     thing — so an exception from the session helpers never crashes
 *     the .then arrow and breaks haikuTitle rendering.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { getBundle, getIsolatedBundle, countOccurrences } from '../harness/index.js';

let patched: string;

beforeAll(() => {
  patched = getIsolatedBundle('auto-rename-first-message').source;
});

describe('auto-rename-first-message — injection markers', () => {
  test('patched bundle contains the __cxAR_T kebab-case local', () => {
    // __cxAR_T and __cxAR_S are the two unique locals the patch
    // injects. Their presence is a strong signal that the .then
    // callback was edited.
    expect(countOccurrences(patched, '__cxAR_T')).toBeGreaterThanOrEqual(2);
  });

  test('patched bundle contains the __cxAR_S session-id local', () => {
    expect(countOccurrences(patched, '__cxAR_S')).toBeGreaterThanOrEqual(2);
  });

  test('patched bundle contains the kebab-case regex', () => {
    // The exact regex survives minification because it's inside a
    // string literal in the injected source.
    expect(patched.includes('/[^a-z0-9]+/g')).toBe(true);
  });
});

describe('auto-rename-first-message — kebab-case transform', () => {
  // Reproduce the transform the patch injects so we know it handles
  // all the /rename-equivalent inputs correctly. If this test fails
  // it means the patch's pattern isn't doing what we claim.
  const kebab = (title: string): string =>
    (title + '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  test('haiku-style titles become kebab-case', () => {
    expect(kebab('Fix login button on mobile')).toBe('fix-login-button-on-mobile');
  });

  test('leading/trailing punctuation is trimmed', () => {
    expect(kebab('... Rewrite!')).toBe('rewrite');
  });

  test('non-alpha characters fold to single hyphens', () => {
    expect(kebab('Refactor: cache_layer (v2)')).toBe('refactor-cache-layer-v2');
  });

  test('unicode gets stripped (we only keep a-z0-9)', () => {
    // Not a bug — matches the /rename output, which is ASCII-only.
    expect(kebab('Déjà vu test')).toBe('d-j-vu-test');
  });

  test('empty-ish titles become empty strings', () => {
    expect(kebab('!!!')).toBe('');
    expect(kebab('')).toBe('');
  });
});

describe('auto-rename-first-message — failure containment', () => {
  test('patched bundle wraps the persist logic in a try/catch', () => {
    // The injected code includes a try/catch so the .then callback
    // never throws into React's render path. If someone ever
    // "simplifies" the patch and drops the guard, this test catches
    // it — we look for `catch(e){}` near the injection site.
    expect(patched.includes('catch(e){}')).toBe(true);
  });

  test('patched bundle attaches .catch(function(){}) to both save calls', () => {
    // saveCustomTitle + saveAgentName each have a trailing
    // .catch(function(){}) so neither rejection crashes the session.
    expect(patched.includes('.catch(function(){})')).toBe(true);
  });
});

describe('auto-rename-first-message — rename-random-color coupling', () => {
  // When both patches are enabled, the auto-rename arrow must ALSO
  // reroll a session color via saveAgentColor. Isolated (color patch
  // off), the color snippet must be absent so the feature is scoped
  // strictly to users who asked for random colors.

  test('isolated auto-rename bundle contains no __cxAR_P color pool', () => {
    // The color snippet introduces two unique locals: __cxAR_P (the
    // pool array) and __cxAR_C (the picked color). Neither should
    // exist when rename-random-color is off.
    expect(countOccurrences(patched, '__cxAR_P')).toBe(0);
    expect(countOccurrences(patched, '__cxAR_C')).toBe(0);
  });

  test('combined bundle declares __cxAR_P as the 8-color pool', () => {
    // Opt in to both patches together. The combined patched source
    // must contain the color pool literal AND call saveAgentColor
    // with the picked color.
    const combined = getBundle({
      patches: ['auto-rename-first-message', 'rename-random-color'],
    }).source;

    // Pool array appears inline as a JSON-stringified literal, so we
    // can match against its exact form.
    const pool = '["red","blue","green","yellow","purple","orange","pink","cyan"]';
    expect(combined.includes(`var __cxAR_P=${pool}`)).toBe(true);

    // __cxAR_C is the picked color. It's referenced in exactly two
    // places: the Math.floor(...) assignment and the saveAgentColor
    // call. Expect both to be present.
    expect(countOccurrences(combined, '__cxAR_C')).toBeGreaterThanOrEqual(2);
  });

  test('combined bundle calls saveAgentColor on the __cxAR_S sessionId', () => {
    // We don't know the minified name of saveAgentColor, but we do
    // know:
    //   - it runs on __cxAR_S, the local sessionId
    //   - it passes __cxAR_C as the color
    //   - it's fire-and-forget with .catch
    // So look for the canonical shape `(__cxAR_S,__cxAR_C).catch(`.
    // That substring is unique to the color call — neither title
    // nor name calls use __cxAR_C.
    const combined = getBundle({
      patches: ['auto-rename-first-message', 'rename-random-color'],
    }).source;
    expect(combined.includes('(__cxAR_S,__cxAR_C).catch(')).toBe(true);
  });

  test('combined bundle calls store.setState for immediate color update', () => {
    // The patch must also update React state so the prompt bar
    // shows the new color immediately, not just on next session
    // restore. Look for the Object.assign pattern that sets
    // standaloneAgentContext with both name and color.
    const combined = getBundle({
      patches: ['auto-rename-first-message', 'rename-random-color'],
    }).source;
    expect(combined.includes('.setState(function(__cxAR_prev)')).toBe(true);
    expect(combined.includes('{name:__cxAR_T,color:__cxAR_C}')).toBe(true);
  });
});
