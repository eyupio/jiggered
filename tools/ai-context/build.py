"""Generate a private, commit-labelled snapshot from Repomix JSON output."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
AREAS = ("backend", "frontend", "tests", "tooling")


def area_for(path):
    if path.endswith("_test.go") or path.startswith("test/"):
        return "tests"
    if path.endswith(".go") or path in ("go.mod", "go.sum"):
        return "backend"
    if path.startswith("web/"):
        return "frontend"
    return "tooling"


def safe_path(path):
    p = PurePosixPath(path)
    return bool(path) and not p.is_absolute() and ".." not in p.parts and "\\" not in path


def estimate_tokens(text):
    # Deliberately labelled heuristic; not a Claude/ChatGPT usage meter.
    return (len(text.encode("utf-8")) + 3) // 4


def make_snapshot(full, compressed, commit, branch, repository):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Source commit must be a full Git SHA")
    files = full["files"]
    if not files or not all(safe_path(p) and isinstance(c, str) for p, c in files.items()):
        raise ValueError("Invalid or empty Repomix file map")
    if set(compressed["files"]) != set(files):
        raise ValueError("Full and compressed snapshots must cover the same files")
    packs = {a: {p: files[p] for p in sorted(files) if area_for(p) == a} for a in AREAS}
    overview = {a: {p: compressed["files"][p] for p in packs[a]} for a in AREAS}
    stats = {
        a: {
            "files": len(packs[a]),
            "source_tokens_estimate": sum(estimate_tokens(c) for c in packs[a].values()),
            "overview_tokens_estimate": sum(estimate_tokens(c) for c in overview[a].values()),
        }
        for a in AREAS
    }
    manifest = {
        "schema_version": 1,
        "repository": repository,
        "source_commit": commit,
        "source_branch": branch,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generator": "repomix@1.18.1",
        "token_estimation": "UTF-8 bytes / 4, rounded up per file; heuristic only",
        "summary": "Jiggered: self-hosted energy check-ins and symptom tracking. Go/SQLite API and static JavaScript frontend.",
        "areas": stats,
        "files": [
            {
                "path": p, "area": area_for(p), "lines": len(c.splitlines()),
                "sha256": hashlib.sha256(c.encode()).hexdigest(),
                "tokens_estimate": estimate_tokens(c),
            }
            for p, c in sorted(files.items())
        ],
    }
    return manifest, packs, overview


def build(output):
    source_commit = os.environ.get("AI_CONTEXT_SOURCE_SHA") or subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()
    branch = os.environ.get("AI_CONTEXT_SOURCE_BRANCH") or subprocess.check_output(
        ["git", "branch", "--show-current"], cwd=ROOT, text=True
    ).strip()
    cli = ROOT / "tools/ai-context/node_modules/.bin/repomix"
    with tempfile.TemporaryDirectory(prefix="jiggered-context-") as tmp:
        paths = []
        for name, compress in (("full", False), ("compressed", True)):
            path = Path(tmp) / f"{name}.json"
            args = [str(cli), "--config", "tools/ai-context/repomix.config.json",
                    "--output", str(path), "--quiet"]
            if compress:
                args.append("--compress")
            subprocess.run(args, cwd=ROOT, check=True)
            paths.append(json.loads(path.read_text()))
        manifest, packs, overview = make_snapshot(
            *paths, source_commit, branch, os.environ.get("GITHUB_REPOSITORY", "jnnngs/jiggered")
        )
        manifest["source_worktree_dirty"] = bool(subprocess.check_output(
            ["git", "status", "--porcelain"], cwd=ROOT, text=True
        ).strip())
        staging = Path(tmp) / "snapshot"
        (staging / "packs").mkdir(parents=True)
        for a, contents in packs.items():
            (staging / "packs" / f"{a}.json").write_text(json.dumps(contents, ensure_ascii=False))
        (staging / "overview.json").write_text(json.dumps(overview, ensure_ascii=False))
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2))
        # Generated output is disposable; refuse to delete a source directory.
        output = output.resolve()
        if output != ROOT / ".ai-context":
            raise ValueError("Output must be the repository's .ai-context directory")
        if output.exists():
            shutil.rmtree(output)
        shutil.copytree(staging, output)
    print(json.dumps({"source_commit": source_commit, "areas": manifest["areas"]}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / ".ai-context")
    build(parser.parse_args().output)
