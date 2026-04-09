/**
 * AST transform framework for @anthropic-ai/claude-code
 *
 * Parses the minified bundle with acorn and applies modular patches
 * from the patches/ directory. Each patch receives a context object
 * with the AST, source, editor, and query helpers.
 */

import * as acorn from 'acorn';
import { Worker } from 'worker_threads';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { ASTIndex, SourceEditor, buildContext } from './ast.js';
import * as allPatches from './patches/index.js';
import type { Patch, PatchInfo, ASTNode, TransformCallbacks, WorkerMessage } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════════════
// Patch resolution
// ═══════════════════════════════════════════════════════════════════════════

function resolvePatches(only: string[] | null, exclude: string[] | null): Patch[] {
  const available = Object.values(allPatches) as Patch[];
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

export function transform(
  source: string,
  only: string[] | null = null,
  exclude: string[] | null = null,
  callbacks: TransformCallbacks = {},
): string {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }) as unknown as ASTNode;
  const index = new ASTIndex(ast);
  const editor = new SourceEditor();
  const ctx = buildContext(source, index, editor);
  const toApply = resolvePatches(only, exclude);

  callbacks.onReady?.();
  for (const patch of toApply) {
    try {
      patch.apply(ctx);
    } catch (err) {
      throw new Error(`Patch "${patch.id}" failed: ${(err as Error).message}`);
    }
    callbacks.onDone?.(patch.id);
  }

  return editor.apply(source);
}

// ═══════════════════════════════════════════════════════════════════════════
// Transform (async — single worker thread for non-blocking UI)
// ═══════════════════════════════════════════════════════════════════════════

export function transformAsync(
  source: string,
  patchIds: string[],
  callbacks: TransformCallbacks = {},
): Promise<string> {
  const workerPath = resolve(__dirname, 'transform-worker.js');
  const patchesDir = resolve(__dirname, 'patches');

  return new Promise((res, rej) => {
    const worker = new Worker(workerPath, {
      workerData: { source, patchIds, patchesDir },
    });
    worker.on('message', (msg: WorkerMessage) => {
      if (msg.type === 'ready') callbacks.onReady?.();
      else if (msg.type === 'done') callbacks.onDone?.(msg.id);
      else if (msg.type === 'complete') res(msg.patched);
      else if (msg.type === 'error') rej(new Error(msg.error));
    });
    worker.on('error', rej);
  });
}

/** List all available patches. */
export function listPatches(): PatchInfo[] {
  return (Object.values(allPatches) as Patch[]).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    defaultEnabled: p.defaultEnabled,
  }));
}
