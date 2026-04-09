/**
 * cx Resume Commands Patch
 *
 * Rewrites user-facing resume/continue command hints so they point at
 * the cx wrapper instead of bare claude.
 *
 * AST strategy: scan string literals and template chunks for the stable
 * command snippets that Claude prints to users, then replace only those
 * substrings in-place. This covers shutdown hints, cross-project resume
 * commands, and resume tips without relying on minified variable names.
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

    assert(changed >= 4, `Expected at least 4 resume/continue command rewrites, found ${changed}`);
  },
};

export default patch;
