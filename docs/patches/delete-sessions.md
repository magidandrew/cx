# Delete Sessions from /resume

> `Opt+D` in the resume picker deletes the focused session. Press `Opt+D` again to confirm.

**ID** `delete-sessions` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/delete-sessions.ts)

## What it does

Inside the `/resume` (or `--resume`) picker, `Opt+D` (Option+D on macOS, Alt+D on Linux/Windows) stages the focused session for deletion. The picker switches to a "Delete this session?" confirmation overlay. Press `Opt+D` once more and the `.jsonl` transcript is deleted, along with the per-session subdirectories under `.claude/file-history`, `.claude/session-env`, and the sibling subagent directory. Any other key cancels the prompt.

The patch also adds an `Opt+D Delete` entry to the keyboard-shortcut hint row at the bottom of the picker, right after the existing `Ctrl+R Rename` hint, so the binding is discoverable without reading docs.

## Why

Claude Code has no built-in way to remove a session from the picker. Old crashes, dead experiments, and one-off scratch sessions just pile up. Tracked upstream at [anthropics/claude-code#13514](https://github.com/anthropics/claude-code/issues/13514).

### Why not Ctrl+D

The obvious binding is taken. Claude Code's Global keybinding map hardcodes `"ctrl+d"` to the `app:exit` action, and the keybinding manager calls `stopImmediatePropagation()` on match — so the second `Ctrl+D` never reaches the picker's key handler. The reserved-binding list in the bundle even flags it as *"Cannot be rebound - used for exit (hardcoded)"*. `Opt+D` has no global binding, so both presses arrive cleanly.

## Usage

Open the picker (`/resume` or launch with `cx --resume`), navigate to the session you want gone, press `Opt+D`, then `Opt+D` again to confirm. Any other key cancels.

> On macOS Terminal or iTerm2, make sure the Option key is set to send a meta escape sequence. iTerm2: *Profiles → Keys → Left/Right Option Key → Esc+*. Terminal.app: *Preferences → Profiles → Keyboard → Use Option as Meta key*. Without this, the terminal intercepts Option+D as a compose-key sequence and Claude Code never sees it.

## How it works

This patch is more involved than most of the cx patches, because the React Compiler memoizes the resume picker's `LogSelector` component and its key handler. A naive "just set a module-level flag" approach would never re-render the confirmation overlay.

Variable discovery is anchored by three stable markers: the header string `"Resume Session"`, the analytics event `"tengu_session_rename_started"`, and the `onLogsChanged` prop name (which survives destructuring). From those, the patch resolves the minified names for the key handler, the focused-log variable, the Box and Text components, and — via the `onKeyDown` prop on the root Box — the variable that holds the key handler function itself.

The actual injection has six moving parts:

1. A `useRef(null)` and `useState(null)` pair added at the top of `LogSelector`. The ref holds the pending-delete path (read by the memoized key handler without going stale); the state exists only to force a re-render when the ref changes.
2. An `Opt+D` branch inserted at the top of the key handler body. The modifier check is `(key.meta || key.alt)` so it works whether the terminal sends Option as a meta escape prefix or as a raw alt modifier. First press sets the ref and state. Second press deletes the transcript and cleans up the per-session directories, then calls `onLogsChanged` to refresh the list. Any other key clears the pending state.
3. A block inserted right before the final `return` that overrides the rendered root element with a confirmation Box when the pending state is set. On cancel, the cached main UI returns unchanged. The confirmation Box copies the `onKeyDown` prop from the original root Box — without that, the key handler gets detached the moment the override renders, and the second `Opt+D` (and every cancel keystroke) silently drops on the floor.
4. A new `Opt+D Delete` entry inserted into the `KeyboardShortcutHint` row immediately after the `Ctrl+R Rename` hint. The chord string is `"opt+d"`; the bundle's chord parser normalizes `opt`/`option`/`alt` to the same `.alt` token, and the display formatter renders it as `Opt` on macOS with the `modCase: "title"` format the other hints already use.
5. The `isCustomTitleEnabled() ? () => loadLogs(...) : undefined` ternary that passes `onLogsChanged` from `ResumeConversation` is rewritten so the consequent always runs. Without this, delete has no way to refresh the picker when the custom-title feature flag is off.
6. Every filesystem call is wrapped in try/catch so a missing ancillary directory never blocks deletion of the main transcript.
