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
    // Two bundle shapes to handle:
    //
    //   OLD shape (≤2.1.101): handleEnter(input, key) with `key.meta` /
    //   `key.shift` as MemberExpressions, and onSubmit called as the
    //   LAST statement (e.g. `onSubmit?.(originalValue)`).
    //
    //     if (backslash) → backslash+newline
    //     if (key.meta || key.shift) → cursor.insert('\n')
    //     if (Apple_Terminal && shift) → cursor.insert('\n')
    //     onSubmit?.(originalValue)
    //
    //   NEW shape (≥2.1.105): params destructured as `{meta:A, shift:B}`,
    //   and onSubmit is invoked inside an earlier `if (onSubmit) …`
    //   statement, followed by `return cursor` as the last statement.
    //
    //     function handleEnter({meta:A, shift:B}) {
    //       if (backslash) return …;
    //       if (A || B) return cursor.insert('\n');
    //       if (terminal === 'Apple_Terminal' && …) return cursor.insert('\n');
    //       if (onSubmit) onSubmit(cursor.text), submitted = !0;
    //       return cursor;
    //     }
    //
    // After patch (both shapes):
    //   if (backslash) → backslash+newline (unchanged)
    //   if (meta) → run the onSubmit side effect, then return cursor
    //   if (shift) → cursor.insert('\n')
    //   (Apple_Terminal block removed — Meta works natively via Option)
    //   (plain Enter = no-op; keybinding system routes Enter → chat:newline)

    // Find handleEnter. Accept EITHER shape: the unifying markers are
    // Apple_Terminal literal and .backspace() call; the third marker
    // can be either `X.meta || X.shift` (old) or a destructured
    // `{meta:_, shift:_}` first param (new).
    const isDestructuredMetaShift = (node: any) => {
      const p = node.params?.[0];
      if (p?.type !== 'ObjectPattern') return false;
      const has = (name: string) => p.properties?.some((pp: any) =>
        pp.type === 'Property' && pp.key?.type === 'Identifier' && pp.key.name === name &&
        pp.value?.type === 'Identifier');
      return has('meta') && has('shift');
    };
    const isMemberMetaOrShift = (node: any) =>
      findFirst(node, (n: any) =>
        n.type === 'LogicalExpression' && n.operator === '||' &&
        n.left.type === 'MemberExpression' && n.left.property?.name === 'meta' &&
        n.right.type === 'MemberExpression' && n.right.property?.name === 'shift') !== null;

    const isHandleEnterCandidate = (node: any) => {
      if (node.type !== 'FunctionDeclaration' && node.type !== 'FunctionExpression') return false;
      if (!findFirst(node, (n: any) => n.type === 'Literal' && n.value === 'Apple_Terminal')) return false;
      if (!findFirst(node, (n: any) =>
        n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' &&
        n.callee.property?.name === 'backspace')) return false;
      return isDestructuredMetaShift(node) || isMemberMetaOrShift(node);
    };
    const candidates = findAll(ast, isHandleEnterCandidate);
    assert(candidates.length >= 1, 'Could not find handleEnter function');
    candidates.sort((a: any, b: any) => (a.end - a.start) - (b.end - b.start));
    const handleEnterFn = candidates[0];
    const isNewShape = isDestructuredMetaShift(handleEnterFn);

    // Discover the meta/shift references: either MemberExpression names
    // (old shape) or destructured parameter names (new shape).
    let metaTestSrc: string;   // e.g. "K.meta" or "Z6"
    let shiftTestSrc: string;  // e.g. "K.shift" or "E6"
    let metaShiftIf: any;

    if (isNewShape) {
      const p = handleEnterFn.params[0];
      const metaProp = p.properties.find((pp: any) =>
        pp.type === 'Property' && pp.key?.type === 'Identifier' && pp.key.name === 'meta');
      const shiftProp = p.properties.find((pp: any) =>
        pp.type === 'Property' && pp.key?.type === 'Identifier' && pp.key.name === 'shift');
      metaTestSrc = metaProp.value.name;
      shiftTestSrc = shiftProp.value.name;
      metaShiftIf = findFirst(handleEnterFn, (n: any) => {
        if (n.type !== 'IfStatement') return false;
        const t = n.test;
        return t.type === 'LogicalExpression' && t.operator === '||' &&
          t.left.type === 'Identifier' && t.left.name === metaTestSrc &&
          t.right.type === 'Identifier' && t.right.name === shiftTestSrc;
      });
    } else {
      const metaOrShift = findFirst(handleEnterFn, (n: any) =>
        n.type === 'LogicalExpression' && n.operator === '||' &&
        n.left.type === 'MemberExpression' && n.left.property.name === 'meta' &&
        n.right.type === 'MemberExpression' && n.right.property.name === 'shift');
      const keyVar = src(metaOrShift.left.object);
      metaTestSrc = `${keyVar}.meta`;
      shiftTestSrc = `${keyVar}.shift`;
      metaShiftIf = findFirst(handleEnterFn, (n: any) => {
        if (n.type !== 'IfStatement') return false;
        const t = n.test;
        return t.type === 'LogicalExpression' && t.operator === '||' &&
          t.left.type === 'MemberExpression' && t.left.property.name === 'meta' &&
          t.right.type === 'MemberExpression' && t.right.property.name === 'shift';
      });
    }
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

    // onSubmit side effect — source differs between shapes:
    //   OLD: last body statement, e.g. `onSubmit?.(originalValue)`
    //   NEW: intermediate `if (onSubmit) onSubmit(cursor.text), submitted=!0;`
    // In both cases we capture the exact source so the Meta branch can
    // replay the same side effect verbatim, preserving the "only call
    // onSubmit if defined" semantics and the submitted-flag update.
    const bodyStmts = handleEnterFn.body.body;
    let submitStmt: any;   // full statement to splice (including trailing `;` and test guard)
    let submitExprSrc: string;  // source to embed inside the Meta branch

    if (isNewShape) {
      // Look for an IfStatement whose test is a single Identifier and
      // whose consequent calls that same Identifier (with cursor.text).
      // This is distinct from the meta/shift if (which has a LogicalExpression test).
      submitStmt = findFirst(handleEnterFn, (n: any) => {
        if (n.type !== 'IfStatement') return false;
        if (n.test?.type !== 'Identifier') return false;
        const testName = n.test.name;
        return findFirst(n.consequent, (c: any) =>
          c.type === 'CallExpression' &&
          c.callee?.type === 'Identifier' &&
          c.callee.name === testName) !== null;
      });
      assert(submitStmt, 'Could not find `if (onSubmit) onSubmit(...)` block in handleEnter');
      submitExprSrc = src(submitStmt);
    } else {
      const lastStmt = bodyStmts[bodyStmts.length - 1];
      assert(
        lastStmt.type === 'ExpressionStatement',
        'Last statement of handleEnter is not an ExpressionStatement',
      );
      submitStmt = lastStmt;
      submitExprSrc = src(lastStmt.expression);
    }

    // Apple Terminal if-block — present in both shapes
    const appleTerminalIf = findFirst(handleEnterFn, (n: any) => {
      if (n.type !== 'IfStatement') return false;
      return findFirst(n.test, (t: any) => t.type === 'Literal' && t.value === 'Apple_Terminal') !== null;
    });

    // ── Apply edits ──────────────────────────────────────────────────

    // 2d: Remove/rewrite the onSubmit statement.
    //     OLD: `onSubmit?.(value)` → `return cursor`
    //     NEW: `if(onSubmit) onSubmit(cursor.text), submitted=!0;` → ``
    //          (the trailing `return cursor` already handles the no-op return)
    if (isNewShape) {
      editor.replaceRange(submitStmt.start, submitStmt.end, '');
    } else {
      editor.replaceRange(submitStmt.start, submitStmt.end, `return ${cursorVar}`);
    }

    // 2c: Remove Apple Terminal if-block.
    if (appleTerminalIf) {
      editor.replaceRange(appleTerminalIf.start, appleTerminalIf.end, '');
    }

    // 2b: Replace meta||shift block with split meta/shift branches.
    //     Meta+Enter (Option+Enter) → submit; Shift+Enter → newline;
    //     plain Enter → no-op. Meta+Enter is the only reliable
    //     modifier+Enter across all terminals (sends ESC+CR — distinct
    //     sequence). Ctrl+Enter and Shift+Enter send the same byte as
    //     plain Enter in most terminals.
    //
    //     OLD branch body: `${onSubmitExprSrc};return`
    //     NEW branch body: `${submitIfSrc}return ${cursor}` — replay the
    //     full `if(onSubmit) onSubmit(cursor.text), submitted=!0;`
    //     statement verbatim, then return cursor unchanged.
    const metaBranch = isNewShape
      ? `{${submitExprSrc}return ${cursorVar}}`
      : `{${submitExprSrc};return}`;
    editor.replaceRange(metaShiftIf.start, metaShiftIf.end,
      `if(${metaTestSrc})${metaBranch}` +
      `if(${shiftTestSrc})return ${cursorVar}.insert("\\n");`);

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
