#!/usr/bin/env bash
#
# scripts/triage/dispatch.sh
#
# VPS entry point for cx auto-triage. Invoked by SSH from GitHub Actions
# via the authorized_keys command= lock (so any positional args are ignored;
# only stdin matters).
#
# Reads a JSON payload on stdin shaped like:
#
#   {
#     "run_id":  "<github run id>",
#     "run_url": "<github actions run url>",
#     "repo":    "owner/name",
#     "sha":     "<full commit sha>",
#     "version": "<claude-code version>",
#     "failed":  <int>,
#     "issue":   <issue number | null>,
#     "report":  { ... full .test-cache/report.json ... }
#   }
#
# For each dispatch it:
#
#   1. Validates the payload.
#   2. Hashes (version + sorted failing patch ids) and refuses the dispatch
#      if the same hash was handled in the last 24h (idempotency).
#   3. Refuses if >=3 tmux sessions matching cx-triage-* are already active
#      (rate limit).
#   4. Creates a workspace at ~/cx-triage/runs/<run_id>/.
#   5. Clones the cx repo and checks out a triage/auto-<version>-<run_id>
#      branch.
#   6. Renders brief-template.md into workspace/brief.md with payload vars
#      substituted.
#   7. Launches a detached tmux session running session.sh, which in turn
#      starts claude against the brief.
#   8. Prints exactly one line "SESSION=cx-triage-<run_id>" to stdout so
#      the GitHub Actions step can capture it for the attach-hint comment.
#
# Env (sourced from ~/cx-triage/.env):
#
#   CX_REPO_URL  — https url to clone (e.g. https://github.com/owner/cx.git)
#   GH_TOKEN     — PAT used by gh cli for PR creation
#   GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL — commit identity override (optional)
#
# Dry run:
#
#   DRY_RUN=1 bash dispatch.sh < fake-payload.json
#     Skips the tmux launch and clone; just creates the workspace and
#     brief for inspection.

set -euo pipefail

# ── Setup ─────────────────────────────────────────────────────────────
ROOT="${CX_TRIAGE_HOME:-$HOME/cx-triage}"
RUNS="$ROOT/runs"
TEMPLATE="$ROOT/brief-template.md"
SESSION_SCRIPT="$ROOT/session.sh"
ENV_FILE="$ROOT/.env"
LOG="$ROOT/dispatch.log"

mkdir -p "$RUNS"
touch "$LOG"

log() {
  # Stamp messages to the dispatch log. These do NOT go to stdout, so they
  # don't pollute the SESSION=... line that GitHub Actions greps for.
  printf '[%s] %s\n' "$(date -Iseconds)" "$*" >> "$LOG"
}

die() {
  # Errors go to stderr AND to the log. Exit non-zero so the SSH client
  # on the GitHub runner surfaces the failure.
  local msg="$*"
  log "FATAL: $msg"
  printf 'dispatch.sh: %s\n' "$msg" >&2
  exit 1
}

# ── Source operator env ───────────────────────────────────────────────
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi

: "${CX_REPO_URL:?CX_REPO_URL must be set in $ENV_FILE}"

# ── Read + validate payload ───────────────────────────────────────────
PAYLOAD="$(cat)"
if [ -z "$PAYLOAD" ]; then
  die "empty stdin — did you pipe a payload?"
fi

# Quick sanity check: it must be JSON and have the required fields.
echo "$PAYLOAD" | jq -e . >/dev/null 2>&1 || die "stdin is not valid JSON"

for field in run_id version report; do
  val=$(echo "$PAYLOAD" | jq -r ".$field // empty")
  [ -n "$val" ] || die "payload missing required field: $field"
done

RUN_ID=$(echo "$PAYLOAD" | jq -r '.run_id')
RUN_URL=$(echo "$PAYLOAD" | jq -r '.run_url // ""')
REPO=$(echo "$PAYLOAD" | jq -r '.repo // ""')
SHA=$(echo "$PAYLOAD" | jq -r '.sha // ""')
VERSION=$(echo "$PAYLOAD" | jq -r '.version')
FAILED=$(echo "$PAYLOAD" | jq -r '.failed // 0')
ISSUE=$(echo "$PAYLOAD" | jq -r '.issue // ""')

# Sanitize RUN_ID so it's safe as a tmux session name and a path component.
case "$RUN_ID" in
  *[!A-Za-z0-9_-]*) die "run_id contains unsafe characters: $RUN_ID" ;;
esac

SESSION="cx-triage-$RUN_ID"
WORKSPACE="$RUNS/$RUN_ID"

log "dispatch received: run_id=$RUN_ID version=$VERSION failed=$FAILED"

