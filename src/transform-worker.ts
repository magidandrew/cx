/**
 * Single worker that does all heavy work: parse, index, apply patches.
 * Sends progress messages so the main thread can update the UI.
 *
 * Receives: { source, patchIds, patchesDir }
 * Sends:    { type: 'ready' }             — parse + index done
 *           { type: 'done', id }          — one patch applied
 *           { type: 'complete', patched } — final result
 */

import { workerData, parentPort } from 'worker_threads';
import * as acorn from 'acorn';
import { ASTIndex, SourceEditor, buildContext } from './ast.js';
import type { ASTNode, WorkerData, Patch } from './types.js';

const { source, patchIds, patchesDir } = workerData as WorkerData;

try {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }) as unknown as ASTNode;
  const index = new ASTIndex(ast);
  parentPort!.postMessage({ type: 'ready' });

  const editor = new SourceEditor();
  const ctx = buildContext(source, index, editor);

  for (const id of patchIds) {
    const mod = await import(`${patchesDir}/${id}.js`);
    try {
      (mod.default as Patch).apply(ctx);
    } catch (err) {
      throw new Error(`Patch "${id}" failed: ${(err as Error).message}`);
    }
    parentPort!.postMessage({ type: 'done', id });
  }

  parentPort!.postMessage({ type: 'complete', patched: editor.apply(source) });
} catch (err) {
  parentPort!.postMessage({ type: 'error', error: (err as Error).message });
}
