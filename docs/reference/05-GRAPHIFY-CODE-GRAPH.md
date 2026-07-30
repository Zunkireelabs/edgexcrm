# Graphify Code Graph — token-efficient codebase navigation

**What it is:** a queryable knowledge graph of `src/`, built by static AST parsing. Claude (and you) can ask "what calls this?" / "how do these two things connect?" and get a scoped answer **without reading a single source file**.

**Why we use it:** answering "how does auth work here?" the naive way costs 20–50k tokens of grep + file reads. A graph query costs a few hundred. On a 1,200-file repo that is the difference between burning a context window on orientation and spending it on the actual work.

**Cost:** building the graph is 100% deterministic AST extraction — **0 tokens, $0**. No API key needed. It is not an LLM feature; it is a parser.

---

## Setup (once per developer)

```bash
./scripts/graphify-setup.sh
```

That script verifies your install, builds the graph, and wires up `.mcp.json`. If graphify isn't installed it prints exactly what to run.

Install prerequisite (global, **not** a project dependency):

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # if you don't have uv
uv tool install "graphifyy[mcp]"                   # the [mcp] extra is REQUIRED
```

> **The `[mcp]` extra is not optional.** `uv tool install graphifyy` (without it) installs fine but the MCP server dies at startup with `ModuleNotFoundError: No module named 'mcp'`, which surfaces in Claude Code as the unhelpful `Failed to reconnect to graphify: -32000`. If you see that, run `uv tool install "graphifyy[mcp]" --force`.

After setup, restart Claude Code (or run `/mcp`) and confirm `graphify` shows as **connected**.

---

## What's in the graph

Current build of `src/` — 1,204 files:

| | |
|---|---|
| Nodes | ~5,855 |
| Edges | ~26,280 |
| Communities | ~161 |
| Extraction | 100% EXTRACTED (0% inferred guesswork) |
| Token cost | 0 in / 0 out |

The most connected symbols — our real core abstractions, ranked by the graph rather than by opinion:

| Symbol | Edges |
|---|---|
| `apiSuccess()` | 724 |
| `apiUnauthorized()` | 719 |
| `authenticateRequest()` | 706 |
| `apiForbidden()` | 641 |
| `ScopedClient` | 617 |
| `getFeatureAccess()` | 546 |

If you change any of these, the graph is telling you the blast radius is enormous.

---

## How to query it

### In Claude Code (preferred) — MCP tools

Once connected, these are available as `mcp__graphify__*`:

| Tool | Use for |
|---|---|
| `get_node` | Find one symbol: where defined, degree, community |
| `get_neighbors` | What calls this / what does this call |
| `shortest_path` | How does A reach B (great for tracing auth → data access) |
| `god_nodes` | The core abstractions, ranked |
| `get_community` | Everything in one cohesive cluster |
| `graph_stats` | Sanity check the graph is loaded |
| `query_graph` | Broad search — **noisy on this repo, see below** |

### From the terminal — CLI

```bash
graphify explain "authenticateRequest"          # definition + neighbours
graphify path "handlePost" "ScopedClient"       # how two symbols connect
```

---

## Known limitations — read these before trusting output

**1. `query` matches symbol names, not natural language.**
`graphify query "authentication"` returns *"No matching nodes found."* The graph's nodes are identifiers (`authenticateRequest`, `ScopedClient`), not concepts. Search for the symbol, not the idea. This is the single most common way people conclude "graphify doesn't work".

**2. Broad queries on god nodes are noisy.** `explain "authenticateRequest"` reports 706 connections and truncates with *"...and 686 more"*, mostly repeated `route.ts [imports]` lines. Scoped questions (`shortest_path`, `get_neighbors` on a specific function) are where it is sharp.

**3. Community labels are placeholders.** The report lists `Community 0 … Community 160`, not meaningful names. Labelling requires an LLM pass, and every rebuild re-clusters and renumbers them, resetting any hand labels. Node- and path-level queries are unaffected — only the "map" view suffers.

**4. `graph.html` is the aggregated view only.** The graph exceeded the 5,000-node viewer limit, so the HTML shows ~161 community blobs, not individual symbols. Node-level detail lives in `graph.json`.

**5. The graph can go stale silently.** Nothing rebuilds it automatically. If you have pulled significant changes, re-run `./scripts/graphify-setup.sh` (it is incremental and cached — usually seconds).

---

## Refreshing — use the script, not `graphify update`

```bash
./scripts/graphify-setup.sh     # correct
```

> **Do not run `graphify update` or `graphify update src` in this repo.**
> The stock command writes its output to `<scan_path>/graphify-out`. Our scan root is `src/`, so it creates **`src/graphify-out/`** — while `.mcp.json` reads the repo-root `graphify-out/`. Nothing errors; the MCP server just keeps serving the old graph forever. (Both paths are in `.gitignore` because this has already happened once.)
>
> Likewise **do not run `graphify claude install`.** It overwrites `.claude/settings.json` with a machine-specific absolute path and replaces the customised CLAUDE.md section with generic advice that contains the wrong refresh command.

`scripts/graphify_build.py` is the underlying builder. It forces **serial** extraction: parallel AST extraction crashes on Apple Silicon ("process pool terminated abruptly"), and the failure mode is silent — every file yields zero nodes and you get a degenerate graph with a few dozen edges instead of 26,000. Serial is also faster here (~8s for 1,204 files).

---

## What is and isn't committed

| Path | Committed? | Why |
|---|---|---|
| `scripts/graphify-setup.sh` | ✅ | Shared onboarding |
| `scripts/graphify_build.py` | ✅ | Shared builder (serial-safe) |
| `.claude/settings.json` | ✅ | PreToolUse hooks — the whole team gets graph-first behaviour |
| `.mcp.json.example` | ✅ | Template |
| `.mcp.json` | ❌ gitignored | Per-developer; generated by the setup script |
| `graphify-out/` | ❌ gitignored | ~12 MB `graph.json`, regenerated locally in seconds |

Because `graphify-out/` is not in git, **every developer must run the setup script themselves** — cloning the repo does not give you a graph.

---

## The enforcement mechanism

`.claude/settings.json` registers two `PreToolUse` hooks:

- **`Bash`** → fires when Claude runs `grep`/`rg`/`find`
- **`Read|Glob`** → fires when Claude opens a source file

Each injects a "check the graph first" instruction into Claude's context. They **fail open**: they always exit 0, never block a tool call, and print nothing when `graphify-out/graph.json` is missing — so a developer who hasn't run the setup script sees no errors, just no nudges.

The commands are guarded with `command -v graphify` and use a bare command name rather than an absolute path, so the file is portable across machines.
