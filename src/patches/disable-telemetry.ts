/**
 * Disable Telemetry Patch
 *
 * Strips Datadog and 1P (first-party) analytics calls.
 *
 * Three surgical cuts:
 * 1. Kill the analytics sink — logEvent() queues forever, nothing drains
 * 2. Noop Datadog HTTP flush + blank endpoint — no POST to Datadog
 * 3. Noop 1P event logging init — prevents exporter + retry of old events
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'disable-telemetry',
  name: 'Disable Telemetry',
  description: 'Strip Datadog and 1P analytics calls',

  apply(ctx) {
    const { ast, editor, find, query, assert } = ctx;
    const { findFirst } = find;

    // ── 1. Kill the analytics sink ───────────────────────────────────────
    // initializeAnalyticsSink() calls attachAnalyticsSink({logEvent, logEventAsync}).
    // Replace that call with void 0 so the sink never attaches. Without a
    // sink, logEvent() just pushes to an internal queue that never drains —
    // neither Datadog nor 1P receives anything.
    //
    // Marker: object literal with preserved keys "logEvent" + "logEventAsync"
    // passed as sole argument to a call expression.

    const sinkCall = findFirst(ast, (n: any) => {
      if (n.type !== 'CallExpression' || n.arguments.length !== 1) return false;
      const arg = n.arguments[0];
      if (arg.type !== 'ObjectExpression') return false;
      const keys = arg.properties
        .filter((p: any) => p.type === 'Property')
        .map((p: any) => p.key.name || p.key.value);
      return keys.includes('logEvent') && keys.includes('logEventAsync');
    });
    assert(sinkCall, 'Could not find attachAnalyticsSink({logEvent, logEventAsync})');
    editor.replaceRange(sinkCall.start, sinkCall.end, 'void 0');

    // ── 2. Noop Datadog HTTP flush + blank endpoint ─────────────────────
    // shutdownDatadog() calls flushLogs() on exit, which would POST
    // whatever's in logBatch. Insert early return to prevent any HTTP call.
    //
    // Marker: "DD-API-KEY" header string. Take the smallest zero-param
    // function containing it (flushLogs, not a module wrapper).

    const ddCandidates = query.findFunctionsContainingStrings(ast, 'DD-API-KEY');
    const flushFns = ddCandidates
      .filter((fn: any) => fn.params.length === 0)
      .sort((a: any, b: any) => (a.end - a.start) - (b.end - b.start));
    assert(flushFns.length >= 1, 'Could not find Datadog flushLogs function');
    const flushBody = flushFns[0].body;
    assert(flushBody.type === 'BlockStatement', 'flushLogs: expected block body');
    editor.insertAt(flushBody.start + 1, 'return;');

    // Blank the endpoint URL as extra safety (token is not a plain literal
    // in the bundle, so we target the URL instead).
    const endpointLit = findFirst(ast, (n: any) =>
      n.type === 'Literal' &&
      n.value === 'https://http-intake.logs.us5.datadoghq.com/api/v2/logs');
    assert(endpointLit, 'Could not find Datadog endpoint URL');
    editor.replaceRange(endpointLit.start, endpointLit.end, '""');

    // ── 3. Noop 1P event logging init ───────────────────────────────────
    // Prevents the OpenTelemetry exporter from being created, which also
    // stops retryPreviousBatches from re-sending old failed events.
    //
    // Marker: "com.anthropic.claude_code.events" instrumentation scope.
    // Take the smallest zero-param function containing it.

    const init1PCandidates = query.findFunctionsContainingStrings(
      ast, 'com.anthropic.claude_code.events');
    const init1PFns = init1PCandidates
      .filter((fn: any) => fn.params.length === 0)
      .sort((a: any, b: any) => (a.end - a.start) - (b.end - b.start));
    assert(init1PFns.length >= 1, 'Could not find initialize1PEventLogging');
    const init1PBody = init1PFns[0].body;
    assert(init1PBody.type === 'BlockStatement',
      'initialize1PEventLogging: expected block body');
    editor.insertAt(init1PBody.start + 1, 'return;');
  },
};

export default patch;
