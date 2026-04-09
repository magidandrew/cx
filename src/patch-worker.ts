/**
 * Worker thread that runs a single patch and returns its edits.
 * Receives: { source, patchId, patchesDir }
 * Returns:  { edits: [{pos, deleteCount, text}] } or { error: string }
 */

import { workerData, parentPort } from 'worker_threads';
import * as acorn from 'acorn';
import { ASTIndex, buildContext } from './ast.js';
import type { ASTNode, PatchWorkerData, SourceEdit, PatchEditor, Patch } from './types.js';

const { source, patchId, patchesDir } = workerData as PatchWorkerData;

try {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }) as unknown as ASTNode;
  const index = new ASTIndex(ast);
  parentPort!.postMessage({ type: 'ready' });

  const edits: SourceEdit[] = [];
  const editor: PatchEditor = {
    insertAt(pos: number, text: string) { edits.push({ pos, deleteCount: 0, text }); },
    replaceRange(start: number, end: number, text: string) { edits.push({ pos: start, deleteCount: end - start, text }); },
  };

  const ctx = buildContext(source, index, editor);
  const patchModule = await import(`${patchesDir}/${patchId}.js`);
  (patchModule.default as Patch).apply(ctx);

  parentPort!.postMessage({ type: 'done', edits });
} catch (err) {
  parentPort!.postMessage({ type: 'error', error: (err as Error).message });
}
