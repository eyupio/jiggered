import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { waitForHealth } from "./support/browser.cjs";

const execute = promisify(execFile);
const harnessPath = fileURLToPath(new URL("./support/browser.cjs", import.meta.url));

test("browser readiness rejects exited servers and bounded health failures", async (t) => {
  await assert.rejects(
    waitForHealth("http://unused", { exitCode: 2, signalCode: null }, () => null),
    /Server exited.*2/,
  );
  t.mock.method(globalThis, "fetch", async () => new Response("not ready", { status: 503 }));
  await assert.rejects(
    waitForHealth("http://unused", { exitCode: null, signalCode: null }, () => null, 10),
    /did not become healthy/,
  );
});

test("browser harness cleans temporary data after an executable fails to start", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jiggered-harness-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = `require(${JSON.stringify(harnessPath)}).runBrowser({name:'missing'},()=>{}).catch(e=>{console.error(e.message);process.exitCode=1})`;
  await assert.rejects(
    execute(process.execPath, ["-e", source], {
      env: {
        ...process.env,
        TMPDIR: dir,
        JIGGERED_TEST_BINARY: path.join(dir, "missing-binary"),
        JIGGERED_TEST_PORT: "",
        JIGGERED_ARTIFACT_DIR: "",
      },
      timeout: 10000,
    }),
    (error) => error.code === 1 && /ENOENT/.test(error.stderr),
  );
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("browser harness stops its server and removes the database after a scenario fails", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jiggered-harness-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixture = path.join(dir, "server.cjs"),
    pid = path.join(dir, "pid");
  fs.writeFileSync(
    fixture,
    `#!/usr/bin/env node
const fs=require('node:fs'),http=require('node:http');
fs.writeFileSync(process.env.APP_DB,'disposable fixture');
fs.writeFileSync(${JSON.stringify(pid)},String(process.pid));
const addr=process.env.APP_ADDR.split(':');
http.createServer((req,res)=>res.end('ok')).listen(Number(addr[1]),addr[0]);
`,
  );
  fs.chmodSync(fixture, 0o700);
  const source = `require(${JSON.stringify(harnessPath)}).runBrowser({name:'failure'},()=>{throw Error('intentional scenario failure')}).catch(e=>{console.error(e.message);process.exitCode=1})`;
  await assert.rejects(
    execute(process.execPath, ["-e", source], {
      env: {
        ...process.env,
        TMPDIR: dir,
        JIGGERED_TEST_BINARY: fixture,
        JIGGERED_TEST_PORT: "",
        JIGGERED_ARTIFACT_DIR: "",
      },
      timeout: 10000,
    }),
    (error) => error.code === 1 && /intentional scenario failure/.test(error.stderr),
  );
  assert.throws(() => process.kill(Number(fs.readFileSync(pid, "utf8")), 0), { code: "ESRCH" });
  assert.deepEqual(fs.readdirSync(dir).sort(), ["pid", "server.cjs"]);
});
