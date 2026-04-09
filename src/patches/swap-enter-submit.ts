/**
 * Swap Enter / Meta+Enter
 *
 * Makes Enter insert a newline and Meta+Enter (Option+Enter on macOS) submit.
 *
 * Addresses: https://github.com/anthropics/claude-code/issues/2054 (72 reactions)
 *
 * CJK users, SSH users, and anyone with Slack-style muscle memory constantly
 * submit half-written prompts by accident. This patch swaps the default
 * bindings so Enter is safe (newline) and Meta+Enter is deliberate (submit).
 *
 * Why keybinding changes alone aren't enough:
 *
 * The Enter key's submit behavior is hard-coded in useTextInput.ts's
 * handleEnter() function — it directly calls onSubmit() for plain Enter
 * and cursor.insert('\n') for Meta/Shift+Enter, bypassing the keybinding
 * system entirely.
 *
 * This patch modifies THREE layers:
 *   1. DEFAULT_BINDINGS — so shortcut hints and the help menu show correctly
 *   2. handleEnter() — so the actual key behavior is swapped
 *   3. Tip/help text — so instructions match the new behavior
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'swap-enter-submit',
  name: 'Swap Enter / Meta+Enter',
  description: 'Enter inserts newline, Option/Alt+Enter submits',
  defaultEnabled: false,

  apply(ctx) {
    const { ast, editor, query, find, src, assert } = ctx;
    const { findObjectWithStringProps } = query;
    const { findFirst, findAll } = find;

    // ── Patch 1: DEFAULT_BINDINGS ────────────────────────────────────

    const obj = findObjectWithStringProps(ast, [
      ['enter', 'chat:submit'],
      ['up', 'history:previous'],
    ]);
    assert(obj, 'Could not find DEFAULT_BINDINGS object');

    const enterProp = obj.properties.find((p: any) =>
      p.type === 'Property' &&
      ((p.key.type === 'Identifier' && p.key.name === 'enter') ||
       (p.key.type === 'Literal' && p.key.value === 'enter')));
    assert(enterProp, 'Could not find "enter" property in DEFAULT_BINDINGS');

    assert(
      enterProp.value.type === 'Literal' && enterProp.value.value === 'chat:submit',
      'enter property value is not "chat:submit"',
    );
    editor.replaceRange(enterProp.value.start, enterProp.value.end, '"chat:newline"');
    editor.insertAt(enterProp.end, ',"meta+enter":"chat:submit"');

    // ── Patch 2: handleEnter() in useTextInput ───────────────────────
    //
    // Original handleEnter:
    //   if (backslash) → backslash+newline (keep)
    //   if (key.meta || key.shift) → cursor.insert('\n')
    //   if (Apple_Terminal && shift) → cursor.insert('\n')
    //   onSubmit?.(originalValue)
    //
    // After patch:
    //   if (backslash) → backslash+newline (unchanged)
    //   if (key.meta) → onSubmit (Meta/Option+Enter submits)
    //   if (key.shift) → cursor.insert('\n') (Shift+Enter still inserts newline)
    //   (Apple_Terminal block removed — not needed; Meta works via Option key,
    //    and plain Enter newlines go through keybinding system)
    //   return cursor (plain Enter = no-op; keybinding system handles
    //                  Enter → chat:newline → handleNewline in PromptInput)

    // Find handleEnter by stable markers. Take the SMALLEST matching
    // function (handleEnter is nested inside useTextInput).
    const isHandleEnterCandidate = (node: any) => {
      if (node.type !== 'FunctionDeclaration' && node.type !== 'FunctionExpression') return false;
      if (!findFirst(node, (n: any) => n.type === 'Literal' && n.value === 'Apple_Terminal')) return false;
      if (!findFirst(node, (n: any) =>
        n.type === 'CallExpression' && n.callee.type === 'MemberExpression' &&
        n.callee.property.name === 'backspace')) return false;
      return findFirst(node, (n: any) =>
        n.type === 'LogicalExpression' && n.operator === '||' &&
        n.left.type === 'MemberExpression' && n.left.property.name === 'meta' &&
        n.right.type === 'MemberExpression' && n.right.property.name === 'shift') !== null;
    };
    const candidates = findAll(ast, isHandleEnterCandidate);
    assert(candidates.length >= 1, 'Could not find handleEnter function');
    candidates.sort((a: any, b: any) => (a.end - a.start) - (b.end - b.start));
    const handleEnterFn = candidates[0];

    // Discover minified variable names

    // key variable: from key.meta || key.shift
    const metaOrShift = findFirst(handleEnterFn, (n: any) =>
      n.type === 'LogicalExpression' && n.operator === '||' &&
      n.left.type === 'MemberExpression' && n.left.property.name === 'meta' &&
      n.right.type === 'MemberExpression' && n.right.property.name === 'shift');
    const keyVar = src(metaOrShift.left.object);

    // if-statement that tests meta||shift
    const metaShiftIf = findFirst(handleEnterFn, (n: any) => {
      if (n.type !== 'IfStatement') return false;
      const t = n.test;
      return t.type === 'LogicalExpression' && t.operator === '||' &&
        t.left.type === 'MemberExpression' && t.left.property.name === 'meta' &&
        t.right.type === 'MemberExpression' && t.right.property.name === 'shift';
    });
    assert(metaShiftIf, 'Could not find if-statement for meta||shift');

    // cursor variable: from cursor.insert('\n') (where cursor is a plain Identifier)
    const isNewlineArg = (n: any) =>
      (n.type === 'Literal' && n.value === '\n') ||
      (n.type === 'TemplateLiteral' && n.expressions.length === 0 &&
       n.quasis.length === 1 && n.quasis[0].value.cooked === '\n');
    const cursorInserts = findAll(handleEnterFn, (n: any) =>
      n.type === 'CallExpression' &&
      n.callee.type === 'MemberExpression' &&
      n.callee.object.type === 'Identifier' &&
      n.callee.property.name === 'insert' &&
      n.arguments.length === 1 && isNewlineArg(n.arguments[0]));
    assert(cursorInserts.length >= 1, 'Could not find cursor.insert("\\n") in handleEnter');
    const cursorVar = cursorInserts[0].callee.object.name;

    // onSubmit?.(originalValue): last statement in handleEnter body
    const bodyStmts = handleEnterFn.body.body;
    const lastStmt = bodyStmts[bodyStmts.length - 1];
    assert(
      lastStmt.type === 'ExpressionStatement',
      'Last statement of handleEnter is not an ExpressionStatement',
    );
    const onSubmitCallSrc = src(lastStmt.expression);

    // Apple Terminal if-block
    const appleTerminalIf = findFirst(handleEnterFn, (n: any) => {
      if (n.type !== 'IfStatement') return false;
      return findFirst(n.test, (t: any) => t.type === 'Literal' && t.value === 'Apple_Terminal') !== null;
    });

    // ── Apply edits (editor applies in reverse position order) ───────

    // 2d: Replace fallthrough onSubmit with return cursor (no-op).
    editor.replaceRange(lastStmt.start, lastStmt.end, `return ${cursorVar}`);

    // 2c: Remove Apple Terminal if-block — no longer needed.
    //     Meta/Option works natively in Apple Terminal (sends ESC+CR when
    //     "Use Option as Meta Key" is enabled via /terminal-setup).
    //     Plain Enter newlines go through the keybinding system.
    if (appleTerminalIf) {
      editor.replaceRange(appleTerminalIf.start, appleTerminalIf.end, '');
    }

    // 2b: Replace meta||shift block. Now: Meta+Enter (Option+Enter) → submit,
    //     Shift+Enter → newline (for CSI u terminals), plain Enter → no-op.
    //     Meta+Enter is the only reliable modifier+Enter across all terminals
    //     because it sends ESC+CR — a distinct sequence. Ctrl+Enter and
    //     Shift+Enter send the same byte as plain Enter in most terminals.
    editor.replaceRange(metaShiftIf.start, metaShiftIf.end,
      `if(${keyVar}.meta){${onSubmitCallSrc};return}` +
      `if(${keyVar}.shift)return ${cursorVar}.insert("\\n");`);

    // ── Patch 3: Tip text ────────────────────────────────────────────

    const shiftEnterTip = findFirst(ast, (n: any) =>
      n.type === 'Literal' && n.value === 'Press Shift+Enter to send a multi-line message');
    if (shiftEnterTip) {
      editor.replaceRange(shiftEnterTip.start, shiftEnterTip.end,
        '"Press Option+Enter to submit your message"');
    }

    const optionEnterTip = findFirst(ast, (n: any) =>
      n.type === 'Literal' && n.value === 'Press Option+Enter to send a multi-line message');
    if (optionEnterTip) {
      editor.replaceRange(optionEnterTip.start, optionEnterTip.end,
        '"Press Option+Enter to submit your message"');
    }

    // ── Patch 4: Help menu newline instructions ──────────────────────

    for (const val of ['shift + ⏎ for newline', '\\⏎ for newline',
                        'backslash (\\) + return (⏎) for newline']) {
      const nodes = findAll(ast, (n: any) => n.type === 'Literal' && n.value === val);
      for (const node of nodes) {
        editor.replaceRange(node.start, node.end, '"option + ⏎ to send"');
      }
    }
  },
};

export default patch;
