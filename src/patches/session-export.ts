/**
 * /export Command Patch
 *
 * Adds a /export slash command to copy the entire conversation session
 * to the system clipboard as readable markdown.
 *
 * Addresses: https://github.com/magidandrew/cx/issues/2
 *
 * AST strategy: find the COMMANDS array (same approach as cd-command),
 * then inject a new LocalCommand that reads context.messages,
 * formats them as markdown, and copies to clipboard using
 * child_process (pbcopy on macOS, xclip/xsel/wl-copy on Linux).
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'session-export',
  name: '/export Command',
  description: '/export — copy the full session transcript to clipboard as markdown',

  apply(ctx) {
    const { ast, editor, find, query, index, src, assert } = ctx;

    // ── 1. Find the COMMANDS array (same as cd-command) ─────────────
    const compactObj = query.findObjectWithStringProps(ast, [
      ['name', 'compact'],
      ['type', 'local'],
    ]);
    assert(compactObj, 'Could not find compact command definition');

    let assignNode = index.parentMap.get(compactObj);
    while (assignNode && assignNode.type !== 'AssignmentExpression') {
      assignNode = index.parentMap.get(assignNode);
    }
    assert(
      assignNode?.type === 'AssignmentExpression' &&
      assignNode.left?.type === 'Identifier',
      'Could not find compact assignment',
    );
    const localVar = assignNode.left.name;

    const reExport = find.findFirst(ast, (n: any) =>
      n.type === 'AssignmentExpression' &&
      n.right?.type === 'Identifier' && n.right.name === localVar &&
      n.left?.type === 'Identifier' && n.left.name !== localVar);
    assert(reExport, 'Could not find compact re-export');
    const exportVar = reExport.left.name;

    const commandsArr = find.findFirst(ast, (n: any) => {
      if (n.type !== 'ArrayExpression') return false;
      if (n.elements.length < 20) return false;
      return n.elements.some((el: any) =>
        el?.type === 'Identifier' && el.name === exportVar);
    });
    assert(commandsArr, 'Could not find COMMANDS array');

    // ── 2. Inject /export command ───────────────────────────────────
    const lastEl = commandsArr.elements[commandsArr.elements.length - 1];

    // The call signature for type:"local" is: call(args, context)
    // context.messages is Message[] with shape:
    //   { type: "user"|"assistant"|..., message: { role, content } }
    // content is string | Array<{type:"text",text:string}|...>
    //
    // Clipboard: use child_process.execSync to pipe to pbcopy (macOS)
    // or xclip/xsel/wl-copy (Linux). This avoids needing to locate
    // the bundled setClipboard function in the minified AST.
    const exportCmd =
      `,{type:"local",name:"export",description:"Copy full session transcript to clipboard"` +
      `,supportsNonInteractive:false` +
      `,load:()=>Promise.resolve({call:async(_args,_ctx)=>{` +
        `let msgs=_ctx.messages;` +
        `let parts=[];` +
        `for(let m of msgs){` +
          `if(m.type!=="user"&&m.type!=="assistant")continue;` +
          `if(m.isMeta)continue;` +
          `let role=m.type==="user"?"User":"Assistant";` +
          `let c=m.message&&m.message.content;` +
          `if(!c)continue;` +
          `let txt="";` +
          `if(typeof c==="string"){txt=c}` +
          `else if(Array.isArray(c)){` +
            `txt=c.filter(b=>b.type==="text").map(b=>b.text).join("\\n")` +
          `}` +
          `if(!txt.trim())continue;` +
          `parts.push("## "+role+"\\n\\n"+txt)` +
        `}` +
        `if(!parts.length)return{type:"text",value:"No messages to export."};` +
        `let md=parts.join("\\n\\n---\\n\\n");` +
        `try{` +
          `let cp=require("child_process");` +
          `let cmd=process.platform==="darwin"?"pbcopy"` +
            `:"xclip -selection clipboard";` +
          `cp.execSync(cmd,{input:md,timeout:5000});` +
          `let lines=md.split("\\n").length;` +
          `let chars=md.length;` +
          `return{type:"text",value:"Session exported to clipboard ("+chars+" chars, "+lines+" lines)"}` +
        `}catch(e){` +
          `return{type:"text",value:"Failed to copy to clipboard: "+(e.message||e)}` +
        `}` +
      `}})}`;

    editor.insertAt(lastEl.end, exportCmd);
  },
};

export default patch;
