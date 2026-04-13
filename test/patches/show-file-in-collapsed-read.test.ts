/**
 * show-file-in-collapsed-read.test.ts
 *
 * The patch injects display code that pushes a new createElement
 * into the `z6.push(...)` list inside the collapsed display render
 * function, conditionally on `readFilePaths.length > 0` and
 * `searchArgs.length > 0`. It also adds the unique literal keys
 * "read-paths" and "search-args" to createElement props.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { getIsolatedBundle, findLiterals } from '../harness/index.js';

let patched: string;

beforeAll(() => {
  patched = getIsolatedBundle('show-file-in-collapsed-read').source;
});

describe('show-file-in-collapsed-read', () => {
  test('patched bundle contains a "read-paths" createElement key', () => {
    // The unique key on the injected read-paths Text element.
    expect(findLiterals(patched, 'read-paths').length).toBeGreaterThanOrEqual(1);
  });

  test('patched bundle contains a "search-args" createElement key', () => {
    expect(findLiterals(patched, 'search-args').length).toBeGreaterThanOrEqual(1);
  });

  test('patched bundle contains the "… +" more suffix template', () => {
    // The truncation hint "… +N more" is a unique sub-string the
    // patch emits for read lists longer than 3.
    expect(patched.includes('… +')).toBe(true);
  });
});
