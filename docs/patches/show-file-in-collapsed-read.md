# Show File in Collapsed Read

> Show file paths and search patterns inside the collapsed tool display.

**ID** `show-file-in-collapsed-read` · **Default** on · **Compatible** `*` · [Source](https://github.com/magidandrew/cx/blob/main/src/patches/show-file-in-collapsed-read.ts)

## What it does

The collapsed summary that appears after a Read or Grep tool call includes the actual targets. Instead of the default:

```
Read 3 files
Searched for 1 pattern
```

you see:

```
Read 3 files (src/foo.ts, src/bar.ts, src/baz.ts)
Searched for 1 pattern ("handleSubmit")
```

When more than three files were read, the display shows the last one and `+ N more`.

## Why

The data was already extracted from the tool result — it's just shown during active execution as a hint and then thrown away when the row collapses. That made the history of a session harder to skim than it needed to be. Tracked upstream at [anthropics/claude-code#21151](https://github.com/anthropics/claude-code/issues/21151) (184 reactions at time of writing).

## How it works

The patch identifies the collapsed-display render function by the string keys `"read"`, `"search"`, and `"comma-r"`, which only appear together inside that component. From there it discovers the minified names for `readFilePaths`, `searchArgs`, and the `getDisplayPath` helper by walking the AST from each access.

Once the variable names are known, the patch inserts two conditional `push()` calls into the children array — one after the "Read" element and one after the "Search" element — that render an extra dim-colored Text node with the file paths or search patterns in parentheses.
