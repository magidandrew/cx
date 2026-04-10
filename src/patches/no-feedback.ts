/**
 * No Feedback Patch
 *
 * Strips all feedback survey prompts from Claude Code. The FeedbackSurvey
 * component renders session ratings ("How is Claude doing this session?"),
 * post-compact surveys, memory surveys, transcript share prompts, and
 * frustration detection prompts. Patching this single component to
 * return null silences all of them.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'no-feedback',
  name: 'No Feedback Prompts',
  description: 'Remove feedback survey prompts',

  apply(ctx) {
    const { ast, editor, query, assert } = ctx;

    // The FeedbackSurvey component contains the unique string
    // " Thanks for sharing your transcript!" (with leading space) in
    // its JSX. Find the smallest function containing that marker.
    const marker = ' Thanks for sharing your transcript!';
    const candidates = query.findFunctionsContainingStrings(ast, marker);
    assert(candidates.length > 0, `Could not find FeedbackSurvey component (marker: "${marker}")`);

    // Take the smallest function (the component itself, not a wrapper).
    const fn = candidates
      .sort((a: any, b: any) => (a.end - a.start) - (b.end - b.start))[0];
    assert(fn.body?.type === 'BlockStatement',
      'FeedbackSurvey: expected block body');

    // Inject early return so the component always renders nothing.
    editor.insertAt(fn.body.start + 1, 'return null;');
  },
};

export default patch;
