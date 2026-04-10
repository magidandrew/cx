# Auto /rename on First Message

> Persist an auto-generated session title on the first user message so /resume and the terminal tab reflect it without typing /rename.

**ID** `auto-rename-first-message` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/auto-rename-first-message.ts)

## What it does

Claude Code already generates a title from your first user message via a short Haiku call — you can see it if you look at the terminal tab, where "Claude Code" gets replaced with something like "Fix login button on mobile" once the first prompt goes out. The problem is that title is held in local React state only; it never lands on disk, so the `/resume` picker keeps showing "Claude Code" for that session and you still have to type `/rename` manually if you want a real name.

This patch hooks that same first-message title callback and persists the result the way `/rename` would — writing a `custom-title` entry and an `agent-name` entry to the session transcript. The next time you open `/resume` the session is already named. You don't type anything.

The saved title is kebab-cased to match `/rename`'s output style. So "Fix login button on mobile" becomes `fix-login-button-on-mobile` in the picker and on the terminal tab.

One caveat: the prompt-bar agent name (the small label above your input, if you've been using `/rename` or `/color`) only refreshes on the next session restart. The `/resume` list and the terminal tab update immediately.

## Why

Typing `/rename` every time you start a session, even just to hit Enter and accept the auto-generated name, is tedious. Claude Code already does the Haiku call on message #1 — this patch makes that work do useful work.

## Usage

Automatic on the first user message of every session. Skip conditions match Claude Code's built-in auto-title: if you've already set a session title, if `terminalTitleFromRename` is disabled in settings, or if the first "message" is actually a slash-command echo / bash-mode input / command output, the patch stays out of the way.

If you want the old behavior back (Haiku title in the terminal tab only, `/resume` unchanged), disable the patch in `cx setup`.

## How it works

The patch locates the rename command's `call` function the same way the `rename-random-color` patch does — via its unique teammate-block string literal. From there it extracts the minified identifiers for `saveCustomTitle`, `saveAgentName`, and `getSessionId` by matching their known call shapes inside rename: the two 3-arg awaited calls are the save helpers in source order, and `getSessionId` is the 0-arg call whose result is passed as the first argument to `saveCustomTitle`. Pinning `getSessionId` by tracing its variable, rather than "first 0-arg call in the function", avoids mis-picking `isTeammate()` which is also 0-arg and lives earlier in the body.

Finding the REPL auto-title block is harder than it looks because the command-tag constants from `constants/xml.ts` are NOT inlined by the bundler — they remain as top-level `let ND = "local-command-stdout"` style bindings. That means the source code `text.startsWith(\`<${LOCAL_COMMAND_STDOUT_TAG}>\`)` emits as a `TemplateLiteral` node with an `Identifier` interpolation, not a plain string literal. So the patch first finds the four tag `VariableDeclarator`s by their literal string values, collects their minified identifier names, and then scans every `IfStatement` in the AST looking for one whose test expression contains four distinct `.startsWith(\`<${X}>\`)` calls referencing exactly those four identifiers. That combination is unique to the REPL's first-message title block — no other code path checks all four tags together.

Inside that `IfStatement`, the patch grabs the `.then(callback)` call that wraps `generateSessionTitle(text, sig).then(…)` and injects a small preamble at the top of the callback's body. The preamble kebab-cases the title, calls the discovered save helpers as fire-and-forget promises (with `.catch(()=>{})` so disk errors don't crash Node), and hands control back to the original body so `setHaikuTitle` and the retry-flag bookkeeping still run unmodified.
