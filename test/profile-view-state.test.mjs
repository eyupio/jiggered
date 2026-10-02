import test from "node:test";
import assert from "node:assert/strict";
import { normaliseProfile } from "../web/profile.js";
import { MAX_AVATAR_LENGTH, normaliseAvatar } from "../web/avatar.js";
import { emergencyCall } from "../web/region.js";
import { createViewState } from "../web/view-state.js";

test("profile images reject remote, executable, malformed and oversized sources", () => {
  const png =
    "data:image/png;base64," + Buffer.from("\x89PNG\r\n\x1a\n", "latin1").toString("base64");
  assert.equal(normaliseAvatar(png), png);
  for (const source of [
    "https://example.com/photo.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,PHN2Zz4=",
    "data:image/png;base64,invalid!",
    png + "A".repeat(MAX_AVATAR_LENGTH),
    {},
    null,
  ])
    assert.equal(normaliseProfile({ avatar: source }).avatar, "");
});

test("emergency messages use explicit region and never infer UK from language or dates", () => {
  for (const [region, expected] of [
    ["GB", "999 or 112"],
    ["US", "911"],
    ["CA", "911"],
    ["EU", "112"],
    ["AU", "000"],
    ["NZ", "111"],
  ])
    assert.equal(emergencyCall(normaliseProfile({ region }).region), `Call ${expected}`);
  for (const value of [{}, { locale: "en-GB" }, { region: "unknown" }, { region: "other" }])
    assert.equal(emergencyCall(normaliseProfile(value).region), "Call your local emergency number");
});

test("view selections survive reload, isolate people and tolerate unavailable storage", () => {
  const data = new Map();
  const storage = {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i],
    getItem: (k) => data.get(k),
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
  const user = { id: 1, username: "alex" };
  createViewState(user, storage).set("history", { rangeMode: "7", filters: { query: "walk" } });
  assert.equal(createViewState(user, storage).get("history").rangeMode, "7");
  assert.deepEqual(createViewState({ id: 2, username: "sam" }, storage).get("history"), {});
  assert.equal(data.size, 0);
  storage.setItem("jiggered:view:1:alex", "bad JSON");
  assert.deepEqual(createViewState(user, storage).get("history"), {});
  const blocked = createViewState(user, {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
    removeItem() {
      throw Error("blocked");
    },
  });
  blocked.set("today", { day: "2026-10-01" });
  assert.equal(blocked.get("today").day, "2026-10-01");
  blocked.clear();
  assert.deepEqual(blocked.get("today"), {});
});
