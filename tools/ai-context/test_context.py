import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

import httpx2
import jwt
import uvicorn
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from fastmcp.server.auth.providers.jwt import JWTVerifier

from build import AREAS, ROOT, make_snapshot
from context_store import ContextStore
from server import create_server, configured_server
from cryptography.fernet import Fernet
import publish

COMMIT = "1" * 40
KEY = "this-is-a-test-key-only-not-a-production-secret-123456789"
FILES = {
    "main.go": "package main\nfunc routes() {}\n" + "// routes match\n" * 40,
    "auth.go": "package main\nfunc requireAuth() {}\n",
    "web/app.js": "export function routes() {}\n",
    "web/style.css": "/*" + "😀" * 9000 + "*/\nbody {}\n",
    "main_test.go": "func TestRoutes() {}\n",
    "CLAUDE.md": "Repository rules\n",
}


def fixture(path):
    manifest, packs, overview = make_snapshot(
        {"files": FILES}, {"files": {p: c[:100] for p, c in FILES.items()}},
        COMMIT, "main", "jnnngs/jiggered",
    )
    (path / "packs").mkdir()
    (path / "manifest.json").write_text(json.dumps(manifest))
    (path / "overview.json").write_text(json.dumps(overview))
    for a in AREAS:
        (path / "packs" / f"{a}.json").write_text(json.dumps(packs[a]))
    return manifest


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.manifest = fixture(self.path)
        self.store = ContextStore(local=self.path)

    def test_overview_has_no_full_source_and_has_commit(self):
        result = self.store.overview()
        self.assertEqual(result["source_commit"], COMMIT)
        self.assertFalse(result["stale"])
        self.assertNotIn("files", result)
        self.assertNotIn("content", result)
        self.assertLess(len(json.dumps(result)), 2500)

    def test_area_overview_is_bounded(self):
        self.assertLessEqual(len(self.store.overview("frontend")["content"]), 6000)

    def test_search_pages_without_missing_matches(self):
        first = self.store.search("routes", limit=12, expected_commit=COMMIT)
        second = self.store.search("routes", offset=first["next_offset"], limit=12)
        self.assertEqual(len(first["matches"]), 12)
        self.assertFalse({(x["path"], x["line"]) for x in first["matches"]}.intersection(
            {(x["path"], x["line"]) for x in second["matches"]}))
        self.assertLess(len(json.dumps(first)), 9000)

    def test_literal_search_and_scope(self):
        self.assertEqual(self.store.search(".*")["matches"], [])
        self.assertEqual(self.store.search("routes", area="frontend")["matches"][0]["path"], "web/app.js")

    def test_read_pagination_recovers_long_unicode_lines(self):
        chunks, line, column = [], 1, 0
        while line is not None:
            result = self.store.read_file("web/style.css", line, 1, column, COMMIT)
            chunks.extend(row["text"] for row in result["lines"])
            self.assertLess(len(json.dumps(result, ensure_ascii=False)), 30000)
            line, column = result["next_line"], result["next_column"]
        self.assertEqual("".join(chunks), "".join(FILES["web/style.css"].splitlines()))

    def test_file_listing_pages_and_prefix(self):
        result = self.store.list_files(path_prefix="web/", limit=1)
        self.assertEqual(result["next_offset"], 1)
        self.assertEqual(len(self.store.list_files(path_prefix="web/", offset=1)["files"]), 1)

    def test_paths_limits_and_commit_checks(self):
        for path in ("../../.env", "/etc/passwd", "unknown.go", "web\\app.js"):
            with self.assertRaises(ValueError):
                self.store.read_file(path)
        for call in (lambda: self.store.search(""), lambda: self.store.search("x" * 129),
                     lambda: self.store.search("x", limit=100), lambda: self.store.list_files(limit=100),
                     lambda: self.store.read_file("main.go", start_line=0),
                     lambda: self.store.read_file("main.go", column_offset=999),
                     lambda: self.store.overview("unknown"),
                     lambda: self.store.read_file("main.go", expected_commit="2" * 40)):
            with self.assertRaises(ValueError):
                call()

    def test_integrity_fail_closed(self):
        path = self.path / "packs/backend.json"
        path.write_text(json.dumps({"main.go": "tampered"}))
        with self.assertRaises(ValueError):
            self.store.overview()

    def test_dirty_or_feature_branch_snapshot_is_rejected(self):
        for updates in ({"source_worktree_dirty": True}, {"source_branch": "feature/demo"}):
            manifest = {**self.manifest, **updates}
            (self.path / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "clean main"):
                ContextStore(local=self.path).overview()

    def test_stale_snapshot_reports_status_and_refuses_source_reads(self):
        self.store.snapshot()
        self.store._head = "2" * 40
        self.assertTrue(self.store.overview()["stale"])
        with self.assertRaisesRegex(ValueError, "behind main"):
            self.store.search("routes")

    def test_remote_refresh_pins_reads_and_rechecks_main(self):
        class Remote(ContextStore):
            head = COMMIT
            context = "3" * 40

            def _ref(inner, branch):
                return inner.head if branch == "main" else inner.context

            def _json(inner, path, raw=False):
                self.assertTrue(raw)
                self.assertTrue(path.endswith("?ref=" + inner.context))
                return json.loads((self.path / path.removeprefix("contents/").split("?")[0]).read_text())

        remote = Remote(token="test", ttl=0)
        self.assertFalse(remote.overview()["stale"])
        remote.head = "4" * 40
        self.assertTrue(remote.overview()["stale"])
        with self.assertRaises(ValueError):
            remote.read_file("main.go")

    def test_builder_rejects_unsafe_paths_and_inconsistent_coverage(self):
        for files, compressed in (({"../x.go": "x"}, {"../x.go": "x"}), ({"x.go": "x"}, {})):
            with self.assertRaises(ValueError):
                make_snapshot({"files": files}, {"files": compressed}, COMMIT, "main", "jnnngs/jiggered")

    def test_repomix_real_output_and_exclusions(self):
        cli = ROOT / "tools/ai-context/node_modules/.bin/repomix"
        if not cli.exists():
            self.fail("Run npm ci --prefix tools/ai-context before the tests")
        source = self.path / "repo"
        source.mkdir()
        (source / "main.go").write_text("package main\nfunc main() { println(42) }\n")
        (source / ".env").write_text("SECRET=must-not-ship")
        (source / "personal.db").write_text("health data")
        (source / "backups").mkdir()
        (source / "backups/backup.go").write_text("must-not-ship")
        subprocess.run([str(cli), str(source), "--config", str(ROOT / "tools/ai-context/repomix.config.json"),
                        "--output", str(self.path / "output.json"), "--quiet"], check=True, cwd=ROOT)
        output = json.loads((self.path / "output.json").read_text())
        self.assertEqual(set(output["files"]), {"main.go"})
        self.assertIn("println(42)", output["files"]["main.go"])


