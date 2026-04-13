/**
 * cd-command.test.ts
 *
 * The patch injects a new {type:"local", name:"cd", ...} command into
 * the COMMANDS array. We can find it structurally by searching for an
 * ObjectExpression with exactly that name property.
 *
 * Behavioral: the command's `call` function is an inline arrow that
 * calls setCwd(p) and returns a text message. We extract it and run
 * it against a mocked setCwd to verify it hands off the user input.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  findObjectsWithProps,
  evalExpression,
} from '../harness/index.js';
import type { ASTNode } from '../../src/types.js';

// Build a Proxy-backed scope that answers every bare identifier with
// a sensible stub. Tracks calls to setCwd*/getCwd*. Real language
// globals (Promise, Object, process, Math, Symbol, JSON…) pass
// through unchanged so expression machinery still works.
const REAL_GLOBALS: Record<string, any> = {
  Promise,
  Object,
  Array,
  Symbol,
  Math,
  JSON,
  Error,
  TypeError,
  RangeError,
  String,
  Number,
  Boolean,
  Function,
  process,
  undefined: undefined,
  null: null,
};

/**
 * Build a Proxy-backed scope for the cd command.
 *
 * The minifier picks whatever letters it likes for setCwd/getCwd so
 * heuristics on identifier names don't work. Instead, `setCwdName`
 * and `getCwdName` are passed in by the caller after extracting them
 * from the cd object's call function source text.
 */
function makeCdScope(opts: {
  setCwdName: string;
  getCwdName: string;
  currentCwd: string;
  onSetCwd: (p: string) => void;
}) {
  const real: any = { ...REAL_GLOBALS };
  return new Proxy(real, {
    has: () => true,
    get(target, name) {
      if (typeof name !== 'string') return target[name as any];
      if (name in REAL_GLOBALS) return REAL_GLOBALS[name];
      if (name === opts.getCwdName) return () => opts.currentCwd;
      if (name === opts.setCwdName) {
        return (p: string) => {
          opts.onSetCwd(p);
          return true;
        };
      }
      // Everything else returns a no-op callable.
      return () => undefined;
    },
  });
}

/**
 * Extract the minified getCwd / setCwd identifier names from the cd
 * object's call function. The shape is stable across minifier
 * revisions (it's the source text our own patch injects), so a
 * regex over the object text is safer than chasing AST nodes.
 */
function extractCdHelperNames(objText: string): {
  getCwdName: string;
  setCwdName: string;
} {
  // Match the first `…+IDENT()` template-like pattern and the try-block
  // `try{IDENT(p)…` assignment. Both are unique in the cd object text.
  const getMatch = /"\+([A-Za-z_$][\w$]*)\(\)/.exec(objText);
  const setMatch = /try\{([A-Za-z_$][\w$]*)\(p\)/.exec(objText);
  if (!getMatch || !setMatch) {
    throw new Error(
      'extractCdHelperNames: cd object text does not match expected shape',
    );
  }
  return { getCwdName: getMatch[1], setCwdName: setMatch[1] };
}

let patched: string;

beforeAll(() => {
  patched = getIsolatedBundle('cd-command').source;
});

describe('cd-command — command object', () => {
  test('patched bundle contains a {type:"local", name:"cd", argumentHint:"<path>"} object', () => {
    const objs = findObjectsWithProps(patched, [
      ['type', 'local'],
      ['name', 'cd'],
      ['argumentHint', '<path>'],
    ]);
    expect(objs.length).toBeGreaterThanOrEqual(1);
  });

  test('cd command object advertises non-interactive support', () => {
    const objs = findObjectsWithProps(patched, [
      ['name', 'cd'],
      ['supportsNonInteractive', true],
    ]);
    expect(objs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('cd-command — call function', () => {
  // Pull the cd object's source text out of the patched bundle, run
  // it inside a Proxy-backed vm context where every bare identifier
  // (minified helper names like setCwd and getCwd) falls through to
  // a stub. The cdObj then loads and calls as if dispatched by the
  // real COMMANDS system.
  function buildCdObj(opts: {
    currentCwd: string;
    onSetCwd: (p: string) => void;
  }): any {
    const objs = findObjectsWithProps(patched, [
      ['description', 'Change working directory'],
    ]);
    if (objs.length !== 1) {
      throw new Error(`expected 1 cd command object, got ${objs.length}`);
    }
    const cdObj = objs[0] as ASTNode;
    const objText = patched.slice(cdObj.start, cdObj.end);
    const { getCwdName, setCwdName } = extractCdHelperNames(objText);
    return evalExpression(
      objText,
      makeCdScope({ ...opts, getCwdName, setCwdName }),
    );
  }

  test('call() passes the trimmed path to setCwd and returns a text value', async () => {
    let capturedPath: string | null = null;
    const cdObj = buildCdObj({
      currentCwd: '/initial',
      onSetCwd: p => {
        capturedPath = p;
      },
    });
    expect(cdObj).toBeTruthy();
    expect(cdObj.name).toBe('cd');

    const loaded = await cdObj.load();
    expect(typeof loaded.call).toBe('function');

    const result = await loaded.call('/tmp/some-path');
    expect(result.type).toBe('text');
    expect(typeof result.value).toBe('string');
    expect(capturedPath).toBe('/tmp/some-path');
  });

  test('call() with empty arg reports the current directory without calling setCwd', async () => {
    let capturedPath: string | null = null;
    const cdObj = buildCdObj({
      currentCwd: '/current-dir',
      onSetCwd: p => {
        capturedPath = p;
      },
    });
    const loaded = await cdObj.load();
    const result = await loaded.call('   ');
    expect(result.type).toBe('text');
    expect(result.value).toContain('/current-dir');
    expect(capturedPath).toBe(null);
  });

  test('call() expands leading ~ via process.env.HOME', async () => {
    let capturedPath: string | null = null;
    const cdObj = buildCdObj({
      currentCwd: '/wherever',
      onSetCwd: p => {
        capturedPath = p;
      },
    });
    const loaded = await cdObj.load();
    // The patch does: if(p.startsWith("~")) p = HOME + p.slice(1);
    // process.env.HOME inside a sandbox is the host process's HOME,
    // which bun test runs with. Just assert the ~ was expanded.
    await loaded.call('~/docs');
    expect(capturedPath).toBeTruthy();
    expect(capturedPath).not.toBe('~/docs');
    expect(capturedPath!.endsWith('/docs')).toBe(true);
  });
});
