#!/usr/bin/env python3
"""
graphify_build.py — SERIAL, code-only graphify builder for edgeXcrm.

Most devs should NOT call this directly — run `./scripts/graphify-setup.sh` instead.

Why this exists (not the stock `/graphify` skill or `graphify update`):

  1. Parallel AST extraction CRASHES on Apple Silicon ("process pool terminated
     abruptly") -> every file yields zero nodes -> degenerate graph. The stock CLI
     build/update/watch paths all default to parallel. This script forces
     `extract(parallel=False)`, which is reliable AND faster (~8s for 1200 files).

  2. The stock `graphify update` writes to `<scan_path>/graphify-out`. Since our
     scan root is `src/`, that puts the graph in `src/graphify-out/` while
     `.mcp.json` reads the repo-root `graphify-out/` — so the MCP server silently
     serves a stale graph forever. This script always writes to <repo>/graphify-out.

  Code-only extraction => 0 tokens, $0. Safe to re-run as often as you like.

Usage:
  python3 graphify_build.py <repo_path> [--subdir src] [--obsidian <vault_dir>]

  <repo_path>          repo root; graph.json lands in <repo_path>/graphify-out/
  --subdir DIR         scan only this subfolder (default: whole repo). Use 'src' for
                       Next.js repos to skip build output / node_modules noise.
  --obsidian DIR       also export the node-graph as an Obsidian vault into DIR
  --no-viz             skip graph.html (faster; for CI / >5000-node graphs)

Run with the graphify interpreter (graphify's deps are not in this repo's env):
  uv tool run --from graphifyy python scripts/graphify_build.py . --subdir src
"""
import argparse, json, sys
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("--subdir", default=None)
    ap.add_argument("--obsidian", default=None)
    ap.add_argument("--no-viz", action="store_true")
    a = ap.parse_args()

    repo = Path(a.repo).expanduser().resolve()
    scan = (repo / a.subdir) if a.subdir else repo
    out = repo / "graphify-out"
    out.mkdir(parents=True, exist_ok=True)
    if not scan.exists():
        sys.exit(f"scan path does not exist: {scan}")

    from graphify.detect import detect
    from graphify.extract import collect_files, extract
    from graphify.build import build_from_json
    from graphify.cluster import cluster, score_all
    from graphify.analyze import god_nodes, surprising_connections, suggest_questions
    from graphify.report import generate
    from graphify.export import to_json

    det = detect(scan)
    files = det.get("files", {})
    print(f"[{repo.name}] detect: {det.get('total_files')} files "
          f"{ {k: len(v) for k, v in files.items() if v} }")

    code_files = []
    for f in files.get("code", []):
        p = Path(f)
        code_files.extend(collect_files(p) if p.is_dir() else [p])
    if not code_files:
        sys.exit("no code files found — nothing to build")

    # SERIAL extraction — the whole point of this script (see module docstring).
    ast = extract(code_files, cache_root=scan, parallel=False)
    print(f"[{repo.name}] AST: {len(ast['nodes'])} nodes, {len(ast['edges'])} edges "
          f"(serial, {len(code_files)} files)")

    extraction = {
        "nodes": ast["nodes"],
        "edges": ast["edges"],
        "hyperedges": [],
        "input_tokens": 0, "output_tokens": 0,
    }
    G = build_from_json(extraction, root=str(scan), directed=False)
    if G.number_of_nodes() == 0:
        sys.exit("ERROR: empty graph (extraction produced no nodes)")

    communities = cluster(G)
    cohesion = score_all(G, communities)
    gods = god_nodes(G)
    surprises = surprising_connections(G, communities)
    labels = {cid: "Community " + str(cid) for cid in communities}
    questions = suggest_questions(G, communities, labels)

    wrote = to_json(G, communities, str(out / "graph.json"))
    if not wrote:
        sys.exit("ERROR: refused to shrink existing graph.json (#479); delete graphify-out/ to force")
    report = generate(G, communities, cohesion, labels, gods, surprises, det,
                      {"input": 0, "output": 0}, str(scan), suggested_questions=questions)
    (out / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    (out / ".graphify_python").write_text(sys.executable, encoding="utf-8")
    (out / ".graphify_root").write_text(str(scan), encoding="utf-8")
    print(f"[{repo.name}] graph: {G.number_of_nodes()} nodes, "
          f"{G.number_of_edges()} edges, {len(communities)} communities -> {out}")

    # HTML + optional Obsidian export via the CLI (reads graphify-out/graph.json in cwd)
    import subprocess, os
    env = dict(os.environ)
    if not a.no_viz:
        subprocess.run(["graphify", "export", "html"], cwd=repo, env=env, check=False)
    if a.obsidian:
        subprocess.run(["graphify", "export", "obsidian", "--dir", a.obsidian],
                       cwd=repo, env=env, check=False)
        print(f"[{repo.name}] obsidian vault -> {a.obsidian}")


if __name__ == "__main__":
    main()
