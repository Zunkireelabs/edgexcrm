#!/usr/bin/env bash
#
# graphify-setup.sh — one-command setup of the edgeXcrm code knowledge graph.
#
# What it does:
#   1. Verifies graphify is installed (tells you how if not)
#   2. Builds the code graph from src/ — serial, AST-only, 0 tokens, $0
#   3. Writes/merges .mcp.json so Claude Code gets the graphify MCP tools
#
# Run from anywhere:  ./scripts/graphify-setup.sh
# Re-run any time to refresh the graph after pulling or changing code.
#
# See docs/reference/05-GRAPHIFY-CODE-GRAPH.md for the full guide.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

say() { printf '\033[1m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$1" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- 1. preflight
if ! command -v graphify >/dev/null 2>&1; then
  cat >&2 <<'EOF'
error: graphify is not installed (or not on your PATH).

Install it once, globally — it is NOT a project dependency:

  # 1. install uv (Python tool manager) if you don't have it
  curl -LsSf https://astral.sh/uv/install.sh | sh

  # 2. install graphify WITH the mcp extra (the [mcp] part is required —
  #    without it the MCP server dies with ModuleNotFoundError: No module named 'mcp')
  uv tool install "graphifyy[mcp]"

  # 3. make sure ~/.local/bin is on your PATH, then re-run this script
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc

EOF
  exit 1
fi

if ! command -v graphify-mcp >/dev/null 2>&1; then
  die "graphify is installed but graphify-mcp is missing.
  Reinstall with the mcp extra:  uv tool install \"graphifyy[mcp]\" --force"
fi

say "graphify $(graphify --version 2>/dev/null || echo '?') found at $(command -v graphify)"

# graphify's dependencies (networkx, tree-sitter, ...) live in its own venv, not
# in this repo. Grab that interpreter from the console script's shebang so we can
# import the graphify package directly for the serial build.
GRAPHIFY_PY="$(head -1 "$(command -v graphify)" | sed 's/^#!//' | tr -d '"')"
if [ ! -x "$GRAPHIFY_PY" ]; then
  warn "could not resolve graphify's interpreter from its shebang; falling back to uv"
  command -v uv >/dev/null 2>&1 || die "uv not found and interpreter unresolved — see install steps above"
  GRAPHIFY_PY=""
fi

# ------------------------------------------------------------------- 2. build
# Belt and braces: the builder passes parallel=False, and this env var pins the
# stock code paths to 1 worker too. Parallel extraction crashes on Apple Silicon.
export GRAPHIFY_MAX_WORKERS=1

say "Building code graph from src/ (serial, AST-only — no LLM, no API cost)..."
if [ -n "$GRAPHIFY_PY" ]; then
  "$GRAPHIFY_PY" scripts/graphify_build.py . --subdir src
else
  uv tool run --from graphifyy python scripts/graphify_build.py . --subdir src
fi

[ -f graphify-out/graph.json ] || die "build finished but graphify-out/graph.json is missing"

# --------------------------------------------------------------- 3. mcp config
# .mcp.json is gitignored (it holds per-developer connection strings), so each dev
# generates their own. Paths here are RELATIVE and the command is bare, so this
# config is portable across machines — Claude Code runs the server with cwd = repo root.
say "Configuring .mcp.json..."
python3 - <<'PY'
import json, pathlib

path = pathlib.Path(".mcp.json")
entry = {"command": "graphify-mcp", "args": ["graphify-out/graph.json"]}

if path.exists():
    try:
        cfg = json.loads(path.read_text())
    except json.JSONDecodeError:
        raise SystemExit("error: .mcp.json exists but is not valid JSON — fix or delete it, then re-run")
else:
    cfg = {}

servers = cfg.setdefault("mcpServers", {})
if servers.get("graphify") == entry:
    print("  .mcp.json already configured (no change)")
else:
    servers["graphify"] = entry          # merge — never clobber other MCP servers
    path.write_text(json.dumps(cfg, indent=2) + "\n")
    print("  .mcp.json -> graphify MCP server registered")
PY

# ------------------------------------------------------------------ 4. verify
say "Verifying the MCP server responds..."
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"setup","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"graph_stats","arguments":{}}}' \
  | graphify-mcp graphify-out/graph.json 2>/dev/null \
  | python3 -c '
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line.startswith("{"):
        continue
    d = json.loads(line)
    if d.get("id") == 2:
        for c in d.get("result", {}).get("content", []):
            print("  " + c.get("text", "").replace("\n", "\n  ").rstrip())
        break
else:
    sys.exit("  MCP server did not answer graph_stats")
'

cat <<'EOF'

Done. Next steps:
  1. Restart Claude Code (or run /mcp) inside this repo so it picks up .mcp.json
  2. Confirm the "graphify" server shows as connected in /mcp

From then on Claude queries the graph before grepping/reading source files —
the PreToolUse hook in .claude/settings.json enforces it.

Refresh the graph after pulling or big refactors:  ./scripts/graphify-setup.sh
EOF
