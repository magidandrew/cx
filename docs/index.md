---
# https://vitepress.dev/reference/default-theme-home-page
layout: home
title: cx — Claude Code Extensions
titleTemplate: false
description: cx is a modular, opt-in patch system for Anthropic's Claude Code CLI. Add a message queue, persistent max effort, no attribution, hot reload, session usage display, and 25+ other tweaks — without modifying the upstream claude binary.

hero:
  name: "cx"
  text: "Claude Code Extensions"
  tagline: Modular, opt-in patches applied at runtime via AST transformation. The original claude tool is never modified.
  image:
    src: /cx-logo.svg
    alt: cx logo
  actions:
    - theme: brand
      text: Get started
      link: /guide/
    - theme: alt
      text: View patches
      link: /patches
    - theme: alt
      text: GitHub
      link: https://github.com/magidandrew/cx

features:
  - title: Message queue
    details: Ctrl+Q lets you steer Claude mid-response. Buffer your next instruction while it's still working — it gets injected as a user turn immediately.
  - title: Persistent max effort
    details: Claude resets effort level every session. cx saves "max" to settings so you don't have to /model it back every time.
  - title: See your pasted text
    details: Voice dictation and large pastes get collapsed into [Pasted text #N] which hides what you actually said. cx shows it inline so you can verify what was sent.
  - title: No attribution
    details: No more Co-authored-by Claude in your commits and PRs.
  - title: Context usage, always visible
    details: See how much context you've used at all times, not just when you're about to hit the wall.
  - title: Hot reload
    details: Change patches, tweak config, update Claude Code — press Ctrl+X Ctrl+R and the session restarts with fresh patches. Your conversation continues via --continue.
---
