#!/usr/bin/env bash
#
# scripts/triage/session.sh
#
# Runs *inside* the detached tmux session that dispatch.sh creates. One arg:
# the workspace directory (e.g. ~/cx-triage/runs/1234567890/). The tmux
# session's CWD is already $workspace/cx (set via `tmux new-session -c`), so
# this script just has to wire up logging and hand control to claude.
#
# Why a separate script and not an inline command on `tmux new-session`?
#   - The brief reference is relative, so the cd happens before claude runs.
#   - `exec bash` at the end keeps the tmux window alive after claude exits,
#     so the operator can still `tmux attach` hours later to read the
#     transcript.
#   - Keeps the quoting story simple — no shell-inside-shell escaping in
#     dispatch.sh's tmux call.
#
# The session is sandboxed to $workspace/cx, which is a fresh clone, not
# the operator's working tree. --dangerously-skip-permissions is acceptable
# because:
#   1. The clone is throwaway (scheduled for cleanup after N days).
#   2. The brief explicitly constrains Claude to editing src/patches/** and
#      src/transform.ts.
#   3. The gh PAT stored in ~/cx-triage/.env is scoped to the cx repo only.

set -euo pipefail

WORKSPACE="${1:?session.sh: workspace path required as $1}"
CX="$WORKSPACE/cx"
BRIEF="$WORKSPACE/brief.md"
LOG="$WORKSPACE/session.log"

cd "$CX"

# Tee everything to session.log so the transcript survives even if the
# operator never attaches — and so a subsequent run can post-mortem.
exec > >(tee -a "$LOG") 2>&1

echo "────────────────────────────────────────────────────────────────"
echo "cx triage session starting at $(date -Iseconds)"
echo "workspace: $WORKSPACE"
echo "cx clone:  $CX"
echo "brief:     $BRIEF"
echo "branch:    $(git rev-parse --abbrev-ref HEAD)"
echo "────────────────────────────────────────────────────────────────"
echo

# Pull the operator env (GH_TOKEN for gh cli, any claude flags).
if [ -f "$HOME/cx-triage/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$HOME/cx-triage/.env"; set +a
fi

# Hand control to claude. The initial prompt is intentionally short — a
# pointer to brief.md — so Claude uses Read to load the brief on demand
# rather than having it in every turn's context.
#
# The brief.md path is passed as an absolute path because Claude's CWD
# will be the cx clone at $CX, and brief.md lives one level up.
claude --dangerously-skip-permissions \
  "You are running an automated cx patch regression triage. Read $BRIEF
  and execute the task it describes. Your CWD is already the cx clone
  at $(pwd). When you are done — whether you opened a PR, got stuck,
  or bailed out — print a final status line prefixed with '[triage-result]'
  and exit." \
  || echo "── claude exited with status $? ──"

echo
echo "────────────────────────────────────────────────────────────────"
echo "session finished at $(date -Iseconds)"
echo "workspace preserved at $WORKSPACE"
echo "this tmux window will stay open — press Ctrl-b d to detach,"
echo "or Ctrl-d to close it."
echo "────────────────────────────────────────────────────────────────"

# Keep the pane alive so `tmux attach` after the fact still shows the
# transcript. A cron job in ~/cx-triage/ cleans up old runs separately.
exec bash
