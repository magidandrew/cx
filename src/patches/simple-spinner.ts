/**
 * Simple Spinner Patch
 *
 * Replaces the rotating spinner verbs ("Thinking", "Analyzing", etc.)
 * with a single static "working" verb, and replaces the completion
 * verbs ("Baked", "Brewed", etc.) with a single "worked" verb.
 *
 * The spinner animation (dots) is preserved — only the text is simplified.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'simple-spinner',
  name: 'Simple Spinner',
  description: 'Replace spinner verb cycling with static "working" / "worked"',

  apply(ctx) {
    const { ast, editor, query, assert } = ctx;
    const { findArrayWithConsecutiveStrings } = query;

    // ── Active spinner verbs ────────────────────────────────────────────
    // SPINNER_VERBS is a large array starting with "Accomplishing", "Actioning", ...
    const spinnerArr = findArrayWithConsecutiveStrings(ast, 'Accomplishing', 'Actioning');
    assert(spinnerArr, 'Could not find SPINNER_VERBS array (looked for "Accomplishing","Actioning")');
    editor.replaceRange(spinnerArr.start, spinnerArr.end, '["working"]');

    // ── Completion verbs ────────────────────────────────────────────────
    // TURN_COMPLETION_VERBS is a smaller array starting with "Baked", "Brewed", ...
    const completionArr = findArrayWithConsecutiveStrings(ast, 'Baked', 'Brewed');
    assert(completionArr, 'Could not find TURN_COMPLETION_VERBS array (looked for "Baked","Brewed")');
    editor.replaceRange(completionArr.start, completionArr.end, '["worked"]');
  },
};

export default patch;
