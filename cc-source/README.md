# Claude Code source

## Why this exists

`cx` patches Claude Code's `cli.js` at runtime via AST transforms. The npm package ships a single minified bundle with no readable source, so you can't write or debug patches without the original code to reference. This directory holds that source.

Gitignored. Only this README is tracked.

## Getting it

The source was extracted from npm sourcemaps and posted to GitHub. One mirror:

- [yasasbanukaofficial/claude-code](https://github.com/yasasbanukaofficial/claude-code)

Clone into this directory:
```sh
git clone https://github.com/yasasbanukaofficial/claude-code cc-source
```

See the [Claude source](https://cx.worms.coffee/guide/how-it-works#claude-code-source) section of the docs for more.
