import test from "node:test";
import assert from "node:assert/strict";
import {
  esc,
  html,
  raw,
  ago,
  describeUA,
  fmtBytes,
  uid,
  fmtDay,
  fmtWhen,
  api,
  signed,
} from "../web/util.js";

test("signed reads a cost as spending, recovery or nothing", () => {
  assert.equal(signed(3), "−3");
  assert.equal(signed(-2), "+2");
  assert.equal(signed(0), "0");
  // Callers negate a recovery total to print it as +n; negating zero must not print "+0" or "−0".
  assert.equal(signed(-0), "0");
});

test("api returns transport failures when response bodies are interrupted", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    status: 200,
    ok: true,
    text: async () => {
      throw new TypeError("terminated body");
    },
  }));
  const result = await api("GET", "/api/me/security");
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.equal(result.data, null);
  assert.match(result.error, /connection/);
});

test("api preserves server errors and tolerates non-JSON responses", async (t) => {
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response('{"error":"Try again"}', { status: 503 }),
  );
  assert.equal((await api("GET", "/api/me/security")).error, "Try again");
  fetch.mock.mockImplementation(async () => new Response("Bad gateway", { status: 502 }));
  assert.deepEqual(await api("GET", "/api/me/security"), {
    ok: false,
    status: 502,
    data: null,
    error: "Something went wrong (502).",
  });
});

test("html escapes whatever is interpolated", () => {
  const evil = `<img src=x onerror="alert('hi')">&`;
  assert.equal(
    html`<p>${evil}</p>`.s,
    "<p>&lt;img src=x onerror=&quot;alert(&#39;hi&#39;)&quot;&gt;&amp;</p>",
  );
  assert.equal(
    html`<a title="${evil}">x</a>`.s.includes("<img"),
    false,
    "attribute values are escaped too",
  );
  assert.equal(
    html`${1}${0}${null}${undefined}${false}${true}`.s,
    "10true",
    "numbers print, null/undefined/false vanish",
  );
});

test("html passes nested html and arrays through, but not strings that merely look like markup", () => {
  const inner = html`<b>${"<x>"}</b>`;
  assert.equal(html`<p>${inner}</p>`.s, "<p><b>&lt;x&gt;</b></p>");
  assert.equal(
    html`<ul>${["a", "<b>"].map((x) => html`<li>${x}</li>`)}</ul>`.s,
    "<ul><li>a</li><li>&lt;b&gt;</li></ul>",
  );
  assert.equal(html`${"<b>safe?</b>"}`.s, "&lt;b&gt;safe?&lt;/b&gt;");
  assert.equal(html`${raw("<b>yes</b>")}`.s, "<b>yes</b>");
  assert.equal(html`${[]}`.s, "");
  assert.equal(esc(`a&b<c>"d"'e'`), "a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;");
});

test("ago", () => {
  const now = 1_800_000_000_000;
  const at = (s) => now / 1000 - s;
  assert.equal(ago(at(5), now), "just now");
  assert.equal(ago(at(60), now), "1 minute ago");
  assert.equal(ago(at(150), now), "2 minutes ago");
  assert.equal(ago(at(3600), now), "1 hour ago");
  assert.equal(ago(at(7300), now), "2 hours ago");
  assert.equal(ago(at(86400 * 3), now), "3 days ago");
  assert.equal(
    ago(at(-100), now),
    "just now",
    "a clock slightly ahead of ours is not 'in the future'",
  );
});

test("describeUA", () => {
  const cases = {
    "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0": "Firefox on Linux",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36":
      "Chrome on Windows",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0":
      "Edge on Windows",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1":
      "Safari on iOS",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/129.0.0.0 Mobile/15E148 Safari/604.1":
      "Chrome on iOS",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0.0.0 Mobile Safari/537.36":
      "Chrome on Android",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15":
      "Safari on macOS",
    "curl/8.5.0": "Unknown device",
    "": "Unknown device",
  };
  for (const [ua, want] of Object.entries(cases)) assert.equal(describeUA(ua), want, ua);
  assert.equal(describeUA(), "Unknown device");
});

test("fmtBytes, uid, and date formatting", () => {
  assert.equal(fmtBytes(0), "0 B");
  assert.equal(fmtBytes(1023), "1023 B");
  assert.equal(fmtBytes(1536), "1.5 KB");
  assert.equal(fmtBytes(5 * 1048576), "5.0 MB");
  const ids = new Set(Array.from({ length: 1000 }, uid));
  assert.equal(ids.size, 1000);
  assert.match(fmtDay("2026-10-01", "en-GB"), /Thu/);
  assert.equal(fmtWhen("garbage", "en-GB"), "garbage");
  assert.match(fmtWhen("2026-10-01T09:05", "en-GB"), /1 Oct 2026, 09:05/);
});
