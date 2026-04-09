/**
 * AST indexing and query helpers for cx patches.
 *
 * ASTIndex builds lookup tables in a single walk so that subsequent
 * queries are O(matches) instead of O(all nodes). The generator-based
 * walkAST is retained for backward compat — some patches iterate it
 * directly over subtrees.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Walk (generator, for direct use by patches)
// ═══════════════════════════════════════════════════════════════════════════

export function* walkAST(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type) yield node;
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'raw') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && item.type) yield* walkAST(item);
      }
    } else if (child && typeof child === 'object' && child.type) {
      yield* walkAST(child);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Index
// ═══════════════════════════════════════════════════════════════════════════

export class ASTIndex {
  constructor(ast) {
    this.ast = ast;
    this.nodesByType = new Map();
    this.literalsByValue = new Map();
    this.parentMap = new WeakMap();
    /** Pre-order flat list — sorted by start position. */
    this.allNodes = [];
    this._build(ast, null);
  }

  _build(node, parent) {
    if (!node || typeof node !== 'object' || !node.type) return;

    this.allNodes.push(node);
    if (parent) this.parentMap.set(node, parent);

    let byType = this.nodesByType.get(node.type);
    if (!byType) { byType = []; this.nodesByType.set(node.type, byType); }
    byType.push(node);

    if (node.type === 'Literal' && node.value != null) {
      let byVal = this.literalsByValue.get(node.value);
      if (!byVal) { byVal = []; this.literalsByValue.set(node.value, byVal); }
      byVal.push(node);
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'raw') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) this._build(item, node);
      } else {
        this._build(child, node);
      }
    }
  }

  // ── Generic queries ────────────────────────────────────────────────────

  findFirst(root, predicate) {
    if (!root || root === this.ast) {
      for (const n of this.allNodes) if (predicate(n)) return n;
      return null;
    }
    const lo = this._lowerBound(root.start);
    for (let i = lo; i < this.allNodes.length; i++) {
      const n = this.allNodes[i];
      if (n.start >= root.end) break;
      if (n.end <= root.end && predicate(n)) return n;
    }
    return null;
  }

  findAll(root, predicate) {
    const results = [];
    if (!root || root === this.ast) {
      for (const n of this.allNodes) if (predicate(n)) results.push(n);
      return results;
    }
    const lo = this._lowerBound(root.start);
    for (let i = lo; i < this.allNodes.length; i++) {
      const n = this.allNodes[i];
      if (n.start >= root.end) break;
      if (n.end <= root.end && predicate(n)) results.push(n);
    }
    return results;
  }

  // ── Specialized queries (indexed) ──────────────────────────────────────

  findArrayWithConsecutiveStrings(root, str1, str2) {
    for (const lit of this._inRange(this.literalsByValue.get(str1), root)) {
      const parent = this.parentMap.get(lit);
      if (!parent || parent.type !== 'ArrayExpression') continue;
      const idx = parent.elements.indexOf(lit);
      if (idx >= 0 && idx < parent.elements.length - 1) {
        const next = parent.elements[idx + 1];
        if (next?.type === 'Literal' && next.value === str2) return parent;
      }
    }
    return null;
  }

  findObjectWithStringProps(root, propPairs) {
    let bestVal = propPairs[0][1], bestCount = Infinity;
    for (const [, v] of propPairs) {
      const c = (this.literalsByValue.get(v) || []).length;
      if (c < bestCount) { bestVal = v; bestCount = c; }
    }
    for (const lit of this._inRange(this.literalsByValue.get(bestVal), root)) {
      let obj = this.parentMap.get(lit);
      if (obj?.type === 'Property') obj = this.parentMap.get(obj);
      if (!obj || obj.type !== 'ObjectExpression') continue;
      if (propPairs.every(([key, value]) =>
        obj.properties.some(prop => {
          if (prop.type !== 'Property') return false;
          const kMatch = (prop.key.type === 'Identifier' && prop.key.name === key) ||
                         (prop.key.type === 'Literal' && prop.key.value === key);
          return kMatch && prop.value.type === 'Literal' && prop.value.value === value;
        })
      )) return obj;
    }
    return null;
  }

  findHookCallWithObjectKeys(root, hookName, keys) {
    for (const node of this._inRange(this.nodesByType.get('CallExpression'), root)) {
      const c = node.callee;
      if (c.type !== 'MemberExpression' || c.property.name !== hookName) continue;
      const firstArg = node.arguments[0];
      if (!firstArg) continue;
      for (const obj of this._inRange(this.nodesByType.get('ObjectExpression'), firstArg)) {
        if (keys.every(k => obj.properties.some(p =>
          p.type === 'Property' &&
          ((p.key.type === 'Literal' && p.key.value === k) || (p.key.type === 'Identifier' && p.key.name === k))
        ))) return node;
      }
    }
    return null;
  }

  findFunctionsContainingStrings(root, ...strings) {
    let rarest = strings[0];
    let rarestCount = (this.literalsByValue.get(rarest) || []).length;
    for (let i = 1; i < strings.length; i++) {
      const count = (this.literalsByValue.get(strings[i]) || []).length;
      if (count < rarestCount) { rarest = strings[i]; rarestCount = count; }
    }
    const seen = new Set();
    const results = [];
    for (const lit of this._inRange(this.literalsByValue.get(rarest), root)) {
      const fn = this.enclosingFunction(lit);
      if (!fn || seen.has(fn)) continue;
      seen.add(fn);
      if (strings.every(s =>
        (this.literalsByValue.get(s) || []).some(l => l.start >= fn.start && l.end <= fn.end)
      )) results.push(fn);
    }
    return results;
  }

  getDestructuredName(objPattern, propKey) {
    for (const prop of objPattern.properties) {
      if (prop.type === 'RestElement') continue;
      const k = prop.key;
      if ((k.type === 'Identifier' && k.name === propKey) || (k.type === 'Literal' && k.value === propKey)) {
        if (prop.value.type === 'Identifier') return prop.value.name;
        if (prop.value.type === 'AssignmentPattern' && prop.value.left.type === 'Identifier') return prop.value.left.name;
      }
    }
    return null;
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  _inRange(nodes, root) {
    if (!nodes) return [];
    if (!root || root === this.ast) return nodes;
    return nodes.filter(n => n.start >= root.start && n.end <= root.end);
  }

  _lowerBound(target) {
    let lo = 0, hi = this.allNodes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.allNodes[mid].start < target) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /** Walk up the parent chain to find the nearest ancestor of a given type. */
  ancestor(node, type) {
    let current = this.parentMap.get(node);
    while (current) {
      if (current.type === type) return current;
      current = this.parentMap.get(current);
    }
    return null;
  }

  enclosingFunction(node) {
    let current = this.parentMap.get(node);
    while (current) {
      if (current.type === 'FunctionDeclaration' || current.type === 'FunctionExpression' || current.type === 'ArrowFunctionExpression') return current;
      current = this.parentMap.get(current);
    }
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Source Editor
// ═══════════════════════════════════════════════════════════════════════════

export class SourceEditor {
  constructor() { this.edits = []; }
  insertAt(pos, text) { this.edits.push({ pos, deleteCount: 0, text }); }
  replaceRange(start, end, text) { this.edits.push({ pos: start, deleteCount: end - start, text }); }
  apply(src) {
    const sorted = [...this.edits].sort((a, b) => b.pos - a.pos);
    let result = src;
    for (const edit of sorted) {
      result = result.slice(0, edit.pos) + edit.text + result.slice(edit.pos + edit.deleteCount);
    }
    return result;
  }
}

/**
 * Build the standard patch context from source + AST index + editor.
 * Shared by transform.js (sequential) and patch-worker.js (parallel).
 */
export function buildContext(source, index, editor) {
  return {
    ast: index.ast,
    source,
    editor,
    index,
    find: {
      findFirst: (root, pred) => index.findFirst(root, pred),
      findAll: (root, pred) => index.findAll(root, pred),
      walkAST,
    },
    query: {
      findArrayWithConsecutiveStrings: (root, s1, s2) => index.findArrayWithConsecutiveStrings(root, s1, s2),
      findObjectWithStringProps: (root, pp) => index.findObjectWithStringProps(root, pp),
      findHookCallWithObjectKeys: (root, hn, keys) => index.findHookCallWithObjectKeys(root, hn, keys),
      findFunctionsContainingStrings: (root, ...strings) => index.findFunctionsContainingStrings(root, ...strings),
      getDestructuredName: (obj, key) => index.getDestructuredName(obj, key),
    },
    src: node => source.slice(node.start, node.end),
    assert(cond, msg) {
      if (!cond) throw new Error(`transform: ${msg}`);
    },
    getFunctionName(fn) {
      if (fn.type === 'FunctionDeclaration' && fn.id) return fn.id.name;
      const before = source.slice(Math.max(0, fn.start - 100), fn.start);
      const m = before.match(/(?:^|[,;{}\s])(\w+)\s*=\s*$/);
      return m ? m[1] : null;
    },
  };
}