class PublishTests(unittest.TestCase):
    def test_generated_branch_is_private_remote_only_and_preserves_main(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, remote = Path(tmp) / "source", Path(tmp) / "remote.git"
            subprocess.run(["git", "init", "--bare", "-q", str(remote)], check=True)
            root.mkdir()
            subprocess.run(["git", "init", "-q", "-b", "main", str(root)], check=True)

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root, stderr=subprocess.DEVNULL).decode().strip()

            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.com")
            git("remote", "add", "origin", str(remote))
            (root / "main.go").write_text("package main\n")
            (root / ".gitignore").write_text(".ai-context/\n")
            git("add", ".")
            git("commit", "-qm", "Source")
            git("push", "-q", "origin", "main")
            head = git("rev-parse", "HEAD")
            snapshot = root / ".ai-context"
            snapshot.mkdir()
            manifest = fixture(snapshot)
            manifest["source_commit"] = head
            (snapshot / "manifest.json").write_text(json.dumps(manifest))
            with patch.object(publish, "ROOT", root):
                publish.publish()
                first = git("ls-remote", "origin", "refs/heads/ai-context").split()[0]
                git("fetch", "-q", "origin", "refs/heads/ai-context")
                entries = git("ls-tree", "-r", "--name-only", "FETCH_HEAD").splitlines()
                self.assertEqual(entries, ["manifest.json", "overview.json", "packs/backend.json",
                                           "packs/frontend.json", "packs/tests.json", "packs/tooling.json"])
                self.assertEqual(git("rev-parse", "HEAD"), head)
                self.assertEqual(git("status", "--porcelain"), "")
                # A newer main must never receive an older snapshot.
                (root / "main.go").write_text("package main\n// newer\n")
                git("add", "main.go")
                git("commit", "-qm", "Advance main")
                git("push", "-q", "origin", "main")
                publish.publish()
                self.assertEqual(git("ls-remote", "origin", "refs/heads/ai-context").split()[0], first)
                manifest["source_commit"] = git("rev-parse", "HEAD")
                (snapshot / "manifest.json").write_text(json.dumps(manifest))
                publish.publish()
                git("fetch", "-q", "origin", "refs/heads/ai-context")
                self.assertEqual(git("rev-parse", "FETCH_HEAD^"), first)


class MCPTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        path = Path(self.tmp.name)
        fixture(path)
        auth = JWTVerifier(public_key=KEY, algorithm="HS256", issuer="test", audience="context")
        self.server = create_server(ContextStore(local=path), auth, ["jnnngs"])
        self.socket = socket.socket()
        self.socket.bind(("127.0.0.1", 0))
        self.port = self.socket.getsockname()[1]
        app = self.server.http_app(stateless_http=True, json_response=True)
        self.http = uvicorn.Server(uvicorn.Config(app, log_level="error", lifespan="on"))
        self.task = asyncio.create_task(self.http.serve(sockets=[self.socket]))
        for _ in range(100):
            if self.http.started:
                break
            await asyncio.sleep(0.05)
        if not self.http.started:
            raise RuntimeError("Test MCP server did not start")
        self.url = f"http://127.0.0.1:{self.port}/mcp"

    async def asyncTearDown(self):
        self.http.should_exit = True
        await asyncio.wait_for(self.task, 10)
        self.socket.close()
        self.tmp.cleanup()

    def token(self, login):
        return jwt.encode({"iss": "test", "aud": "context", "sub": login,
                           "login": login, "exp": int(time.time()) + 300}, KEY, algorithm="HS256")

    async def test_unauthenticated_http_is_rejected(self):
        async with httpx2.AsyncClient(trust_env=False) as client:
            result = await client.post(self.url, json={"jsonrpc": "2.0", "id": 1, "method": "initialize"})
        self.assertEqual(result.status_code, 401)
        self.assertIn("www-authenticate", result.headers)

    async def test_authorized_client_retrieves_bounded_source(self):
        transport = StreamableHttpTransport(self.url, auth=self.token("jnnngs"),
                                           httpx_client_factory=lambda **kw: httpx2.AsyncClient(**kw, trust_env=False))
        async with Client(transport) as client:
            tools = await client.list_tools()
            self.assertEqual({t.name for t in tools}, {
                "context_overview", "list_context_files", "search_context", "read_context_file"})
            overview = await client.call_tool("context_overview", {})
            self.assertEqual(overview.data["source_commit"], COMMIT)
            result = await client.call_tool("search_context", {"query": "routes", "expected_commit": COMMIT})
            self.assertEqual(len(result.data["matches"]), 12)
            source = await client.call_tool("read_context_file", {"path": "main.go", "line_count": 2})
            self.assertEqual(len(source.data["lines"]), 2)

    async def test_other_authenticated_user_cannot_read_private_source(self):
        transport = StreamableHttpTransport(self.url, auth=self.token("somebody-else"),
                                           httpx_client_factory=lambda **kw: httpx2.AsyncClient(**kw, trust_env=False))
        async with Client(transport) as client:
            with self.assertRaises(Exception):
                await client.call_tool("context_overview", {})


class OAuthConfigurationTests(unittest.IsolatedAsyncioTestCase):
    async def test_deployed_provider_discovery_and_persistent_configuration(self):
        with tempfile.TemporaryDirectory() as state:
            values = {
                "AI_CONTEXT_BASE_URL": "https://context.example.com",
                "AI_CONTEXT_CLIENT_REDIRECT_URIS": "https://claude.ai/api/mcp/auth_callback",
                "AI_CONTEXT_JWT_SIGNING_KEY": KEY,
                "AI_CONTEXT_STORAGE_ENCRYPTION_KEY": Fernet.generate_key().decode(),
                "AI_CONTEXT_STATE_DIR": state,
                "AI_CONTEXT_OAUTH_CLIENT_ID": "test-client",
                "AI_CONTEXT_OAUTH_CLIENT_SECRET": "test-secret",
                "AI_CONTEXT_ALLOWED_USERS": "jnnngs",
                "AI_CONTEXT_GITHUB_TOKEN": "test-token",
            }
            with patch.dict(os.environ, values):
                server = configured_server()
                app = server.http_app(stateless_http=True, json_response=True)
                async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app),
                                              base_url=values["AI_CONTEXT_BASE_URL"], trust_env=False) as client:
                    discovery = await client.get("/.well-known/oauth-authorization-server")
                    self.assertEqual(discovery.status_code, 200)
                    metadata = discovery.json()
                    self.assertEqual(metadata["token_endpoint"], "https://context.example.com/token")
                    self.assertEqual(metadata["registration_endpoint"], "https://context.example.com/register")
                    protected = await client.get("/.well-known/oauth-protected-resource/mcp")
                    self.assertEqual(protected.status_code, 200)
                    self.assertEqual(protected.json()["resource"], "https://context.example.com/mcp")
                    registered = await client.post("/register", json={
                        "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
                        "token_endpoint_auth_method": "none", "grant_types": ["authorization_code"],
                        "response_types": ["code"], "client_name": "Prototype test",
                    })
                    self.assertEqual(registered.status_code, 201)
                # The same secrets/store must construct another server after a restart.
                self.assertIsNotNone(configured_server().http_app(stateless_http=True))

    def test_insecure_origin_and_wildcard_callbacks_are_rejected(self):
        for values in ({"AI_CONTEXT_BASE_URL": "http://context.example.com"},
                       {"AI_CONTEXT_BASE_URL": "https://context.example.com", "AI_CONTEXT_CLIENT_REDIRECT_URIS": "https://*"}):
            with patch.dict(os.environ, values), self.assertRaises(ValueError):
                configured_server()


if __name__ == "__main__":
    unittest.main()
