# Delete Sessions from /resume

> `Opt+D` in the resume picker deletes the focused session (confirm by pressing `Opt+D` again).

**ID** `delete-sessions` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/delete-sessions.ts)

## What it does

Open `/resume`, focus a session, and press `Opt+D`. The list is replaced by a confirmation line that names the session file and asks you to press `Opt+D` again to confirm. The second press deletes the `.jsonl` transcript plus the sibling per-session directories — `~/.claude/file-history/<session-id>/` and `~/.claude/session-env/<session-id>/` — and refreshes the picker. Any other key cancels and returns you to the list with nothing deleted.

The destructive action is opt-in both at the patch level (tagged alongside the others that need a deliberate second press) and at the moment of use. There is no undo — sessions aren't moved to a trash directory.

## Why

The picker has always had no way to prune old sessions without dropping to the shell and `rm`-ing files out from under it. Upstream [anthropic-ai/claude-code#13514](https://github.com/anthropics/claude-code/issues/13514) asks for this in the app/browser; the TUI version lands here instead.

The patch was previously in cx as `delete-sessions` but was removed in v0.2.10 after enough accidental deletes that the footgun outweighed the convenience. The footgun still applies — keep it off if you use `/resume` quickly and don't want `Opt+D` within reach.

## Usage

Press `Opt+D` on a focused session in `/resume`. First press stages a confirmation view; second press deletes. Anything else cancels.

A new `Opt+D Delete` hint is added to the shortcut row alongside `Ctrl+V Preview` and `Ctrl+R Rename`.

`Opt+D` rather than `Ctrl+D` because Claude Code's global keybinding map hardcodes `Ctrl+D` to `app:exit` and calls `stopImmediatePropagation()` on match — the second press never reaches the picker's handler. `Opt+D` has no global binding.

## How it works

The patch finds LogSelector by looking for a function that contains both the `"Resume Session"` header string and the `"tengu_session_rename_started"` analytics event, then discovers the minified names it needs (React namespace, `onLogsChanged` prop, Box and Text component vars, the key handler, the `onKeyDown` binding) by structural anchors rather than positional guesses.

It injects a `useRef` + `useState` pair at the top of LogSelector — the ref holds the pending-delete path for the memoized key handler's closure, the state exists purely to trigger a re-render when the confirmation view should appear. The delete branch at the top of the key handler bumps both when `Opt+D` fires on a focused log, or clears them on any other key. File deletion goes through `import("node:fs/promises")` because the bundle is ESM and `require()` isn't defined at runtime; paths are derived via string ops so the patch doesn't also need to resolve `node:path`.

The confirmation overlay itself wraps LogSelector's final return argument in a conditional — `__cxDP ? <confirmBox> : <original render>` — so no state change is needed to hide it again. The overlay Box has `tabIndex: 0` + `autoFocus: true` so it actually receives keys (Ink bubbles keydowns from a focused descendant; without those props, nothing in the tree is focused and keystrokes vanish), plus a `key="cx-del-confirm"` to force React to remount rather than reconcile the existing root Box in place (`autoFocus` only fires on mount). A separate ternary rewrite guarantees LogSelector is always passed `onLogsChanged` from its caller so the list can reliably refresh after a delete, regardless of the `isCustomTitleEnabled()` feature flag.
