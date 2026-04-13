# cx auto-triage pipeline

When `test-patches.yml` catches a broken patch, it SSHes into a VPS and
launches a Claude Code session in tmux that investigates, fixes, re-tests,
and opens a PR. This directory holds the VPS-side scripts and this runbook.

> Internal operator documentation. Not part of the public VitePress site.

## Architecture

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │ GitHub Actions — .github/workflows/test-patches.yml                 │
 │                                                                     │
 │  1. bun scripts/test-patches.ts → .test-cache/report.json           │
 │  2. Upsert regression issue (existing behavior)                     │
 │  3. If failed > 0: SSH to VPS, pipe payload.json as stdin           │
 │  4. Capture SESSION=... from dispatch.sh stdout                     │
 │  5. Comment "attach with tmux" on the regression issue              │
 └─────────────────────────────┬───────────────────────────────────────┘
                               │ ssh (key from GitHub Secrets,
                               │      command= lock in authorized_keys)
                               ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ VPS — ~/cx-triage/                                                  │
 │                                                                     │
 │   dispatch.sh       reads payload on stdin, validates, dedupes,     │
 │                     rate-limits, creates runs/<run_id>/ workspace,  │
 │                     clones cx, checks out triage/auto-... branch,   │
 │                     renders brief.md, spawns tmux, prints SESSION=  │
 │                                                                     │
 │   session.sh        runs *inside* tmux — launches claude with       │
 │                     --dangerously-skip-permissions pointed at       │
 │                     brief.md; keeps pane alive after exit           │
 │                                                                     │
 │   brief-template.md envsubst template rendered into brief.md        │
 │                                                                     │
 │   runs/<run_id>/    per-run workspace (cx clone + brief + log)      │
 └─────────────────────────────┬───────────────────────────────────────┘
                               │ tmux session: cx-triage-<run_id>
                               ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ Claude Code (interactive in tmux, operator's auth in ~/.claude)     │
 │                                                                     │
 │   Reads brief.md (broken patches + errors + version + run URL)      │
 │   Uses Read/Grep/Edit to locate target AST + fix the patch          │
 │   Runs `npm run test:patches` AND `npm test` to verify              │
 │   On green: commit, push, gh pr create, comment on issue            │
 │   On stuck: gh issue comment with diagnostic block, exit 1          │
 │   tmux window stays alive after exit — operator can read transcript│
 └─────────────────────────────────────────────────────────────────────┘
```

## Files in this directory

| File                  | Role                                              |
| --------------------- | ------------------------------------------------- |
| `dispatch.sh`         | VPS entry point — invoked via SSH from Actions    |
| `session.sh`          | Runs inside tmux — launches Claude with the brief |
| `brief-template.md`   | The prompt Claude executes (envsubst-rendered)    |
| `README.md`           | This runbook                                      |

All three install to `~/cx-triage/` on the VPS (see setup below). They are
versioned in the repo so the source of truth is git, and the VPS is just a
cache — `git pull && cp scripts/triage/* ~/cx-triage/` keeps it in sync.

## One-time Hetzner setup

### 1. Create the server

- Hetzner Cloud → new project `cx-triage` → new server
- Type: **CPX11** (€4.35/mo, 2 vCPU AMD, 2GB RAM) — x86 for npm/node-gyp
- Image: **Ubuntu 24.04 LTS**
- SSH key: add your personal key during provisioning (this is NOT the
  GitHub dispatch key — that comes later)
- Firewall: inbound TCP 22 only. From your IP + GitHub Actions IP ranges,
  or simply "any" — the `command=` lock in authorized_keys is the real
  gate, and raw sshd on patched Ubuntu is fine for a single-purpose box.

### 2. Harden + create the `triage` user

```sh
ssh root@<ip>

adduser --disabled-password --gecos "" triage
usermod -aG sudo triage
rsync --archive --chown=triage:triage ~/.ssh /home/triage
# Lock the triage user out of password auth entirely (SSH key only).
sudo -u triage passwd -l triage

cat > /etc/ssh/sshd_config.d/99-triage.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
EOF
systemctl reload ssh

# Verify from a second terminal before you disconnect:
#   ssh triage@<ip>
```

### 3. Install tooling (as the `triage` user)

```sh
ssh triage@<ip>

sudo apt update
sudo apt install -y tmux jq git build-essential curl unzip gettext-base

# bun (TypeScript runner used by cx tests)
curl -fsSL https://bun.sh/install | bash
echo 'export BUN_INSTALL="$HOME/.bun"'              >> ~/.profile
echo 'export PATH="$BUN_INSTALL/bin:$PATH"'         >> ~/.profile

# Node 22 (npm, gh, @anthropic-ai/claude-code)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# GitHub CLI
(type -p wget >/dev/null || sudo apt install -y wget) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
     | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null \
  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
     | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && sudo apt update \
  && sudo apt install -y gh

# Claude Code (global install; you log in next)
sudo npm install -g @anthropic-ai/claude-code
```

Log out and back in so `~/.profile` adds bun to `PATH`.

### 4. Authenticate Claude under the `triage` user

```sh
ssh triage@<ip>
claude
```

Step through the OAuth flow. The token lands in `~/.claude/` and persists
across reboots (this is why we're on a real VM, not Railway).

Smoke test:
```sh
claude -p "say hi"
```

### 5. Authenticate gh with a fine-grained PAT

On github.com: **Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token**.

- **Token name:** `cx-triage-vps`
- **Expiration:** 1 year (set a calendar reminder to rotate)
- **Resource owner:** your user
- **Repository access:** "Only select repositories" → pick the `cx` repo
- **Permissions:**
  - Contents: **Read and write** (for `git push`)
  - Pull requests: **Read and write** (for `gh pr create`)
  - Issues: **Read and write** (for `gh issue comment`)
  - Metadata: Read-only (granted automatically)

Copy the token, then on the VPS:
```sh
echo "<PAT>" | gh auth login --with-token
gh auth status    # should show fine-grained token on github.com

git config --global user.name  "Andrew Magid (cx-triage)"
git config --global user.email "<your-noreply-email>@users.noreply.github.com"
```

### 6. Install the dispatch scripts

From your laptop, `scp` them over (or `git clone` cx on the VPS and copy
from there — either works):

```sh
# From laptop, in the cx repo root:
scp scripts/triage/dispatch.sh       triage@<ip>:cx-triage/
scp scripts/triage/session.sh        triage@<ip>:cx-triage/
scp scripts/triage/brief-template.md triage@<ip>:cx-triage/
```

Or, on the VPS:
```sh
mkdir -p ~/cx-triage
git clone https://github.com/<you>/cx.git ~/cx-source
cp ~/cx-source/scripts/triage/dispatch.sh       ~/cx-triage/
cp ~/cx-source/scripts/triage/session.sh        ~/cx-triage/
cp ~/cx-source/scripts/triage/brief-template.md ~/cx-triage/
```

Then:
```sh
chmod +x ~/cx-triage/dispatch.sh ~/cx-triage/session.sh
mkdir -p ~/cx-triage/runs
```

### 7. Create `~/cx-triage/.env`

```sh
cat > ~/cx-triage/.env <<'EOF'
# URL dispatch.sh clones from. Must be HTTPS — gh auth provides credentials.
CX_REPO_URL=https://github.com/<your-user>/cx.git

# Git identity for the commits Claude creates. Optional — defaults to
# "cx-triage <cx-triage@localhost>".
GIT_AUTHOR_NAME="Andrew Magid (cx-triage)"
GIT_AUTHOR_EMAIL="<your-noreply>@users.noreply.github.com"
EOF
chmod 600 ~/cx-triage/.env
```

### 8. Install the GitHub dispatch SSH key

Generate a dedicated keypair just for GitHub Actions → VPS:

```sh
ssh-keygen -t ed25519 -C "gh-actions-cx-triage" -f /tmp/triage_id -N ""

# Lock the public key to running ONLY dispatch.sh. Any other command,
# positional args, pty/port/agent/x11 — all denied.
KEY=$(cat /tmp/triage_id.pub)
{
  echo ""
  echo "# cx-triage dispatch key (GitHub Actions). Locked to dispatch.sh."
  echo "command=\"\$HOME/cx-triage/dispatch.sh\",no-pty,no-agent-forwarding,no-X11-forwarding,no-port-forwarding $KEY"
} >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Print the private key (for GitHub Secrets) and the host fingerprint.
# COPY BOTH OUTPUTS — you will not see them again.
echo "── PRIVATE KEY (paste into TRIAGE_SSH_KEY secret) ──"
cat /tmp/triage_id
echo
echo "── KNOWN HOSTS (paste into TRIAGE_SSH_KNOWN_HOSTS secret) ──"
ssh-keyscan -H "$(hostname -f || hostname)" 2>/dev/null
# Also run ssh-keyscan from your laptop against the VPS's public IP
# and use that output instead if the server's self-reported hostname
# differs from what GitHub Actions will connect to.

# Destroy the local copies — they only exist on the VPS now.
shred -u /tmp/triage_id /tmp/triage_id.pub
```

### 9. Add GitHub repo secrets

Go to the cx repo on github.com → **Settings → Secrets and variables →
Actions → New repository secret** — add each of:

| Secret                    | Value                                                             |
| ------------------------- | ----------------------------------------------------------------- |
| `TRIAGE_SSH_HOST`         | VPS public IP or hostname                                         |
| `TRIAGE_SSH_USER`         | `triage`                                                          |
| `TRIAGE_SSH_PORT`         | `22` (or whatever you configured; blank = 22)                     |
| `TRIAGE_SSH_KEY`          | Private key from step 8 (full PEM including `-----BEGIN/END-----`) |
| `TRIAGE_SSH_KNOWN_HOSTS`  | `ssh-keyscan -H` output from step 8                               |

That's the whole setup. No secrets are added on the VPS beyond the PAT and
git config, and no GitHub-side token ever leaves the runner except the
SSH key (which is only useful for running dispatch.sh).

## Verifying the pipeline

### Step 1 — dry-run dispatch.sh on the VPS

```sh
ssh triage@<ip>
cd ~/cx-triage

# Craft a fake payload that looks like a real failure.
cat > /tmp/fake-payload.json <<'EOF'
{
  "run_id": "dryrun-001",
  "run_url": "https://example.com/run/dryrun-001",
  "repo": "you/cx",
  "sha": "",
  "version": "2.1.101",
  "failed": 1,
  "issue": null,
  "report": {
    "version": "2.1.101",
    "timestamp": "2026-04-11T00:00:00.000Z",
    "total": 2,
    "passed": 1,
    "failed": 1,
    "results": [
      { "id": "banner",  "ok": true,  "durationMs": 12 },
      { "id": "queue",   "ok": false, "error": "target variable not found", "durationMs": 45 }
    ]
  }
}
EOF

DRY_RUN=1 bash ~/cx-triage/dispatch.sh < /tmp/fake-payload.json
# Expect: "SESSION=cx-triage-dryrun-001" on stdout
# Expect: ~/cx-triage/runs/dryrun-001/brief.md rendered with the failing patches
cat ~/cx-triage/runs/dryrun-001/brief.md
```

If the brief looks right, clean up: `rm -rf ~/cx-triage/runs/dryrun-001`.

### Step 2 — real dispatch.sh (spawns tmux + Claude)

Same fake payload, without `DRY_RUN`:
```sh
bash ~/cx-triage/dispatch.sh < /tmp/fake-payload.json
tmux ls
tmux attach -t cx-triage-dryrun-001
# Watch Claude try to fix a fake "banner" failure against the real cx repo.
# Ctrl-b d to detach. Kill with `tmux kill-session -t cx-triage-dryrun-001`.
```

### Step 3 — SSH end-to-end from your laptop

```sh
# Your laptop should simulate what GitHub Actions does.
ssh -i ~/.ssh/triage_id_dispatch \
    -o StrictHostKeyChecking=yes \
    triage@<ip> \
    < /tmp/fake-payload.json
# Expect: "SESSION=cx-triage-dryrun-002" printed back.
```

### Step 4 — full workflow dispatch from GitHub

```sh
# From your laptop with gh authed:
gh workflow run test-patches.yml -f version=<known-broken-version>
# Watch in real time:
gh run watch
```

Check that:
- The "Dispatch triage to VPS" step exits 0 and prints `SESSION=cx-triage-...`
- The "Comment attach hint" step posts on the regression issue
- On the VPS: `tmux ls` shows the session
- `ssh triage@<ip> -t tmux attach -t cx-triage-<run_id>` works

## Operator runbook

### How to watch a live triage

The regression issue comment tells you. Or, directly:
```sh
ssh triage@<ip> -t tmux attach -t cx-triage-<run_id>
```
`Ctrl-b d` to detach without killing. Claude will keep running.

### How to kill a stuck triage

```sh
ssh triage@<ip>
tmux kill-session -t cx-triage-<run_id>
# Optional: archive the workspace for post-mortem
tar -czf ~/cx-triage/archive/<run_id>.tar.gz \
    -C ~/cx-triage/runs <run_id>
rm -rf ~/cx-triage/runs/<run_id>
```

### How to trigger a triage manually

From your laptop:
```sh
gh workflow run test-patches.yml -f version=<broken-version>
```
The workflow will run the test suite, detect the failure, and dispatch.

### How to rotate the dispatch SSH key

1. Generate a new key (see setup step 8).
2. Add the new line to `~/.ssh/authorized_keys` (with the `command=` lock).
3. Update the `TRIAGE_SSH_KEY` and `TRIAGE_SSH_KNOWN_HOSTS` secrets in GitHub.
4. After verifying a successful dispatch with the new key, remove the old
   line from `authorized_keys`.

### How to update the scripts

The scripts in this directory are the source of truth. After a change:
```sh
ssh triage@<ip>
cd ~/cx-source && git pull
cp ~/cx-source/scripts/triage/dispatch.sh       ~/cx-triage/
cp ~/cx-source/scripts/triage/session.sh        ~/cx-triage/
cp ~/cx-source/scripts/triage/brief-template.md ~/cx-triage/
chmod +x ~/cx-triage/dispatch.sh ~/cx-triage/session.sh
```

### Log rotation

Add a weekly cron to clean up old runs (as the `triage` user):
```sh
crontab -e
# Keep the last 14 days of runs and archive everything else.
0 4 * * 0 find $HOME/cx-triage/runs -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
```

## Security notes

1. **SSH key is scoped via `command=`** — even if the GitHub Secret leaks,
   the key can only invoke `dispatch.sh`, not open a shell.
2. **Claude runs in a throwaway clone** under `~/cx-triage/runs/<run_id>/cx`.
   `--dangerously-skip-permissions` is deliberate: the blast radius is the
   run workspace, and the brief constrains Claude to `src/patches/**` and
   `src/transform.ts`.
3. **The GitHub write credential (PAT) lives on the VPS**, not in GitHub
   Secrets. A compromised Actions runner cannot forge PRs because it
   doesn't have the PAT — it can only send a JSON payload to dispatch.sh.
4. **Deduplication by failure hash** prevents loops: same (version + failed
   patch set) within 24h returns the existing session instead of spawning.
5. **Rate limit:** `dispatch.sh` refuses if ≥3 tmux sessions matching
   `cx-triage-*` are already active.
