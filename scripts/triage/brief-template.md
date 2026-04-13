# cx patch regression triage — claude-code@$VERSION

**GitHub run:** $RUN_URL
**Repo:** $REPO @ `$SHA`
**Tested claude-code version:** $VERSION
**Failing patch count:** $FAILED
**Regression issue:** #$ISSUE
**Your branch:** `$BRANCH`
**Workspace:** `$WORKSPACE`

---

## Your task

One or more cx patches have stopped applying cleanly against
`@anthropic-ai/claude-code@$VERSION`. You're running inside a fresh clone
of the cx repo, already on a dedicated branch (`$BRANCH`). Your job is to
make the patches apply again, verify both test layers go green, and open a
PR back to `main`.

Follow this playbook. Skim the whole thing before you start.

### 1. Read the project context
- `CLAUDE.md` — project instructions (tests, build, conventions)
- `CONTRIBUTING.md` — patch authoring conventions (variants, conflicts)
- `src/transform.ts` — the transform framework + `selectPatchApply` logic
- `src/types.ts` — Patch / PatchVariant / PatchContext shapes

### 2. Read each failing patch
For every patch listed under "Failing patches" below:
- Open `src/patches/<id>.ts`
- Read the error carefully — it's the literal message thrown from
  `transform.ts:122` with the `Patch "<id>" failed: ` prefix stripped.

### 3. Inspect the new claude-code bundle
You need to see what changed in the minified source between the old
working version and `$VERSION`. Two options:
- **Preferred:** `cc-source/` already has a reference copy of an older
  claude-code source — but it may be stale. Check its version first.
- **Authoritative:** download the exact failing version into a tempdir:
  ```sh
  mkdir -p /tmp/cc-$VERSION
  npm pack @anthropic-ai/claude-code@$VERSION --pack-destination /tmp/cc-$VERSION --silent
  tar -xzf /tmp/cc-$VERSION/*.tgz -C /tmp/cc-$VERSION
  less /tmp/cc-$VERSION/package/cli.js
  ```
  Use Grep on `/tmp/cc-$VERSION/package/cli.js` to find the region the
  broken patch targets.

### 4. Fix the patch
Patches can declare `variants: PatchVariant[]` to carry per-version apply
functions (see `src/types.ts` and `src/transform.ts:35-44`). Prefer
**adding a new variant** that matches the new version range over mutating
an existing one — older claude-code versions may still need the old apply
path, and you don't want to regress them.

Typical cases:
- **Renamed variable in the minified bundle** → update the string/AST
  matcher in the patch.
- **New AST shape** → rewrite the acorn/SourceEditor logic for the new
  shape, ideally as a new variant.
- **Feature completely removed** → this is the "stuck" path (step 7).

### 5. Verify — run BOTH test layers
Per `CLAUDE.md` § Tests, there are two test layers and BOTH must go green:

```sh
# 1. Apply-only check — this is the layer the workflow flagged.
npm run test:patches

# 2. Behavioral check — asserts each patch still DOES the right thing.
npm test
```

The behavioral suite runs `bun test` with `--max-concurrency=1` (parsing
the 13MB bundle in parallel blows memory). Do not try to parallelize it.

If `npm test` doesn't exist, run `bun test` directly. Read `package.json`
to confirm the scripts available.

If you only need to re-test a single patch against a specific version:
```sh
CC_VERSION=$VERSION bun test test/patches/<patch-id>.test.ts
```

### 6. On green — commit, push, open PR
Once BOTH test layers pass:

```sh
git add -A
git commit -m "fix(patches): <patch-id> apply against claude-code@$VERSION

Auto-triaged from run $RUN_ID.

<brief explanation of what changed in the bundle>"

git push -u origin HEAD
```

Then open the PR with `gh pr create`. The PR body MUST include:
- A link back to the originating workflow run: $RUN_URL
- The original error message(s) (verbatim)
- A one-line explanation of the root cause (what changed in claude-code)
- A checklist confirming both test layers are green:
  ```
  - [x] npm run test:patches (apply-only) passes
  - [x] npm test (behavioral) passes
  ```

After `gh pr create` prints the PR URL, also post a follow-up comment on
the regression issue so the human operator sees the resolution:

```sh
gh issue comment $ISSUE --body "✅ Auto-triage resolved: <pr-url>"
```

Print the PR URL, print `[triage-result] PR opened: <url>`, and exit 0.

### 7. On stuck — bail out cleanly
If after **3 serious attempts** you cannot make the tests go green, STOP.
Do NOT open a PR with a half-working fix. Instead, post a diagnostic
comment on the regression issue:

```sh
gh issue comment $ISSUE --body "🛑 Auto-triage stuck on run $RUN_ID.

<describe what you tried>
<describe why it didn't work>
<cite the claude-code bundle region that changed>

Needs human attention. Transcript on the VPS at:
\`$WORKSPACE/session.log\`"
```

Print `[triage-result] stuck: needs human attention`, and exit 1.

---

## Hard rules
- **Edit only** `src/patches/**` and `src/transform.ts`. Do NOT touch
  `dist/`, `package.json`, `.github/workflows/`, or any test file unless
  the test file is directly affected by your patch fix.
- **Do NOT run `npm run build`.** Tests use `bun` directly on source.
  The `dist/` build is only needed at npm-publish time.
- **Do NOT force-push.** Do NOT delete branches. Do NOT close issues.
- **Do NOT skip tests.** Both `npm run test:patches` and `npm test` must
  be green before you commit.
- **Do NOT mutate existing variants unless the old version range is
  genuinely obsolete.** Adding a new variant is almost always safer.
- **Verify with the full test harness**, not just the one patch you
  edited — your fix may have regressed another patch.

---

## Failing patches

$FAILING_SECTION

---

## Full report (JSON)

```json
$FULL_REPORT
```
