"""Publish only generated JSON to the private ai-context branch, without checkout changes."""

import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def git(*args, env=None, input=None):
    return subprocess.check_output(["git", *args], cwd=ROOT, env=env, input=input).decode().strip()


def publish():
    snapshot = ROOT / ".ai-context"
    manifest = json.loads((snapshot / "manifest.json").read_text())
    if manifest["source_branch"] != "main" or manifest.get("source_worktree_dirty", False):
        raise ValueError("Only a clean main snapshot can be published")
    current = git("ls-remote", "origin", "refs/heads/main").split()[0]
    if current != manifest["source_commit"]:
        print("Main advanced during generation; leaving publication to the newer workflow.")
        return
    parents = []
    existing = git("ls-remote", "origin", "refs/heads/ai-context")
    if existing:
        git("fetch", "--depth", "1", "--no-tags", "origin", "refs/heads/ai-context")
        parents = ["-p", git("rev-parse", "FETCH_HEAD")]
    paths = ["manifest.json", "overview.json", *[f"packs/{a}.json" for a in manifest["areas"]]]
    with tempfile.TemporaryDirectory() as tmp:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(tmp) / "index"),
               "GIT_AUTHOR_NAME": "github-actions[bot]", "GIT_COMMITTER_NAME": "github-actions[bot]",
               "GIT_AUTHOR_EMAIL": "41898282+github-actions[bot]@users.noreply.github.com",
               "GIT_COMMITTER_EMAIL": "41898282+github-actions[bot]@users.noreply.github.com"}
        for path in paths:
            sha = git("hash-object", "-w", "--stdin", input=(snapshot / path).read_bytes())
            git("update-index", "--add", "--cacheinfo", f"100644,{sha},{path}", env=env)
        tree = git("write-tree", env=env)
        commit = git("commit-tree", tree, *parents, "-m",
                     f"Refresh AI context for {manifest['source_commit']}", env=env)
        # A normal fast-forward push; a competing publisher causes failure rather than overwriting it.
        git("push", "origin", f"{commit}:refs/heads/ai-context")
    print(f"Published context for {manifest['source_commit']}")


if __name__ == "__main__":
    publish()
