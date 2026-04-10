/**
 * Core type definitions for cx — Claude Code Extensions.
 *
 * All types used across the framework are defined here to avoid
 * circular dependencies between modules.
 */

import type { ASTIndex } from './ast.js';

// ═══════════════════════════════════════════════════════════════════════════
// AST types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Loose AST node type for patch authors.
 * Extends acorn positional info with an index signature so ESTree
 * properties (value, elements, properties, callee, etc.) are
 * accessible without casts.
 */
export interface ASTNode {
  type: string;
  start: number;
  end: number;
  [key: string]: any;
}

/** Possible values of a JS Literal node. */
export type LiteralValue = string | number | boolean | null | RegExp;

// ═══════════════════════════════════════════════════════════════════════════
// Source editing
// ═══════════════════════════════════════════════════════════════════════════

export interface SourceEdit {
  pos: number;
  deleteCount: number;
  text: string;
}

/** Minimal editor interface exposed to patches. */
export interface PatchEditor {
  insertAt(pos: number, text: string): void;
  replaceRange(start: number, end: number, text: string): void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Patch API
// ═══════════════════════════════════════════════════════════════════════════

export interface FindHelpers {
  findFirst(root: ASTNode, predicate: (node: ASTNode) => boolean): ASTNode | null;
  findAll(root: ASTNode, predicate: (node: ASTNode) => boolean): ASTNode[];
  walkAST: (node: ASTNode) => Generator<ASTNode>;
}

export interface QueryHelpers {
  findArrayWithConsecutiveStrings(root: ASTNode, str1: string, str2: string): ASTNode | null;
  findObjectWithStringProps(root: ASTNode, propPairs: [string, string][]): ASTNode | null;
  findHookCallWithObjectKeys(root: ASTNode, hookName: string, keys: string[]): ASTNode | null;
  findFunctionsContainingStrings(root: ASTNode, ...strings: string[]): ASTNode[];
  getDestructuredName(objPattern: ASTNode, propKey: string): string | null;
}

export interface PatchContext {
  ast: ASTNode;
  source: string;
  editor: PatchEditor;
  index: ASTIndex;
  find: FindHelpers;
  query: QueryHelpers;
  src(node: ASTNode): string;
  assert(condition: unknown, message: string): void;
  getFunctionName(fn: ASTNode): string | null;
}

export interface Patch {
  id: string;
  name: string;
  description: string;
  defaultEnabled?: boolean;
  /**
   * Ids of other patches this one cannot coexist with (they edit the
   * same source region and would corrupt the bundle if both applied).
   * If both a patch and something it conflicts with are enabled, the
   * transform resolves by dropping the LOSER — i.e. the patch that
   * declares the conflict keeps itself and removes the other.
   */
  conflictsWith?: string[];
  apply(ctx: PatchContext): void;
}

export interface PatchInfo {
  id: string;
  name: string;
  description: string;
  defaultEnabled?: boolean;
  conflictsWith?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker messages
// ═══════════════════════════════════════════════════════════════════════════

export interface WorkerData {
  source: string;
  patchIds: string[];
  patchesDir: string;
}

export interface PatchWorkerData {
  source: string;
  patchId: string;
  patchesDir: string;
}

export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'done'; id: string }
  | { type: 'complete'; patched: string }
  | { type: 'error'; error: string };

export type PatchWorkerMessage =
  | { type: 'ready' }
  | { type: 'done'; edits: SourceEdit[] }
  | { type: 'error'; error: string };

// ═══════════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════════

export interface CxConfig {
  patches: Record<string, boolean>;
}

export interface TransformCallbacks {
  onReady?(): void;
  onDone?(id: string): void;
}
