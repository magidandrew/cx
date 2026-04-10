# Claude Code source

## Why this exists

`cx` patches Claude Code's `cli.js` at runtime via AST transforms. The npm package ships a single minified bundle with no readable source, so you can't write or debug patches without the original code to reference. This directory holds that source.

Gitignored. Only this README is tracked.

## Getting it

The source was extracted from npm sourcemaps and people have posted it to GitHub. Search "claude code source" and you'll find repos to clone. Be careful what you download.

Clone into this directory:
```sh
git clone https://github.com/<user>/<repo> cc-source
```
