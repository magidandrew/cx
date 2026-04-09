/**
 * No Attribution Patch
 *
 * Strips all Claude Code attribution from commits and PRs:
 *   - Removes "Co-Authored-By: <model> <noreply@anthropic.com>" from commits
 *   - Removes "🤖 Generated with Claude Code" from PR descriptions
 *   - Removes enhanced attribution ("X% N-shotted by ...") from PRs
 *
 * Works by patching getAttributionTexts() and getEnhancedPRAttribution()
 * to return empty strings, which the prompt templates already handle
 * gracefully via ternary guards.
 */

export default {
  id: 'no-attribution',
  name: 'No Attribution',
  description: 'Strip Claude Code attribution from commits and PRs',

  apply(ctx) {
    const { ast, editor, find, index, assert } = ctx;

    // ── getAttributionTexts ──────────────────────────────────────────
    // Returns { commit: "Co-Authored-By: ...", pr: "🤖 Generated..." }
    // Find via TemplateLiteral quasis containing "noreply@anthropic.com"

    const noreplyQuasi = find.findFirst(ast, n =>
      n.type === 'TemplateElement' &&
      n.value?.cooked?.includes('noreply@anthropic.com'));
    assert(noreplyQuasi, 'Could not find TemplateElement with noreply@anthropic.com');

    const getAttrTexts = index.enclosingFunction(noreplyQuasi);
    assert(getAttrTexts, 'Could not find enclosing function for noreply quasi');
    assert(getAttrTexts.body.type === 'BlockStatement',
      'getAttributionTexts body is not a BlockStatement');

    // Insert early return at start of function body
    editor.insertAt(getAttrTexts.body.start + 1, 'return{commit:"",pr:""};');

    // ── getEnhancedPRAttribution ─────────────────────────────────────
    // Returns "🤖 Generated with Claude Code (X% N-shotted by ...)"
    // Find via the unique debug string literal it contains

    const enhancedFns = index.findFunctionsContainingStrings(
      ast, 'PR Attribution: returning default (no data)');
    assert(enhancedFns.length >= 1,
      'Could not find getEnhancedPRAttribution (PR Attribution debug string)');

    const getEnhanced = enhancedFns[0];
    assert(getEnhanced.body.type === 'BlockStatement',
      'getEnhancedPRAttribution body is not a BlockStatement');

    // Insert early return (async fn, so return "" resolves to Promise<"">)
    editor.insertAt(getEnhanced.body.start + 1, 'return"";');
  },
};