# ── Idempotency: same failure hash in the last 24h? ───────────────────
# Compute hash of (version + sorted failing patch ids). If a previous run
# produced the same hash and its workspace is <24h old, treat this as a
# duplicate dispatch and exit 0 without spawning.
FAILURE_HASH=$(echo "$PAYLOAD" | jq -r '
  [.version, ([.report.results[] | select(.ok == false) | .id] | sort | join(","))]
  | join("|")
' | sha256sum | cut -d" " -f1)

log "failure_hash=$FAILURE_HASH"

# Look for a recent run with the same hash.
if [ -n "$FAILURE_HASH" ]; then
  recent=$(find "$RUNS" -mindepth 1 -maxdepth 1 -type d -mtime -1 2>/dev/null \
    -exec sh -c '[ -f "$1/failure-hash" ] && [ "$(cat "$1/failure-hash")" = "$2" ] && echo "$1"' \
    _ {} "$FAILURE_HASH" \; | head -n1)
  if [ -n "$recent" ]; then
    prev_session=$(basename "$recent")
    log "dedupe: matching recent run at $recent (session cx-triage-$prev_session)"
    # Print SESSION line so the workflow can still post an attach hint
    # pointing at the still-live session.
    echo "SESSION=cx-triage-$prev_session"
    echo "dispatch.sh: duplicate dispatch — reusing existing session cx-triage-$prev_session" >&2
    exit 0
  fi
fi

# ── Rate limit: max 3 concurrent triage sessions ──────────────────────
active=$(tmux list-sessions 2>/dev/null | grep -c '^cx-triage-' || true)
if [ "${active:-0}" -ge 3 ]; then
  die "rate limit: $active active triage sessions already — refusing new dispatch"
fi

# ── Render the brief ──────────────────────────────────────────────────
render_brief() {
  [ -f "$TEMPLATE" ] || die "brief template not found at $TEMPLATE"

  # Build the "failing patches" section from report.results.
  FAILING_SECTION=$(echo "$PAYLOAD" | jq -r '
    .report.results
    | map(select(.ok == false))
    | map("### `" + .id + "`\n**Error:** `" + (.error // "unknown") + "`\n**Duration before failure:** " + ((.durationMs // 0) | floor | tostring) + "ms\n")
    | join("\n")
  ')

  # Full pretty-printed report for reference.
  FULL_REPORT=$(echo "$PAYLOAD" | jq '.report')

  export RUN_ID RUN_URL REPO SHA VERSION FAILED BRANCH WORKSPACE ISSUE
  export FAILING_SECTION FULL_REPORT

  # envsubst handles the $VAR placeholders. We use a strict allowlist so
  # the template can contain literal $ signs (e.g. shell examples) without
  # them being clobbered.
  envsubst '$RUN_ID $RUN_URL $REPO $SHA $VERSION $FAILED $BRANCH $WORKSPACE $ISSUE $FAILING_SECTION $FULL_REPORT' \
    < "$TEMPLATE" \
    > "$WORKSPACE/brief.md"
}

# ── Dry-run short-circuit ─────────────────────────────────────────────
if [ "${DRY_RUN:-}" = "1" ]; then
  log "DRY_RUN=1 — skipping clone and tmux launch"
  mkdir -p "$WORKSPACE"
  echo "$PAYLOAD" | jq . > "$WORKSPACE/payload.json"
  echo "$FAILURE_HASH" > "$WORKSPACE/failure-hash"
  BRANCH="triage/auto-${VERSION}-${RUN_ID}"
  render_brief
  log "DRY_RUN: brief rendered at $WORKSPACE/brief.md"
  echo "SESSION=$SESSION"
  exit 0
fi

# ── Create workspace ──────────────────────────────────────────────────
if [ -d "$WORKSPACE" ]; then
  # Stale workspace from a previous run with the same run_id (retry). Nuke
  # and recreate so the clone is fresh.
  log "removing stale workspace $WORKSPACE"
  rm -rf "$WORKSPACE"
fi

mkdir -p "$WORKSPACE"
echo "$PAYLOAD" | jq . > "$WORKSPACE/payload.json"
echo "$FAILURE_HASH" > "$WORKSPACE/failure-hash"

# ── Clone cx ──────────────────────────────────────────────────────────
log "cloning $CX_REPO_URL into $WORKSPACE/cx"
git clone --quiet "$CX_REPO_URL" "$WORKSPACE/cx" >> "$LOG" 2>&1 \
  || die "git clone failed — see $LOG"

cd "$WORKSPACE/cx"

# Pin the clone to the exact SHA the test workflow ran against, so Claude
# isn't chasing a moving target if main advances mid-triage.
if [ -n "$SHA" ]; then
  git checkout --quiet "$SHA" 2>>"$LOG" || log "warning: could not checkout $SHA, staying on default branch"
fi

BRANCH="triage/auto-${VERSION}-${RUN_ID}"
git checkout -b "$BRANCH" >> "$LOG" 2>&1 \
  || die "could not create branch $BRANCH"

# Configure git identity for the commit Claude will make.
git config user.name  "${GIT_AUTHOR_NAME:-cx-triage}"
git config user.email "${GIT_AUTHOR_EMAIL:-cx-triage@localhost}"

cd - >/dev/null

render_brief
log "brief rendered at $WORKSPACE/brief.md"

# ── Launch the tmux session ───────────────────────────────────────────
[ -x "$SESSION_SCRIPT" ] || die "session script not executable at $SESSION_SCRIPT"

tmux new-session -d \
  -s "$SESSION" \
  -c "$WORKSPACE/cx" \
  "bash '$SESSION_SCRIPT' '$WORKSPACE'" \
  || die "tmux new-session failed — is tmux installed?"

log "tmux session $SESSION launched"

# ── Emit the session name for the GitHub step to capture ─────────────
# This is the ONLY line printed to stdout from this script. Keep it that
# way — the Actions step greps for exactly this pattern.
echo "SESSION=$SESSION"
