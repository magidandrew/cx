/**
 * Worker thread that runs a single patch and returns its edits.
 * Receives: { source, patchId, patchesDir }
 * Returns:  { edits: [{pos, deleteCount, text}] } or { error: string }
 */

import { workerData, parentPort } from 'worker_threads';
import * as acorn from 'acorn';
import { ASTIndex, buildContext } from './ast.js';

const { source, patchId, patchesDir } = workerData;

try {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const index = new ASTIndex(ast);
  parentPort.postMessage({ type: 'ready' });

  const edits = [];
  const editor = {
    insertAt(pos, text) { edits.push({ pos, deleteCount: 0, text }); },
    replaceRange(start, end, text) { edits.push({ pos: start, deleteCount: end - start, text }); },
  };

  const ctx = buildContext(source, index, editor);
  const patchModule = await import(`${patchesDir}/${patchId}.js`);
  patchModule.default.apply(ctx);

  parentPort.postMessage({ type: 'done', edits });
} catch (err) {
  parentPort.postMessage({ type: 'error', error: err.message });
}
