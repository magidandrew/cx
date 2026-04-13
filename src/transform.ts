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
import { matchesRange } from './semver.js';
import * as allPatches from './patches/index.js';
import type { Patch, PatchContext, PatchInfo, ASTNode, TransformCallbacks, WorkerMessage } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════════════
// Variant selection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve which `apply` function to run for a given patch + bundle
 * version. Returns null if the patch declares variants but none match,
 * which the caller turns into a "Patch X failed: no variant matches"
 * error so the tester surfaces it as broken.
 *
 * Variants are checked in declaration order, so authors should put
 * the newest version first and let older fallbacks trail behind.
 *
 * Exported so the workers can call the same selection logic.
 */
export function selectPatchApply(
  patch: Patch,
  version: string,
): ((ctx: PatchContext) => void) | null {
  if (patch.variants && patch.variants.length > 0) {
    const v = patch.variants.find(v => matchesRange(version, v.version));
    return v?.apply ?? null;
  }
  return patch.apply ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Patch resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve declared conflicts: if patch A declares conflictsWith: [B]
 * and both are in the enabled list, drop B. The patch that declared
 * the conflict wins — it's the "newer" or "superseding" one.
 *
 * Exported so the async CLI path (which bypasses resolvePatches and
 * passes patch ids straight to the worker) can apply the same rules.
 */
export function resolveConflicts(ids: string[]): string[] {
  const available = Object.values(allPatches) as Patch[];
  const byId = new Map(available.map(p => [p.id, p]));
  const enabled = new Set(ids);
  const drop = new Set<string>();
  for (const id of ids) {
    const patch = byId.get(id);
    if (!patch?.conflictsWith?.length) continue;
    for (const otherId of patch.conflictsWith) {
      if (enabled.has(otherId) && !drop.has(id)) {
        drop.add(otherId);
        process.stderr.write(
          `\x1b[2mcx: "${id}" conflicts with "${otherId}" — dropping "${otherId}"\x1b[0m\n`
        );
      }
    }
  }
  return ids.filter(id => !drop.has(id));
}

function resolvePatches(only: string[] | null, exclude: string[] | null): Patch[] {
  const available = Object.values(allPatches) as Patch[];
  let resolved: Patch[];
  if (only) {
    resolved = only.map(id => {
      const p = available.find(p => p.id === id);
      if (!p) throw new Error(`Unknown patch: "${id}". Available: ${available.map(p => p.id).join(', ')}`);
      return p;
    });
  } else {
    resolved = available.filter(p => !exclude?.includes(p.id));
  }
  const keepIds = new Set(resolveConflicts(resolved.map(p => p.id)));
  return resolved.filter(p => keepIds.has(p.id));
}

// ═══════════════════════════════════════════════════════════════════════════
// Transform (sequential)
// ═══════════════════════════════════════════════════════════════════════════

export function transform(
  source: string,
  version: string,
  only: string[] | null = null,
  exclude: string[] | null = null,
  callbacks: TransformCallbacks = {},
): string {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }) as unknown as ASTNode;
  const index = new ASTIndex(ast);
  const editor = new SourceEditor();
  const toApply = resolvePatches(only, exclude);
  const enabledIds = new Set(toApply.map(p => p.id));
  const ctx = buildContext(source, index, editor, version, enabledIds);

  callbacks.onReady?.();
  for (const patch of toApply) {
    const applyFn = selectPatchApply(patch, version);
    if (!applyFn) {
      throw new Error(
        `Patch "${patch.id}" failed: no variant matches claude-code@${version}`,
      );
    }
    try {
      applyFn(ctx);
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
  version: string,
  callbacks: TransformCallbacks = {},
): Promise<string> {
  const workerPath = resolve(__dirname, 'transform-worker.js');
  const patchesDir = resolve(__dirname, 'patches');

  return new Promise((res, rej) => {
    const worker = new Worker(workerPath, {
      workerData: { source, patchIds, patchesDir, version },
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
    tag: p.tag,
    conflictsWith: p.conflictsWith,
  }));
}
