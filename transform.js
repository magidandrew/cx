/**
 * AST transform framework for @anthropic-ai/claude-code
 *
 * Parses the minified bundle with acorn and applies modular patches
 * from the patches/ directory. Each patch receives a context object
 * with the AST, source, editor, and query helpers.
 *
 * Usage:
 *   import { transform } from './transform.js';
 *   const patched = transform(source);                    // all patches
 *   const patched = transform(source, ['queue']);          // specific patches
 *   const patched = transform(source, null, ['banner']);   // exclude patches
 */

import * as acorn from 'acorn';
import { Worker } from 'worker_threads';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { ASTIndex, SourceEditor, buildContext } from './ast.js';
import * as allPatches from './patches/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════════════
// Patch resolution
// ═══════════════════════════════════════════════════════════════════════════

function resolvePatches(only, exclude) {
  const available = Object.values(allPatches);
  if (only) {
    return only.map(id => {
      const p = available.find(p => p.id === id);
      if (!p) throw new Error(`Unknown patch: "${id}". Available: ${available.map(p => p.id).join(', ')}`);
      return p;
    });
  }
  return available.filter(p => !exclude?.includes(p.id));
}

// ═══════════════════════════════════════════════════════════════════════════
// Transform (sequential)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {string} source - Raw cli.js source
 * @param {string[]|null} only - If set, only apply these patch IDs
 * @param {string[]|null} exclude - If set, skip these patch IDs
 * @returns {string} Patched source
 */
export function transform(source, only = null, exclude = null, { onReady, onDone } = {}) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const index = new ASTIndex(ast);
  const editor = new SourceEditor();
  const ctx = buildContext(source, index, editor);
  const toApply = resolvePatches(only, exclude);

  onReady?.();
  for (const patch of toApply) {
    try {
      patch.apply(ctx);
    } catch (err) {
      throw new Error(`Patch "${patch.id}" failed: ${err.message}`);
    }
    onDone?.(patch.id);
  }

  return editor.apply(source);
}

// ═══════════════════════════════════════════════════════════════════════════
// Transform (async — single worker thread for non-blocking UI)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Runs parse + index + all patches in a single worker thread.
 * Keeps the main thread free for UI updates (timers, spinners).
 */
export function transformAsync(source, patchIds, { onReady, onDone } = {}) {
  const workerPath = resolve(__dirname, 'transform-worker.js');
  const patchesDir = resolve(__dirname, 'patches');

  return new Promise((res, rej) => {
    const worker = new Worker(workerPath, {
      workerData: { source, patchIds, patchesDir },
    });
    worker.on('message', msg => {
      if (msg.type === 'ready') onReady?.();
      else if (msg.type === 'done') onDone?.(msg.id);
      else if (msg.type === 'complete') res(msg.patched);
      else if (msg.type === 'error') rej(new Error(msg.error));
    });
    worker.on('error', rej);
  });
}

/** List all available patches. */
export function listPatches() {
  return Object.values(allPatches).map(p => ({ id: p.id, name: p.name, description: p.description, defaultEnabled: p.defaultEnabled }));
}
