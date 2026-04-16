/**
 * git-branch-banner.test.ts — append current branch to the cwd line.
 *
 * Three layers of verification:
 *
 *   1. Static — the module-level helper (`__cxGetGitBranch`) and the
 *      child_process execSync branch commands landed in the bundle,
 *      and the patched source gained the cwd-tail expression that
 *      appends " · <branch>" to the banner's cwd line.
 *   2. Differential — none of those markers exist in the raw bundle.
 *   3. Behavioral — extract the helper and run it in a sandbox. Stub
 *      child_process.execSync to return a known branch name; assert
 *      the helper returns that value, falls back to short SHA, and
 *      returns null outside a git repo.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import * as vm from 'vm';
import {
  getIsolatedBundle,
  getRawBundle,
  countOccurrences,
} from '../harness/index.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('git-branch-banner').source;
  raw = getRawBundle().source;
});

describe('git-branch-banner — static', () => {
  test('patched bundle defines the branch resolver helper', () => {
    // The var declaration (`var __cxGetGitBranch=function(){...}`) is
    // the unique sentinel — if the module-level inject fails, the whole
    // patch is a no-op.
    expect(patched.includes('__cxGetGitBranch')).toBe(true);
    expect(patched.includes('__cxGitBranch')).toBe(true);
  });

  test('patched bundle shells out to git symbolic-ref', () => {
    // The primary branch-lookup path. Absence means we regressed to
    // some static placeholder.
    expect(patched.includes('git symbolic-ref --short HEAD')).toBe(true);
  });

  test('patched bundle has the detached-HEAD fallback', () => {
    // `git rev-parse --short HEAD` kicks in when symbolic-ref throws
    // (detached HEAD during rebase, bisect, checkout <sha>, etc.).
    expect(patched.includes('git rev-parse --short HEAD')).toBe(true);
  });

  test('patched bundle wraps the cwd ConditionalExpression with branch tail', () => {
    // The replacement is `((<orig>)+(__cxGetGitBranch()?" \u00b7 "+__cxGetGitBranch():""))`.
    // The unique-enough signature is the ternary that stitches the
    // separator onto the branch result. The bundle has several
    // ConditionalExpressions with `__cxGetGitBranch()` but only our
    // replacement produces this specific "+" pattern around it.
    const occ = countOccurrences(patched, '__cxGetGitBranch()?" \\u00b7 "+__cxGetGitBranch()');
    // We touch every cwd ConditionalExpression in the bundle — at
    // least one (condensed) and up to three (one per layout).
    expect(occ).toBeGreaterThanOrEqual(1);
    expect(occ).toBeLessThan(10);
  });
});

describe('git-branch-banner — differential', () => {
  test('raw bundle has no __cxGetGitBranch binding', () => {
    expect(raw.includes('__cxGetGitBranch')).toBe(false);
  });

  test('raw bundle does not call `git symbolic-ref --short HEAD`', () => {
    // If upstream ever adds their own branch-detection path, this flips
    // and we have to rethink the differential.
    expect(raw.includes('git symbolic-ref --short HEAD')).toBe(false);
  });
});

describe('git-branch-banner — behavioral', () => {
  // Extract just the helper source. The patch inserts a chunk of the
  // form `;var __cxGitBranch;var __cxGetGitBranch=function(){...};`
  // right after the createRequire var statement, so we slice from the
  // helper's header until the terminating semicolon of the function
  // assignment. Simpler than AST-walking: the sentinel names are unique.
  function extractHelper(source: string): string {
    const head = source.indexOf('var __cxGitBranch;var __cxGetGitBranch=function(){');
    expect(head).toBeGreaterThan(-1);
    // The function body is delimited by balanced braces — find the
    // matching close starting from the `function(){`.
    const openBrace = source.indexOf('{', head + 'var __cxGitBranch;var __cxGetGitBranch=function('.length);
    expect(openBrace).toBeGreaterThan(-1);
    let depth = 1;
    let i = openBrace + 1;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    // `i` now sits just past the closing brace. Include the trailing
    // `};` so the declaration is terminated.
    while (i < source.length && source[i] !== ';') i++;
    return source.slice(head, i + 1);
  }

  function runHelperWithStub(stub: (cmd: string, opts: any) => any): unknown {
    const helperSrc = extractHelper(patched);
    // Sandbox with a stub `require("child_process")` returning an
    // execSync the test controls. Everything else is stripped down
    // so the helper can run in isolation.
    const stubRequire = (name: string) => {
      if (name === 'child_process') return { execSync: stub };
      throw new Error(`unexpected require("${name}")`);
    };
    // The helper uses the bundle's createRequire'd var (e.g. Q6) — we
    // can't know its name from outside, but we can wrap the helper so
    // every free identifier resolves to our stub require. A Proxy as
    // the sandbox context answers has()/get() for any identifier.
    const ctx: any = new Proxy(
      { process, Error, undefined: undefined },
      {
        has: () => true,
        get(target: any, key: string) {
          if (key in target) return target[key];
          if (key === 'process') return process;
          // Any other identifier (including the minified req var) is
          // treated as the CJS require stub. Good enough: the helper
          // only calls it with "child_process".
          return stubRequire;
        },
        set(target: any, key: string, value: any) {
          target[key] = value;
          return true;
        },
      },
    );
    vm.createContext(ctx);
    // Eval the helper so __cxGetGitBranch gets bound inside the ctx,
    // then call it.
    vm.runInContext(helperSrc, ctx, { timeout: 1000 });
    return vm.runInContext('__cxGetGitBranch()', ctx, { timeout: 1000 });
  }

  test('returns the branch name reported by git', () => {
    const branch = runHelperWithStub((cmd) => {
      if (cmd === 'git symbolic-ref --short HEAD') {
        return Buffer.from('main\n');
      }
      throw new Error('should not reach fallback');
    });
    expect(branch).toBe('main');
  });

  test('falls back to short SHA when symbolic-ref fails (detached HEAD)', () => {
    const branch = runHelperWithStub((cmd) => {
      if (cmd === 'git symbolic-ref --short HEAD') {
        throw new Error('fatal: ref HEAD is not a symbolic ref');
      }
      if (cmd === 'git rev-parse --short HEAD') {
        return Buffer.from('abc1234\n');
      }
      throw new Error(`unexpected command: ${cmd}`);
    });
    expect(branch).toBe('abc1234');
  });

  test('returns null outside a git repo', () => {
    const branch = runHelperWithStub(() => {
      throw new Error('fatal: not a git repository');
    });
    expect(branch).toBeNull();
  });
});
