// Sicherheitsreview 03.11.2026: Kontoübernahme, Löschen, fremde guestId, kaputtes Cookie, Token nur als Cookie, Origin.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "rezepte-sec-"));
process.env.NODE_ENV = "test";

const r = {}; const db = {}; const o = {};
const raw = () => new Database(join(process.env.DATA_DIR, "rezepte.db"));
before(async () => {
  r.register = await import("../src/app/api/auth/register/route.ts");
  r.login = await import("../src/app/api/auth/login/route.ts");
  r.me = await import("../src/app/api/me/route.ts");
  r.verdict = await import("../src/app/api/verdict/route.ts");
  r.cooked = await import("../src/app/api/cooked/route.ts");
  Object.assign(db, await import("../src/lib/db.ts"));
  Object.assign(o, await import("../src/lib/origin.ts"));
});
const post = (url, body, headers = {}) =>
  new Request(`http://t${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const del = (url, body, headers = {}) =>
  new Request(`http://t${url}`, { method: "DELETE", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const cookieOf = (res) => (res.headers.get("set-cookie") ?? "").split(";")[0];

test("HOCH 1: /api/me stellt für ein Passwort-Konto per Body-guestId kein Token aus", async () => {
  const opfer = await (await r.register.POST(post("/api/auth/register", { username: "Opfer1", password: "geheim" }))).json();
  // Konto ohne Sitzung simulieren (Altbestand): Sitzungen entfernen
  const res = await r.me.POST(post("/api/me", { guestId: opfer.guestId, name: "Angreifer" }));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal((await res.json()).token, undefined);
});

test("HOCH 1b: Konto ohne jede Sitzung (Altbestand) bekommt über /api/me ebenfalls kein Token", async () => {
  const opfer = await (await r.register.POST(post("/api/auth/register", { username: "Opfer1b", password: "geheim" }))).json();
  raw().prepare(`DELETE FROM sessions WHERE guest_id = ?`).run(opfer.guestId);
  const res = await r.me.POST(post("/api/me", { guestId: opfer.guestId, name: "Angreifer" }));
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(db.guestHasSession(opfer.guestId), false);
});

test("HOCH 1c: Gast mit Sitzung: zweites Gerät bekommt kein Token per guestId", async () => {
  const gid = "gast-mit-sitzung-1";
  await r.verdict.POST(post("/api/verdict", { guestId: gid, name: "G", slug: "a", verdict: "like" }));
  const me = await r.me.POST(post("/api/me", { guestId: gid, name: "G" }));
  assert.equal(me.status, 200);
  assert.match(cookieOf(me), /^rezepte-session=/);
  const row = raw().prepare(`SELECT via FROM sessions WHERE guest_id = ?`).get(gid);
  assert.equal(row.via, "migration");
  const fremd = await r.me.POST(post("/api/me", { guestId: gid, name: "Dieb" }));
  assert.equal(fremd.status, 401);
  assert.equal(fremd.headers.get("set-cookie"), null);
});

test("HOCH 2: DELETE /api/me nur mit Token, nie über Body-guestId", async () => {
  await r.verdict.POST(post("/api/verdict", { guestId: "gast-opfer-2", name: "O", slug: "y", verdict: "like" }));
  const res = await r.me.DELETE(del("/api/me", { guestId: "gast-opfer-2", confirm: true }));
  assert.equal(res.status, 401);
  assert.equal(db.getVerdictsForGuest("gast-opfer-2").y, "like");
  // Mit eigenem Token geht es, Body-guestId eines anderen wird ignoriert
  const a = await (await r.register.POST(post("/api/auth/register", { username: "Loescher", password: "geheim" }))).json();
  const reg = await r.register.POST(post("/api/auth/register", { username: "Loescher2", password: "geheim" }));
  const c = cookieOf(reg);
  const ok = await r.me.DELETE(del("/api/me", { guestId: a.guestId, password: "geheim", confirm: true }, { cookie: c }));
  assert.equal(ok.status, 200);
  assert.equal(db.hasAccount(a.guestId), true, "fremdes Konto bleibt");
});

test("HOCH 3: Schreibroute lehnt fremde Body-guestId ab, sobald der Gast eine Sitzung hat", async () => {
  const u = await (await r.register.POST(post("/api/auth/register", { username: "Opfer3", password: "geheim" }))).json();
  const v = await r.verdict.POST(post("/api/verdict", { guestId: u.guestId, name: "X", slug: "pasta", verdict: "dislike" }));
  assert.equal(v.status, 401);
  assert.deepEqual(db.getVerdictsForGuest(u.guestId), {});
  const c = await r.cooked.POST(post("/api/cooked", { guestId: u.guestId, name: "X", slug: "pasta" }));
  assert.equal(c.status, 401);
  // mit Token weiter möglich
  const reg = await r.register.POST(post("/api/auth/register", { username: "Opfer3b", password: "geheim" }));
  const ok = await r.verdict.POST(post("/api/verdict", { name: "X", slug: "pasta", verdict: "like" }, { cookie: cookieOf(reg) }));
  assert.equal(ok.status, 200);
  // Gast ohne Sitzung und Konto (Altgerät) funktioniert weiter
  const alt = await r.verdict.POST(post("/api/verdict", { guestId: "altgeraet-3", name: "A", slug: "s", verdict: "like" }));
  assert.equal(alt.status, 200);
});

test("MITTEL 4: kaputtes Cookie gibt keinen 500", async () => {
  const res = await r.me.POST(post("/api/me", { guestId: "g-cookie", name: "N" }, { cookie: "rezepte-session=%E0%A4%A" }));
  assert.notEqual(res.status, 500);
  assert.equal(res.status, 200);
});

test("MITTEL 5: Token steht nur im Cookie, nicht im JSON (login, register, me)", async () => {
  const reg = await r.register.POST(post("/api/auth/register", { username: "NurCookie", password: "geheim" }));
  assert.match(cookieOf(reg), /^rezepte-session=/);
  assert.equal((await reg.json()).token, undefined);
  const login = await r.login.POST(post("/api/auth/login", { username: "NurCookie", password: "geheim" }));
  assert.match(cookieOf(login), /^rezepte-session=/);
  assert.equal((await login.json()).token, undefined);
  const me = await r.me.POST(post("/api/me", { guestId: "alt-json-5", name: "A" }));
  assert.equal((await me.json()).token, undefined);
});

test("KLEIN 7: Origin-Prüfung", () => {
  const rq = (origin, host = "rezepte.christianarns.de") =>
    new Request("https://rezepte.christianarns.de/api/verdict", { method: "POST", headers: { ...(origin ? { origin } : {}), host } });
  assert.equal(o.originAllowed(rq(null)), true);
  assert.equal(o.originAllowed(rq("https://rezepte.christianarns.de")), true);
  assert.equal(o.originAllowed(rq("capacitor://localhost")), true);
  assert.equal(o.originAllowed(rq("https://boese.example")), false);
  assert.equal(o.originAllowed(rq("null")), false);
  assert.equal(o.originAllowed(rq("https://x.example"), "https://x.example"), true);
});
