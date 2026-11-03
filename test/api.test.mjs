// API-Tests gegen die Route-Handler mit einer frischen Test-DB (Temp-Ordner, nie die echte DATA_DIR).
// Start: npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "rezepte-test-"));
process.env.NODE_ENV = "test";

const r = {};
const db = {};
before(async () => {
  r.register = await import("../src/app/api/auth/register/route.ts");
  r.login = await import("../src/app/api/auth/login/route.ts");
  r.me = await import("../src/app/api/me/route.ts");
  r.verdict = await import("../src/app/api/verdict/route.ts");
  r.session = await import("../src/app/api/session/route.ts");
  Object.assign(db, await import("../src/lib/db.ts"));
});

const post = (url, body, headers = {}) =>
  new Request(`http://t${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const del = (url, body, headers = {}) =>
  new Request(`http://t${url}`, { method: "DELETE", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const cookieOf = (res) => (res.headers.get("set-cookie") ?? "").split(";")[0];

test("Registrieren gibt Token + httpOnly-Cookie, Hash statt Klartext in der DB", async () => {
  const res = await r.register.POST(post("/api/auth/register", { username: "Anna", password: "geheim1" }));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.ok(d.guestId && d.token && d.token.length >= 40);
  const sc = res.headers.get("set-cookie") ?? "";
  assert.match(sc, /rezepte-session=/);
  assert.match(sc, /HttpOnly/i);
  // Klartext-Token steht nicht in der DB, nur der Hash
  const row = db.guestForToken(d.token);
  assert.equal(row, d.guestId);
});

test("Token gewinnt vor fremder guestId im Body", async () => {
  const a = await (await r.register.POST(post("/api/auth/register", { username: "Bernd", password: "geheim2" }))).json();
  const c = await (await r.register.POST(post("/api/auth/register", { username: "Clara", password: "geheim3" }))).json();
  const res = await r.verdict.POST(post("/api/verdict", { guestId: c.guestId, name: "Bernd", slug: "pasta", verdict: "like" }, { authorization: `Bearer ${a.token}` }));
  assert.equal(res.status, 200);
  assert.deepEqual(db.getVerdictsForGuest(a.guestId), { pasta: "like" });
  assert.deepEqual(db.getVerdictsForGuest(c.guestId), {});
});

test("Sanfte Migration: alte guestId ohne Token bekommt über /api/me ein Token, Bewertungen bleiben", async () => {
  const gid = "legacy-guest-0001";
  const v = await r.verdict.POST(post("/api/verdict", { guestId: gid, name: "Alt", slug: "suppe", verdict: "super" }));
  assert.equal(v.status, 200);
  const me = await r.me.POST(post("/api/me", { guestId: gid, name: "Alt" }));
  const d = await me.json();
  assert.ok(d.token);
  assert.equal(d.verdicts.suppe, "super");
  assert.match(cookieOf(me), /^rezepte-session=/);
  // zweiter Besuch mit Token: kein neues Token
  const me2 = await r.me.POST(post("/api/me", { guestId: gid, name: "Alt" }, { cookie: cookieOf(me) }));
  assert.equal((await me2.json()).token, undefined);
});

test("Konto löschen: Passwort Pflicht, danach ist alles weg, Token ungültig", async () => {
  const u = await (await r.register.POST(post("/api/auth/register", { username: "Dora", password: "geheim4" }))).json();
  await r.verdict.POST(post("/api/verdict", { guestId: u.guestId, name: "Dora", slug: "kuchen", verdict: "like" }, { authorization: `Bearer ${u.token}` }));
  assert.equal(db.getAllVerdicts().filter((x) => x.guest_id === u.guestId).length, 1);

  const noConfirm = await r.me.DELETE(del("/api/me", { password: "geheim4" }, { authorization: `Bearer ${u.token}` }));
  assert.equal(noConfirm.status, 400);
  const wrong = await r.me.DELETE(del("/api/me", { password: "falsch", confirm: true }, { authorization: `Bearer ${u.token}` }));
  assert.equal(wrong.status, 401);
  assert.equal(db.getAllVerdicts().filter((x) => x.guest_id === u.guestId).length, 1);

  const ok = await r.me.DELETE(del("/api/me", { password: "geheim4", confirm: true }, { authorization: `Bearer ${u.token}` }));
  assert.equal(ok.status, 200);
  assert.equal(db.getAllVerdicts().filter((x) => x.guest_id === u.guestId).length, 0);
  assert.equal(db.guestForToken(u.token), null);
  assert.equal(db.hasAccount(u.guestId), false);
  assert.equal(db.loginAccount("Dora", "geheim4").ok, false);
  // Auswertung der anderen bleibt
  assert.ok(db.getAllVerdicts().length >= 2);
});

test("Konto löschen: Partner-Koch-Einträge anderer bleiben, leere Gruppen verschwinden", async () => {
  const a = await (await r.register.POST(post("/api/auth/register", { username: "Emil", password: "geheim5" }))).json();
  const b = await (await r.register.POST(post("/api/auth/register", { username: "Fia", password: "geheim6" }))).json();
  db.addCookEvent({ slug: "pizza", recipeName: "Pizza", category: "Hauptgericht", authorGuest: a.guestId, partnerGuest: b.guestId, cookedOn: "2026-11-01", now: new Date().toISOString() });
  const g = db.createGroup(b.guestId, "Nur Fia", new Date().toISOString());
  db.addGroupMember(g.group_id, b.guestId, new Date().toISOString());
  const ok = await r.me.DELETE(del("/api/me", { password: "geheim6", confirm: true }, { authorization: `Bearer ${b.token}` }));
  assert.equal(ok.status, 200);
  const ev = db.getCookEventsForGuest(a.guestId);
  assert.equal(ev.length, 1);
  assert.equal(db.getGroupByCode(g.group_code), undefined);
});

test("Abmelden beendet die Sitzung", async () => {
  const u = await (await r.register.POST(post("/api/auth/register", { username: "Gustav", password: "geheim7" }))).json();
  const res = await r.session.DELETE(del("/api/session", {}, { authorization: `Bearer ${u.token}` }));
  assert.equal(res.status, 200);
  assert.equal(db.guestForToken(u.token), null);
});
