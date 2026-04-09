/**
 * Show File Paths in Collapsed Read/Search Display
 *
 * Instead of just "Read 3 files", shows the actual file paths:
 *   Read 3 files (src/foo.ts, src/bar.ts, src/baz.ts)
 * Instead of just "Searched for 1 pattern", shows:
 *   Searched for 1 pattern ("handleSubmit")
 *
 * Addresses: https://github.com/anthropics/claude-code/issues/21151 (184 👍)
 *
 * The data is already there — readFilePaths and searchArgs are extracted
 * from the message but only shown during active execution as a hint.
 * This patch adds them to the completed collapsed display.
 */

export default {
  id: 'show-file-in-collapsed-read',
  name: 'Show File in Collapsed Read',
  description: 'Show file paths and search patterns in collapsed tool display',

  apply(ctx) {
    const { ast, editor, find, index, assert, src, query } = ctx;
    const { findFirst, findAll } = find;

    // ─── Step 1: Find the collapsed display rendering function ───
    // Identified by containing key:"read", key:"search", and key:"comma-r" literals.
    // Use the indexed findFunctionsContainingStrings for O(matches) lookup.
    const renderFns = query.findFunctionsContainingStrings(ast, 'comma-r', 'read', 'search');
    const renderFn = renderFns[0];
    assert(renderFn, 'Could not find collapsed display render function (markers: key:"read", key:"search", key:"comma-r")');

    // ─── Step 2: Discover variable names ───
    // Find the readFilePaths variable: pattern is X=q.readFilePaths
    // Find the searchArgs variable: pattern is X=q.searchArgs
    // Find the getDisplayPath function: pattern is X(Y):M where it's used near readFilePaths

    // Find readFilePaths property access
    const readFilePathsAccess = findFirst(renderFn, n =>
      n.type === 'MemberExpression'
      && n.property.type === 'Identifier'
      && n.property.name === 'readFilePaths'
    );
    assert(readFilePathsAccess, 'Could not find q.readFilePaths access');

    // The assignment: Q = q.readFilePaths — Q is the variable we need
    const readPathsAssignment = findFirst(renderFn, n =>
      n.type === 'VariableDeclarator'
      && n.init === readFilePathsAccess
    );
    assert(readPathsAssignment, 'Could not find readFilePaths variable assignment');
    const readPathsVar = readPathsAssignment.id.name;

    // Find searchArgs variable similarly
    const searchArgsAccess = findFirst(renderFn, n =>
      n.type === 'MemberExpression'
      && n.property.type === 'Identifier'
      && n.property.name === 'searchArgs'
    );
    assert(searchArgsAccess, 'Could not find q.searchArgs access');
    const searchArgsAssignment = findFirst(renderFn, n =>
      n.type === 'VariableDeclarator'
      && n.init === searchArgsAccess
    );
    assert(searchArgsAssignment, 'Could not find searchArgs variable assignment');
    const searchArgsVar = searchArgsAssignment.id.name;

    // Find getDisplayPath function name by looking for its call pattern:
    // It's called like: F5(X6) right after readFilePaths is accessed,
    // in the pattern: X!==void 0?F5(X):M
    // The call is on a variable that came from Q?.at(-1)
    const getDisplayPathCall = findFirst(renderFn, n => {
      if (n.type !== 'ConditionalExpression') return false;
      // Look for: X!==void 0 ? CALL(X) : Y
      // where CALL is a single-argument function call
      if (n.consequent.type !== 'CallExpression') return false;
      if (n.consequent.arguments.length !== 1) return false;
      // The callee should be an Identifier (the getDisplayPath function)
      if (n.consequent.callee.type !== 'Identifier') return false;
      // This should appear after readFilePaths is used
      return n.start > readFilePathsAccess.start;
    });
    assert(getDisplayPathCall, 'Could not find getDisplayPath call pattern');
    const displayPathFn = getDisplayPathCall.consequent.callee.name;

    // ─── Step 3: Find the React library reference ───
    // Look for createElement calls in the function — C4.default.createElement(...)
    // Find the pattern: X.default.createElement(Y, {key:"read"}, ...)
    const readElement = findFirst(renderFn, n => {
      if (n.type !== 'CallExpression') return false;
      // Check for: X.default.createElement
      const callee = n.callee;
      if (callee.type !== 'MemberExpression') return false;
      if (callee.property.name !== 'createElement') return false;
      // Check args for key:"read"
      return n.arguments.some(arg =>
        arg.type === 'ObjectExpression'
        && arg.properties?.some(p =>
          p.key?.name === 'key' && p.value?.value === 'read'
        )
      );
    });
    assert(readElement, 'Could not find createElement with key:"read"');

    // Extract the React reference (e.g., C4) from C4.default.createElement
    const reactRef = src(readElement.callee.object.object);

    // ─── Step 4: Find the Text component reference ───
    // The readElement is: createElement(T, {key:"read"}, M6, " ", createElement(T, {bold:!0}, b), ...)
    // The first argument (index 0) is the Text component reference.
    const textComponent = src(readElement.arguments[0]);

    // ─── Step 5: Find the "Searched for" element and inject search pattern ───
    // Pattern: z6.push(createElement(T, {key:"search"}, M6, " ", createElement(T, {bold:true}, I), " ", I===1?"pattern":"patterns"))
    // We want to add the search pattern text after "patterns")
    const searchElement = findFirst(renderFn, n => {
      if (n.type !== 'CallExpression') return false;
      if (n.callee.type !== 'MemberExpression') return false;
      if (n.callee.property.name !== 'createElement') return false;
      return n.arguments.some(arg =>
        arg.type === 'ObjectExpression'
        && arg.properties?.some(p =>
          p.key?.name === 'key' && p.value?.value === 'search'
        )
      );
    });
    assert(searchElement, 'Could not find createElement with key:"search"');

    // Find the push() call that contains this search element
    const searchPush = findFirst(renderFn, n =>
      n.type === 'CallExpression'
      && n.callee.type === 'MemberExpression'
      && n.callee.property.name === 'push'
      && n.arguments.length === 1
      && n.arguments[0] === searchElement
    );
    assert(searchPush, 'Could not find push() call for search element');

    // After the search push, inject a conditional that shows the search patterns
    // Show: (pattern1, pattern2, ...)
    const searchPathCode = `;if(${searchArgsVar}&&${searchArgsVar}.length>0){` +
      `z6.push(${reactRef}.default.createElement(${textComponent},{key:"search-args",dimColor:!0},` +
      `" (",${searchArgsVar}.map(function(p){return\'"\\'\\'"+p+\'"\\'\\'\'}).join(", "),")"))` +
      `}`;

    // Wait — the array variable name might not be z6. Let's find it.
    // The push() callee object is the array variable.
    const elemArrayVar = src(searchPush.callee.object);

    const searchPathCodeFinal = `;if(${searchArgsVar}&&${searchArgsVar}.length>0){` +
      `${elemArrayVar}.push(${reactRef}.default.createElement(${textComponent},{key:"search-args",dimColor:!0},` +
      `" (",${searchArgsVar}.map(function(p){return '"'+p+'"'}).join(", "),")"))` +
      `}`;

    // Find the enclosing if-block for the search element by walking up the parent chain
    const searchIfBlock = index.ancestor(searchElement, 'IfStatement');
    assert(searchIfBlock, 'Could not find if block containing search element');

    editor.insertAt(searchIfBlock.end, searchPathCodeFinal);

    // ─── Step 6: Find the "Read" element and inject file paths ───
    // After the if(b>0){...} block, inject file path display
    const readIfBlock = index.ancestor(readElement, 'IfStatement');
    assert(readIfBlock, 'Could not find if block containing read element');

    // Inject after the read if-block:
    // Show file paths: " (src/foo.ts, src/bar.ts)" for up to 3 files,
    // or " (src/foo.ts… +2 more)" for >3 files
    const readPathCode = `;if(${readPathsVar}&&${readPathsVar}.length>0){` +
      `var __paths=${readPathsVar}.length<=3?` +
        `${readPathsVar}.map(${displayPathFn}).join(", "):` +
        `${displayPathFn}(${readPathsVar}[${readPathsVar}.length-1])+"… +"+(${readPathsVar}.length-1)+" more";` +
      `${elemArrayVar}.push(${reactRef}.default.createElement(${textComponent},{key:"read-paths",dimColor:!0},` +
      `" (",__paths,")"))` +
      `}`;

    editor.insertAt(readIfBlock.end, readPathCode);
  },
};
