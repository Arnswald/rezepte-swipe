// Freunde-Feed (/api/friends/feed): nur verbundene Freund:innen, nur Like/Superlike, neueste zuerst.
// Eigene Test-DB im Temp-Ordner, nie die echte DATA_DIR.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "rezepte-feed-test-"));
process.env.NODE_ENV = "test";

const r = {};
const db = {};
before(async () => {
  r.register = await import("../src/app/api/auth/register/route.ts");
  r.feed = await import("../src/app/api/friends/feed/route.ts");
  Object.assign(db, await import("../src/lib/db.ts"));
});

const post = (url, body, headers = {}) =>
  new Request(`http://t${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const tokenOf = (res) => decodeURIComponent((res.headers.get("set-cookie") ?? "").split(";")[0].replace(/^rezepte-session=/, ""));
const registerUser = async (username, password) => {
  const res = await r.register.POST(post("/api/auth/register", { username, password }));
  return { ...(await res.json()), token: tokenOf(res) };
};
const like = (g, name, slug, verdict, at) =>
  db.upsertVerdict({ guestId: g, name, slug, recipeName: slug.toUpperCase(), category: "Hauptgericht", verdict, now: at });

test("Feed zeigt nur verbundene Freund:innen, nur Likes/Superlikes, neueste zuerst, ohne guestIds", async () => {
  const me = await registerUser("Christian", "geheim1");
  const meli = await registerUser("Melissa", "geheim2");
  const tom = await registerUser("Tom", "geheim3");
  const fremd = await registerUser("Fremd", "geheim4");
  const now = new Date().toISOString();
  for (const g of [me, meli, tom, fremd]) db.ensureGuest(g.guestId, "", now);

  const meliCode = db.ensureGuest(meli.guestId, "", now).friend_code;
  const tomCode = db.ensureGuest(tom.guestId, "", now).friend_code;
  assert.equal(db.connectByCode(me.guestId, meliCode, now).ok, true);
  assert.equal(db.connectByCode(me.guestId, tomCode, now).ok, true);

  like(meli.guestId, "Melissa", "pasta", "like", "2026-11-05T10:00:00.000Z");
  like(meli.guestId, "Melissa", "kuchen", "super", "2026-11-07T08:00:00.000Z");
  like(meli.guestId, "Melissa", "suppe", "nope", "2026-11-07T09:00:00.000Z");
  like(tom.guestId, "Tom", "pizza", "like", "2026-11-06T12:00:00.000Z");
  like(fremd.guestId, "Fremd", "geheim-gericht", "super", "2026-11-07T10:00:00.000Z");
  like(me.guestId, "Christian", "eigenes", "like", "2026-11-07T11:00:00.000Z");

  const res = await r.feed.POST(post("/api/friends/feed", {}, { authorization: `Bearer ${me.token}` }));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual(d.items.map((i) => i.slug), ["kuchen", "pizza", "pasta"]);
  assert.equal(d.items[0].verdict, "super");
  assert.equal(d.items[0].friend.name, "Melissa");
  assert.deepEqual(d.friends.map((f) => f.name).sort(), ["Melissa", "Tom"]);
  const raw = JSON.stringify(d);
  for (const g of [meli, tom, fremd]) assert.ok(!raw.includes(g.guestId), "keine guestId anderer in der Antwort");
  assert.ok(!raw.includes("geheim-gericht"));
  assert.ok(!raw.includes("eigenes"));
});

test("Feed: ohne Verbindung leer, Limit greift, fremde guestId im Body wird abgewiesen", async () => {
  const solo = await registerUser("Solo", "geheim5");
  const other = await registerUser("Andere", "geheim6");
  const now = new Date().toISOString();
  db.ensureGuest(solo.guestId, "", now);
  const otherCode = db.ensureGuest(other.guestId, "", now).friend_code;

  const empty = await (await r.feed.POST(post("/api/friends/feed", {}, { authorization: `Bearer ${solo.token}` }))).json();
  assert.deepEqual(empty, { friends: [], items: [] });

  db.connectByCode(solo.guestId, otherCode, now);
  for (let i = 0; i < 5; i++) like(other.guestId, "Andere", `g${i}`, "like", `2026-11-0${i + 1}T10:00:00.000Z`);
  const lim = await (await r.feed.POST(post("/api/friends/feed", { limit: 2 }, { authorization: `Bearer ${solo.token}` }))).json();
  assert.deepEqual(lim.items.map((i) => i.slug), ["g4", "g3"]);

  // Body-guestId eines Kontos ohne passendes Token: 401, kein Feed
  const foreign = await r.feed.POST(post("/api/friends/feed", { guestId: solo.guestId }));
  assert.equal(foreign.status, 401);
  // Ohne alles: 400
  const none = await r.feed.POST(post("/api/friends/feed", {}));
  assert.equal(none.status, 400);
});
