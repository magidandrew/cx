/**
 * cx Resume Commands Patch
 *
 * Rewrites user-facing resume/continue command hints so they point at
 * the cx wrapper instead of bare claude.
 *
 * AST strategy: scan string literals, template chunks, and adjacent
 * template chunks split by an interpolation, then replace the command
 * snippets that Claude prints to users.
 *
 * Adjacent-chunk handling (claude-code >=2.1.101): the shutdown hint
 *
 *     `Resume this session with:\nclaude ${Y}--resume ${_}\n`
 *
 * parses into two TemplateElements — `...claude ` and `--resume ` —
 * with `${Y}` (an optional `--worktree <path> ` slot) between them.
 * Neither element contains the full literal "claude --resume", so the
 * plain split-by-literal pass misses it. We fix that by scanning every
 * TemplateLiteral for the `claude ` / `--resume` or `--continue` pair
 * and rewriting the trailing `claude ` in the first chunk to `cx `.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'cx-resume-commands',
  name: 'cx Resume Commands',
  description: 'Show cx instead of claude in resume/continue command hints',

  apply(ctx) {
    const { ast, editor, find, src, assert } = ctx;
    const { findAll } = find;

    const replacements: [string, string][] = [
      ['claude --continue', 'cx --continue'],
      ['claude --resume', 'cx --resume'],
      ['claude -p --resume', 'cx -p --resume'],
    ];

    let changed = 0;
    const rewrite = (node: any, text: string) => {
      let next = text;
      for (const [from, to] of replacements) {
        next = next.split(from).join(to);
      }
      if (next !== text) {
        editor.replaceRange(node.start, node.end, JSON.stringify(next));
        changed++;
      }
    };

    for (const node of findAll(ast, (n: any) => n.type === 'Literal' && typeof n.value === 'string')) {
      rewrite(node, node.value);
    }

    for (const node of findAll(ast, (n: any) => n.type === 'TemplateElement' && typeof n.value?.raw === 'string')) {
      const raw = src(node);
      let nextRaw = raw;
      for (const [from, to] of replacements) {
        nextRaw = nextRaw.split(from).join(to);
      }
      if (nextRaw !== raw) {
        editor.replaceRange(node.start, node.end, nextRaw);
        changed++;
      }
    }

    // Adjacent-chunk rewrite: a template literal like
    //   `... claude ${worktreeFlag}--resume ${sessionId} ...`
    // parses as quasis[i] ending in "claude " and quasis[i+1] starting
    // with "--resume" (or "--continue"). The per-element pass above
    // can't see across the interpolation, so the literal "claude "
    // gets left alone and the user sees "claude --resume …" in the
    // shutdown hint. Find those adjacent pairs and rewrite the
    // trailing "claude " in the first chunk to "cx " in-place.
    const resumeContinueRe = /^(?:--resume|--continue)\b/;
    for (const tpl of findAll(ast, (n: any) => n.type === 'TemplateLiteral')) {
      const quasis = tpl.quasis;
      if (!Array.isArray(quasis)) continue;
      for (let i = 0; i < quasis.length - 1; i++) {
        const a = quasis[i];
        const b = quasis[i + 1];
        const aRaw: string | undefined = a?.value?.raw;
        const bRaw: string | undefined = b?.value?.raw;
        if (typeof aRaw !== 'string' || typeof bRaw !== 'string') continue;
        if (!aRaw.endsWith('claude ')) continue;
        if (!resumeContinueRe.test(bRaw)) continue;

        // Rewrite only the trailing "claude " — leave everything
        // else in the quasi alone. Use src() to preserve the exact
        // surrounding backtick/escape text; replace the last
        // "claude " occurrence in the element source.
        const aSrc = src(a);
        const idx = aSrc.lastIndexOf('claude ');
        if (idx < 0) continue;
        const next = aSrc.slice(0, idx) + 'cx ' + aSrc.slice(idx + 'claude '.length);
        editor.replaceRange(a.start, a.end, next);
        changed++;
      }
    }

    assert(changed >= 4, `Expected at least 4 resume/continue command rewrites, found ${changed}`);
  },
};

export default patch;
