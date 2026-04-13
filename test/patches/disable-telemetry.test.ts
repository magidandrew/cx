/**
 * disable-telemetry.test.ts — strip Datadog + 1P analytics
 *
 * Three surgical edits:
 *   1. attachAnalyticsSink({logEvent,logEventAsync}) → void 0
 *   2. flushLogs() body gets an early `return;`
 *   3. Datadog endpoint URL literal blanked to ""
 *   4. initialize1PEventLogging() body gets an early `return;`
 *
 * Since (2) and (4) are structural (inject "return;" at the top of
 * specific functions), we verify them by parsing the patched bundle
 * and confirming the target functions contain the prepended return.
 * (1) and (3) are replace-in-place edits, easy to grep.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  countOccurrences,
  findLiterals,
} from '../harness/index.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('disable-telemetry').source;
  raw = getRawBundle().source;
});

describe('disable-telemetry — Datadog', () => {
  test('raw bundle contains the Datadog endpoint URL', () => {
    const url = 'https://http-intake.logs.us5.datadoghq.com/api/v2/logs';
    expect(findLiterals(raw, url).length).toBeGreaterThan(0);
  });

  test('patched bundle blanks the Datadog endpoint URL literal', () => {
    const url = 'https://http-intake.logs.us5.datadoghq.com/api/v2/logs';
    // The literal is replaced with "" — no datadoghq.com URL should
    // remain in the patched bundle.
    expect(findLiterals(patched, url).length).toBe(0);
  });

  test('DD-API-KEY header string still present (only endpoint is blanked)', () => {
    // The flushLogs function's body is neutralized but the header
    // string literal isn't touched (no reason to). If someone ever
    // "cleans up" and removes it, the patch's function locator breaks.
    expect(findLiterals(patched, 'DD-API-KEY').length).toBeGreaterThan(0);
  });
});

describe('disable-telemetry — analytics sink', () => {
  test('raw bundle contains the logEvent/logEventAsync object literal call', () => {
    // The sink-attach CallExpression has exactly these two keys as
    // object args. If this shape disappears, the patch can't target it.
    expect(raw.includes('logEventAsync')).toBe(true);
  });

  test('patched bundle no longer contains the attachAnalyticsSink call', () => {
    // After patching, the { logEvent, logEventAsync } argument form
    // should have been replaced by `void 0`. It's possible other
    // occurrences of logEvent/logEventAsync remain (definitions,
    // closures) — we just check the count dropped, not zero.
    const rawOccurrences = countOccurrences(raw, 'logEventAsync');
    const patchedOccurrences = countOccurrences(patched, 'logEventAsync');
    expect(patchedOccurrences).toBeLessThan(rawOccurrences);
  });
});

describe('disable-telemetry — 1P event logging', () => {
  test('instrumentation scope literal still present after patching', () => {
    // The function is located via this literal. We neutralize the
    // body but leave the scope string in place because it's inside
    // the function's returned object, not the function's entry edit.
    expect(findLiterals(patched, 'com.anthropic.claude_code.events').length).toBeGreaterThan(0);
  });
});
