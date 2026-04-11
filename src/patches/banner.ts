/**
 * Attribution Banner Patch
 *
 * Changes "Claude Code" to "Claude Code Extensions (cx) v<version> by @wormcoffee" on the title line.
 * Targets the bold <Text> in the condensed layout and the border title
 * in the boxed layout. No extra elements, no layout changes.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Patch } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf-8'));
const version = pkg.version as string;

const patch: Patch = {
  id: 'banner',
  name: 'Attribution Banner',
  description: 'Show "@wormcoffee" on the Claude Code title line',

  apply(ctx) {
    const { ast, editor, find, index, src, assert } = ctx;
    const { findFirst } = find;

    // OSC 8 terminal hyperlink wrapping "x.com/wormcoffee" → https://x.com/wormcoffee.
    // Sequence: ESC ] 8 ; ; URL BEL TEXT ESC ] 8 ; ; BEL
    // \\u001B / \\u0007 survive the template literal to become \u001B / \u0007
    // in the injected JS source, which parses to the real ESC/BEL control chars.
    const linkedHandle =
      '\\u001B]8;;https://x.com/wormcoffee\\u0007x.com/wormcoffee\\u001B]8;;\\u0007';

    // ── Condensed layout: createElement(T, {bold:true}, "Claude Code") ──
    // Use literal index to find "Claude Code", then walk up to the createElement call.

    const claudeCodeLiterals = index.literalsByValue.get('Claude Code') || [];
    let boldTextCall = null;
    for (const lit of claudeCodeLiterals) {
      const call = index.ancestor(lit, 'CallExpression');
      if (!call || call.callee.type !== 'MemberExpression' || call.callee.property.name !== 'createElement') continue;
      const hasBold = call.arguments.some((a: any) =>
        a?.type === 'ObjectExpression' &&
        a.properties.some((p: any) => p.key?.type === 'Identifier' && p.key.name === 'bold'));
      if (hasBold) { boldTextCall = call; break; }
    }
    assert(boldTextCall, 'Could not find createElement(T, {bold}, "Claude Code")');

    const textLiteral = boldTextCall.arguments.find((a: any) =>
      a.type === 'Literal' && a.value === 'Claude Code');
    editor.replaceRange(textLiteral.start, textLiteral.end,
      `"Claude Code Extensions (cx) v${version} by ${linkedHandle}"`);

    // ── Star-the-repo line in the condensed layout ──
    // The column Box has children: I (title), B (model), R (cwd), g, F
    // We find the column Box (flexDirection:"column") that contains the bold title,
    // then inject a dimColor text after the title argument.

    const condensedFn = index.enclosingFunction(boldTextCall);
    assert(condensedFn, 'Could not find enclosing function for condensed logo');

    // Find the column Box: createElement(u, {flexDirection:"column"}, I, B, R, ...)
    const columnBox = find.findFirst(condensedFn, (n: any) =>
      n.type === 'CallExpression' &&
      n.arguments?.[1]?.type === 'ObjectExpression' &&
      n.arguments[1].properties?.some?.((p: any) =>
        p.key?.name === 'flexDirection' && p.value?.value === 'column'));
    assert(columnBox, 'Could not find column Box in condensed logo');

    // The first child after the props object is the title element (I).
    // Insert our star text element right after it.
    const columnArgs = columnBox.arguments;
    // args[0] = Box component, args[1] = {flexDirection:"column"}, args[2..] = children
    assert(columnArgs.length >= 3, 'Column Box has no children');
    const titleChild = columnArgs[2]; // I — the title element

    // Get the React namespace, Text and Box components from the createElement calls
    const reactNs = src(boldTextCall.callee.object);  // e.g. "qO"
    const textComp = src(boldTextCall.arguments[0]);   // e.g. "T"
    const boxComp = src(columnBox.arguments[0]);       // e.g. "u"

    const starText = `${reactNs}.createElement(${textComp},{dimColor:!0},"I don\\u0027t ask for money. Just for love!\\nPlease star the repo \\u2B50\\uFE0F https://github.com/magidandrew/cx \\uD83D\\uDC49\\uD83D\\uDC48")`;

    editor.insertAt(titleChild.end,
      `,${starText}`);

    // ── Compact boxed (v2) layout: inject star lines at the bottom ──
    // Find the compact boxed container: createElement(u, {borderStyle:"round", borderColor:"claude", borderText:...})
    // and inject star lines after the last child (cwd line).

    const borderTextLiterals = index.allNodes.filter((n: any) =>
      n.type === 'Property' && n.key?.name === 'borderText');
    for (const prop of borderTextLiterals) {
      const obj = index.parentMap.get(prop);
      if (!obj || obj.type !== 'ObjectExpression') continue;
      // Must also have borderColor:"claude"
      const hasClaudeColor = obj.properties.some((p: any) =>
        p.key?.name === 'borderColor' && p.value?.value === 'claude');
      if (!hasClaudeColor) continue;
      // This is the boxed logo. Find the enclosing createElement call.
      const boxCall = index.parentMap.get(obj);
      if (!boxCall || boxCall.type !== 'CallExpression') continue;
      // Last argument is the last child — inject after it
      const lastArg = boxCall.arguments[boxCall.arguments.length - 1];
      // Get React namespace from this scope
      const boxReactNs = src(boxCall.callee.object);
      editor.insertAt(lastArg.end,
        `,${boxReactNs}.createElement(${textComp},{dimColor:!0},"\\nI don\\u0027t ask for money. Just for love!\\nPlease star the repo \\u2B50\\uFE0F https://github.com/magidandrew/cx \\uD83D\\uDC49\\uD83D\\uDC48")`);
      break;
    }

    // ── Wide (LogoV2) layout: inject star line into the model+cwd group ──
    // LogoV2.tsx: `t22 = <Box flexDirection="column" alignItems="center">{t20}{t21}</Box>`
    // This is the bottom group inside the left column of the wide layout.
    // Match: createElement(_, {flexDirection:"column", alignItems:"center"}, _, _)
    // with exactly 2 props and exactly 2 children, uniquely identifying t22.
    const wideGroupCall = find.findFirst(ast, (n: any) => {
      if (n.type !== 'CallExpression') return false;
      if (n.callee?.type !== 'MemberExpression' || n.callee.property?.name !== 'createElement') return false;
      if (n.arguments.length !== 4) return false; // component, props, child, child
      const props = n.arguments[1];
      if (props?.type !== 'ObjectExpression' || props.properties.length !== 2) return false;
      const propNames = props.properties.map((p: any) => `${p.key?.name}:${p.value?.value}`);
      return propNames.includes('flexDirection:column') && propNames.includes('alignItems:center');
    });
    if (wideGroupCall) {
      const wideReactNs = src(wideGroupCall.callee.object);
      const wideLastArg = wideGroupCall.arguments[wideGroupCall.arguments.length - 1];
      editor.insertAt(wideLastArg.end,
        `,${wideReactNs}.createElement(${textComp},{dimColor:!0},"\\nI don\\u0027t ask for money. Just for love!\\nPlease star the repo \\u2B50\\uFE0F https://github.com/magidandrew/cx \\uD83D\\uDC49\\uD83D\\uDC48")`);
    }

    // ── Boxed layout: b7("claude",o)("Claude Code") ──
    // Find "Claude Code" literal whose parent CallExpression's callee is another call with "claude"
    let titleCall = null;
    for (const lit of claudeCodeLiterals) {
      const call = index.parentMap.get(lit);
      if (!call || call.type !== 'CallExpression' || call.arguments.length !== 1) continue;
      if (call.callee.type === 'CallExpression' &&
          call.callee.arguments[0]?.type === 'Literal' &&
          call.callee.arguments[0].value === 'claude') {
        titleCall = call;
        break;
      }
    }
    if (titleCall) {
      editor.replaceRange(titleCall.arguments[0].start, titleCall.arguments[0].end,
        `"Claude Code Extensions (cx) v${version} by ${linkedHandle}"`);
    }
  },
};

export default patch;
