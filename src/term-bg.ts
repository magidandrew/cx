/**
 * Terminal background detection via OSC 11.
 *
 * Claude Code's bundled auto-theme has two detection paths:
 *
 *   1. `$COLORFGBG`  — iTerm2 (opt-in), Konsole, rxvt-family set this
 *      at launch. Synchronous, cheap, but the user's terminal has to
 *      cooperate. Ghostty, stock Terminal.app, Alacritty, etc. don't.
 *   2. OSC 11 query  — the terminal emulator responds to an escape
 *      with its live background color. Works everywhere that
 *      implements the sequence (basically every modern terminal).
 *
 * The public bundle strips the OSC 11 watcher behind a `feature()`
 * gate, so path #2 is dead code — `resolveThemeSetting('auto')` falls
 * back to `detectFromColorFgBg()`, and when that returns undefined
 * (Ghostty et al), auto silently resolves to 'dark'.
 *
 * This module resurrects path #2 out-of-band: cx opens /dev/tty
 * directly, puts it in raw mode via `stty`, writes the OSC query,
 * reads the response, restores the prior stty settings, closes the
 * fd, and hands the result to the child as `COLORFGBG` on env.
 *
 * Crucially we never touch `process.stdin`. Node's stream wrapper
 * around stdin enters flowing mode on first `resume()` and then
 * internal buffering may steal bytes from the child — the symptom
 * was noticeable input lag in Claude's chat once cx had probed. By
 * going through a separate fd on /dev/tty we avoid the shared-fd
 * contention entirely.
 */

import { execSync } from 'child_process';
import { openSync, readSync, writeSync, closeSync } from 'fs';

/**
 * Ask the terminal for its background color via OSC 11 and return a
 * `$COLORFGBG`-compatible value the bundled parser understands.
 *
 * Returns null when:
 *   - `/dev/tty` can't be opened (piped, CI, Windows without a tty)
 *   - `stty` isn't on PATH
 *   - the terminal doesn't respond inside the budget
 *   - the response is unparseable
 *
 * Callers treat null as "don't touch COLORFGBG" — the bundle's own
 * fallback (getSystemThemeName → 'dark') then applies.
 *
 * Budget: 150ms from stty-raw to stty-restore. Modern terminals
 * round-trip in microseconds; the budget only exists to cap the
 * "terminal never answers" case.
 */
export function detectTerminalBgColorFgBg(budgetMs = 150): string | null {
  // Windows has /dev/tty only via MSYS/Cygwin and no `stty` by default.
  // Skip cleanly — Windows Terminal users can set COLORFGBG themselves
  // or wait for a Windows-specific probe.
  if (process.platform === 'win32') return null;

  let savedStty: string | null = null;
  let fd = -1;
  try {
    // Snapshot current terminal line discipline BEFORE opening the fd
    // so a restore always has a valid target even if open() fails.
    savedStty = execSync('stty -g </dev/tty 2>/dev/null', {
      encoding: 'utf-8',
    }).trim();
    if (!savedStty) return null;

    // Raw mode with a non-blocking read deadline. VMIN=0 + VTIME=1
    // means `read()` returns after 0.1s of idleness even with no
    // bytes — perfect for our bounded-wait loop below.
    execSync('stty raw -echo min 0 time 1 </dev/tty 2>/dev/null');

    fd = openSync('/dev/tty', 'r+');
    // OSC 11: query default background color. Use BEL (\x07) terminator
    // for broadest emulator compatibility — ST (\x1b\\) is spec-correct
    // but some older emulators only accept BEL.
    writeSync(fd, '\x1b]11;?\x07');

    const buf = Buffer.alloc(256);
    let accumulated = '';
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      let n = 0;
      try {
        n = readSync(fd, buf, 0, buf.length, null);
      } catch {
        // EAGAIN/EINTR — spin until deadline.
        continue;
      }
      if (n === 0) continue;
      accumulated += buf.slice(0, n).toString('binary');
      const m = /\x1b\]1[01];(rgb:[0-9a-f/]+)(?:\x07|\x1b\\)/i.exec(accumulated);
      if (m) return toColorFgBg(m[1]);
    }
    return null;
  } catch {
    return null;
  } finally {
    // Restore the saved stty settings BEFORE closing the fd — closing
    // while in raw mode on some systems leaves the cooked bits off.
    if (savedStty) {
      try {
        execSync(`stty ${savedStty} </dev/tty 2>/dev/null`);
      } catch { /* ignore */ }
    }
    if (fd >= 0) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

/**
 * Convert an `rgb:R/G/B` response into a `fg;bg` string that the
 * rxvt-style parser in `detectFromColorFgBg()` will classify
 * correctly. We don't know the foreground; the parser ignores all
 * but the last semicolon-delimited field, so `fg` is a dummy.
 *
 * Classification boundary: ITU-R BT.709 relative luminance > 0.5 → light.
 * Matches systemTheme.ts:themeFromOscColor exactly so flips look the
 * same whether the detection ran in-bundle (on releases that keep it)
 * or out-of-band via this probe.
 *
 * Output values land squarely inside the dark/light buckets of the
 * bundled parser: 0 (black) for dark, 15 (bright white) for light.
 * Any in-bucket value would work; these are the rxvt defaults.
 */
function toColorFgBg(rgbStr: string): string | null {
  const m = /^rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(rgbStr);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(hex => {
    const max = 16 ** hex.length - 1;
    return parseInt(hex, 16) / max;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const isLight = luminance > 0.5;
  return isLight ? '15;15' : '15;0';
}
