# Remote Control on by Default

> Join Remote Control automatically on each new session (explicit config still wins).

**ID** `remote-control-default-on` · **Default** off · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/remote-control-default-on.ts)

## What it does

Every new `cx` window flips Remote Control on at startup instead of waiting for you to toggle it from inside the session. No more opening a terminal, firing off a task, and realising half an hour later that you forgot to enable Remote Control and the phone view never had anything to connect to.

Your explicit config still wins. If you've set `remoteControlAtStartup: true` or `false` anywhere (global settings, project settings, the in-app `/config` picker), that value is honoured unchanged — this patch only changes the fallback that kicks in when nothing is set. Turning it off per-session is also unaffected: you can disconnect from inside the session the same way you always could.

Default is off. Flip it on in `cx setup` once you want Remote Control to be your baseline.

## Why

Claude Code's Remote Control feature is opt-in per session, and there's no built-in knob for "always on by default" — your options are per-window toggling or writing `remoteControlAtStartup: true` into settings.json by hand. The first is easy to forget mid-task; the second is easy to forget when switching machines or project roots. This patch makes the convenient case the default without taking away the explicit override.

## Usage

Automatic for every new `cx` session. If you want to opt a specific session out, toggle Remote Control off from inside the session as usual, or set `remoteControlAtStartup: false` in `~/.claude.json` — both beat the patched default.

## How it works

In the source, `getRemoteControlAtStartup()` reads `getGlobalConfig().remoteControlAtStartup`, returns it when explicit, and otherwise falls through to `return false`. The public build compile-strips the `CCR_AUTO_CONNECT` branch, so the minified function is a tight three-statement body — a single config read, an `undefined` check, and a `return !1` tail.

The patch anchors on the one AST shape that only this function uses: a `MemberExpression` whose property is `remoteControlAtStartup` and whose object is a `CallExpression` (i.e. `someFn().remoteControlAtStartup`). Every other reference to `.remoteControlAtStartup` in the bundle reads it off a parameter or destructure, so the anchor is unambiguous. Once the enclosing function is located, the patch finds its direct `return !1` (without descending into nested closures) and replaces the `!1` expression with `!0`. The surrounding `return` keyword and statement terminator aren't touched, so acorn's offset map stays valid for any later patch in the same pipeline.
