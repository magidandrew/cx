/**
 * Git Branch in Banner
 *
 * Appends the current git branch (or short SHA on detached HEAD) to
 * the cwd line in the startup banner. The banner already uses ` · ` to
 * separate segments (e.g. `@agent · /path/to/cwd`), so the branch
 * slots in naturally as `... · /path/to/cwd · main`.
 *
 * Outside a git repo, the helper returns null and the appended bit is
 * empty so the banner collapses back to its original shape.
 *
 * Implementation notes:
 *
 * The branch is read once via `git symbolic-ref --short HEAD` (with a
 * `git rev-parse --short HEAD` fallback for detached HEAD), cached at
 * module scope, and served synchronously on every banner re-render.
 *
 * The bundle is ESM — CJS `require` isn't in scope — but the preamble
 * already binds `require = createRequire(import.meta.url)` to a minified
 * var (Q6 at time of writing). We find that var by matching its init
 * `CallExpression(MemberExpression(MetaProperty import.meta, url))` and
 * reuse it to pull `child_process` synchronously. execSync is the only
 * way to get the branch at render time without plumbing async state
 * through React.
 *
 * Injection target: the ConditionalExpression that computes the cwd
 * line's string — `agentName ? @${agentName} · ${truncatedCwd} : truncatedCwd`.
 * This single expression feeds all three banner layouts (condensed,
 * compact-boxed, wide) as a sibling Text child of each layout's cwd
 * Text element, so rewriting the expression once updates every layout.
 * We wrap the whole ConditionalExpression with `((...) + branchTail)`
 * where branchTail resolves to " · <branch>" or empty string.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'git-branch-banner',
  name: 'Git Branch in Banner',
  description: 'Append the current git branch to the cwd line in the startup banner',
  defaultEnabled: true,

  apply(ctx) {
    const { ast, editor, find, index, src, assert } = ctx;

    // ── 1. Find the bundle's CJS `require` — needed for execSync ────
    // Pattern: `var Q6 = DH5(import.meta.url)` where DH5 is the
    // createRequire import. We match on the argument shape
    // (import.meta.url MemberExpression) which is unique enough that
    // we don't need to know DH5's name.
    const reqDecl = find.findFirst(ast, (n: any) =>
      n.type === 'VariableDeclarator' &&
      n.id?.type === 'Identifier' &&
      n.init?.type === 'CallExpression' &&
      n.init.arguments?.length === 1 &&
      n.init.arguments[0].type === 'MemberExpression' &&
      n.init.arguments[0].object?.type === 'MetaProperty' &&
      n.init.arguments[0].property?.name === 'url'
    );
    assert(reqDecl, 'Could not find createRequire(import.meta.url) in bundle');
    const reqVar = reqDecl.id.name;

    // Walk up to the enclosing VariableDeclaration so our helper lands
    // AFTER the statement that defines reqVar — otherwise the helper's
    // body references a var that hasn't been assigned yet at module-load
    // time and the first banner render throws.
    let varStmt = index.parentMap.get(reqDecl);
    while (varStmt && varStmt.type !== 'VariableDeclaration') {
      varStmt = index.parentMap.get(varStmt);
    }
    assert(varStmt, 'Could not find VariableDeclaration for createRequire');

    // ── 2. Module-level lazy git-branch resolver ────────────────────
    // Cached: banner re-renders on terminal resize etc. Timeout bounds
    // the execSync call so a slow/broken git doesn't stall startup.
    const helper =
      ';var __cxGitBranch;' +
      'var __cxGetGitBranch=function(){' +
        'if(__cxGitBranch!==undefined)return __cxGitBranch;' +
        'try{' +
          `var __cxCP=${reqVar}("child_process");` +
          'var __cxOpts={stdio:["pipe","pipe","ignore"],cwd:process.cwd(),timeout:500};' +
          'var __cxB;' +
          'try{__cxB=__cxCP.execSync("git symbolic-ref --short HEAD",__cxOpts).toString().trim()}' +
          'catch(_e1){' +
            'try{__cxB=__cxCP.execSync("git rev-parse --short HEAD",__cxOpts).toString().trim()}' +
            'catch(_e2){__cxB=null}' +
          '}' +
          '__cxGitBranch=__cxB||null' +
        '}catch(_e){__cxGitBranch=null}' +
        'return __cxGitBranch' +
      '};';
    editor.insertAt(varStmt.end, helper);

    // ── 3. Append branch to cwd line(s) ─────────────────────────────
    // Shape in the bundle (appears 2-3 times, once per layout):
    //   agentName ? `@${agentName} · ${truncatedCwd}` : truncatedCwd
    // Uniquely identified by the 3-quasi template with quasis
    // ["@", " · ", ""] and two expressions. The alternate is always a
    // bare Identifier (truncatedCwd).
    //
    // We wrap the whole ConditionalExpression so the branch tail
    // appears after the cwd regardless of which branch of the
    // ConditionalExpression fires:
    //   ((agent ? "@…·cwd" : cwd) + (branch ? " · branch" : ""))
    const cwdConditions = (index.nodesByType.get('ConditionalExpression') || []).filter((n: any) => {
      if (n.consequent?.type !== 'TemplateLiteral') return false;
      const q = n.consequent.quasis;
      if (!q || q.length !== 3) return false;
      if (q[0].value?.raw !== '@') return false;
      if (q[1].value?.raw !== ' \u00b7 ') return false;
      if (q[2].value?.raw !== '') return false;
      if (n.consequent.expressions?.length !== 2) return false;
      return n.alternate?.type === 'Identifier';
    });
    assert(cwdConditions.length > 0,
      'Could not find any `agentName ? `@…·cwd` : cwd` ConditionalExpression');

    for (const cond of cwdConditions) {
      const wrapped =
        `((${src(cond)})+` +
        `(__cxGetGitBranch()?" \\u00b7 "+__cxGetGitBranch():""))`;
      editor.replaceRange(cond.start, cond.end, wrapped);
    }
  },
};

export default patch;
