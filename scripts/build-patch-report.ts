#!/usr/bin/env bun
/**
 * scripts/build-patch-report.ts
 *
 * Reads `.test-cache/report.json` (produced by `scripts/test-patches.ts`)
 * and emits a self-contained `report.md` that's dense enough to paste
 * straight into an LLM and ask it to fix the broken patches.
 *
 * For each failed patch we inline:
 *   - the exact error message from the transform
 *   - the full patch source (`src/patches/<id>.ts`)
 *   - the paired test file (`test/patches/<id>.test.ts`) if one exists
 * plus a short "how to fix" preamble explaining cx's patch model and
 * the verification command.
 *
 * GitHub Actions sets GITHUB_REPOSITORY / GITHUB_RUN_ID / GITHUB_SHA
 * automatically; locally they're just absent and the run URL is skipped.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

interface Result {
  id: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

interface Report {
  version: string;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  results: Result[];
}

const REPO = process.env.GITHUB_REPOSITORY ?? '';
const RUN_ID = process.env.GITHUB_RUN_ID ?? '';
const SHA = process.env.GITHUB_SHA ?? '';
const RUN_URL = REPO && RUN_ID ? `https://github.com/${REPO}/actions/runs/${RUN_ID}` : '';

const reportPath = resolve('.test-cache/report.json');
if (!existsSync(reportPath)) {
  console.error(`build-patch-report: ${reportPath} not found — run scripts/test-patches.ts first.`);
  process.exit(1);
}

const report: Report = JSON.parse(readFileSync(reportPath, 'utf-8'));
const failures = report.results.filter(r => !r.ok);

const lines: string[] = [];
const push = (s = '') => lines.push(s);

push(`# cx patch regression report`);
push();
push(`- **Target:** \`@anthropic-ai/claude-code@${report.version}\``);
push(`- **Timestamp:** ${report.timestamp}`);
if (RUN_URL) push(`- **Run:** ${RUN_URL}`);
if (SHA) push(`- **Commit:** \`${SHA}\``);
push(`- **Result:** ${report.passed} passed, ${report.failed} failed`);
push();

if (failures.length > 0) {
  push('---');
  push();
  push('## How to use this report');
  push();
  push('cx patches the minified `cli.js` of `@anthropic-ai/claude-code` at install time via AST transforms. Each patch lives in `src/patches/<id>.ts` and anchors on specific code shapes in the bundle. When Anthropic ships a new release, a patch can stop applying because its anchor no longer matches.');
  push();
  push(`To fix a broken patch against \`${report.version}\`:`);
  push();
  push(`1. Pull the new bundle: \`npm pack @anthropic-ai/claude-code@${report.version}\` and extract \`package/cli.js\`.`);
  push('2. Open the patch source (included below) and locate the anchor pattern / AST matcher.');
  push('3. Search the new `cli.js` for the equivalent region; see how the code shape changed.');
  push('4. Update the matcher so it anchors on stable aspects of the new shape (don\'t over-fit to minifier-generated identifiers).');
  push(`5. Verify the single patch: \`CC_VERSION=${report.version} bun test test/patches/<id>.test.ts\`.`);
  push(`6. Confirm no regressions: \`bun scripts/test-patches.ts ${report.version}\`.`);
  push();
  push('---');
  push();
  push('## Failed patches');
  push();

  for (const f of failures) {
    push(`### \`${f.id}\``);
    push();
    push('**Error:**');
    push();
    push('```');
    push(f.error ?? '(no error message)');
    push('```');
    push();

    const patchPath = resolve('src/patches', `${f.id}.ts`);
    if (existsSync(patchPath)) {
      push(`**Patch source — \`src/patches/${f.id}.ts\`:**`);
      push();
      push('```ts');
      push(readFileSync(patchPath, 'utf-8').trimEnd());
      push('```');
      push();
    } else {
      push(`_(No patch source found at \`src/patches/${f.id}.ts\` — patch ID may be registered differently.)_`);
      push();
    }

    const testPath = resolve('test/patches', `${f.id}.test.ts`);
    if (existsSync(testPath)) {
      push(`**Paired test — \`test/patches/${f.id}.test.ts\`:**`);
      push();
      push('```ts');
      push(readFileSync(testPath, 'utf-8').trimEnd());
      push('```');
      push();
    }

    push('---');
    push();
  }
}

push('## All patches');
push();
for (const r of report.results) {
  if (r.ok) {
    push(`- [x] \`${r.id}\` _(${Math.round(r.durationMs)}ms)_`);
  } else {
    push(`- [ ] \`${r.id}\` — ${r.error}`);
  }
}
push();

const body = lines.join('\n');
writeFileSync('report.md', body);
console.log(`build-patch-report: wrote report.md (${body.length} bytes, ${failures.length} failures detailed)`);
