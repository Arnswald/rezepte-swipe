// Eigene Rezepte (/api/eigene, 07.11.2026): wer sieht was, wer darf ändern, nichts wird öffentlich.
// Eigene Test-DB im Temp-Ordner, nie die echte DATA_DIR.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "rezepte-eigene-test-"));
process.env.NODE_ENV = "test";
process.env.RECIPE_SOURCE = "db";

const r = {};
const db = {};
const lib = {};
before(async () => {
  r.register = await import("../src/app/api/auth/register/route.ts");
  r.eigene = await import("../src/app/api/eigene/route.ts");
  r.recipes = await import("../src/app/api/recipes/route.ts");
  r.trending = await import("../src/app/api/recipes/trending/route.ts");
  r.einreichungen = await import("../src/app/api/einreichungen/route.ts");
  Object.assign(db, await import("../src/lib/db.ts"));
  Object.assign(lib, await import("../src/lib/eigeneRezepte.ts"));
});

const post = (url, body, headers = {}) =>
  new Request(`http://t${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const tokenOf = (res) => decodeURIComponent((res.headers.get("set-cookie") ?? "").split(";")[0].replace(/^rezepte-session=/, ""));
const registerUser = async (username, password) => {
  const res = await r.register.POST(post("/api/auth/register", { username, password }));
  return { ...(await res.json()), token: tokenOf(res) };
};
const auth = (u) => ({ authorization: `Bearer ${u.token}` });
const save = (u, fields) => {
  const fd = new FormData();
  fd.append("guestId", u.guestId);
  fd.append("name", u.name ?? "");
  for (const [k, v] of Object.entries(fields)) fd.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
  return r.eigene.POST(new Request("http://t/api/eigene", { method: "POST", headers: auth(u), body: fd }));
};
const list = async (u) => (await (await r.eigene.POST(post("/api/eigene", { action: "list", guestId: u.guestId }, auth(u)))).json()).eigene;

test("Eigenes Rezept: anlegen, nur ich und Verbundene sehen es, nie öffentlich", async () => {
  const anna = await registerUser("Anna", "geheim1");
  const ben = await registerUser("Ben", "geheim2");
  const now = new Date().toISOString();
  db.ensureGuest(anna.guestId, "Anna", now);
  db.ensureGuest(ben.guestId, "Ben", now);

  const res = await save(anna, {
    title: "Omas Linsensuppe", category: "Hauptgericht", totalTime: "45 Min", portions: "4",
    ingredients: ["200 g Linsen", "1 Zwiebel", ""], steps: ["1. Zwiebel anschwitzen", "Linsen dazu, 30 Min köcheln"],
  });
  assert.equal(res.status, 200);
  const { rezept } = await res.json();
  assert.equal(rezept.name, "Omas Linsensuppe");
  assert.equal(rezept.own.mine, true);
  assert.deepEqual(rezept.ingredients, [{ group: "", items: ["200 g Linsen", "1 Zwiebel"] }]);
  assert.deepEqual(rezept.steps, ["Zwiebel anschwitzen", "Linsen dazu, 30 Min köcheln"]);
  assert.equal(rezept.portions, "4");

  assert.deepEqual((await list(anna)).map((x) => x.slug), [rezept.slug]);
  assert.deepEqual(await list(ben), []);

  // öffentlich: nicht in der Liste, Detail 404, kein Trending-Zähler, keine „Einreichung“
  const pub = await (await r.recipes.GET(new Request("http://t/api/recipes?lite=1"))).json();
  assert.equal(pub.recipes.some((x) => x.slug === rezept.slug), false);
  assert.equal((await r.recipes.GET(new Request(`http://t/api/recipes?slug=${rezept.slug}`))).status, 404);
  db.upsertVerdict({ guestId: anna.guestId, name: "Anna", slug: rezept.slug, recipeName: rezept.name, category: "Hauptgericht", verdict: "like", now });
  const tr = await (await r.trending.GET()).json();
  assert.equal(rezept.slug in tr.counts, false);
  const ein = await (await r.einreichungen.POST(post("/api/einreichungen", { guestId: anna.guestId }, auth(anna)))).json();
  assert.deepEqual(ein.einreichungen, []);

  // „Zu zweit“: nach dem Verbinden sieht Ben es, aber nicht als seins
  const code = db.ensureGuest(anna.guestId, "Anna", now).friend_code;
  assert.equal(db.connectByCode(ben.guestId, code, now).ok, true);
  const benSieht = await list(ben);
  assert.equal(benSieht.length, 1);
  assert.equal(benSieht[0].own.mine, false);
  assert.equal(benSieht[0].own.ownerName, "Anna");

  // Ben darf weder ändern noch ausblenden
  const fremd = await save(ben, { slug: rezept.slug, title: "Gekapert", ingredients: ["x"] });
  assert.equal(fremd.status, 403);
  const fremdHide = await r.eigene.POST(post("/api/eigene", { action: "hide", guestId: ben.guestId, slug: rezept.slug }, auth(ben)));
  assert.equal(fremdHide.status, 403);

  // Anna bearbeitet: gleicher Slug, neuer Inhalt
  const edit = await save(anna, { slug: rezept.slug, title: "Omas Linsensuppe mit Speck", ingredients: ["200 g Linsen", "100 g Speck"], steps: ["Kochen"] });
  assert.equal(edit.status, 200);
  const neu = (await edit.json()).rezept;
  assert.equal(neu.slug, rezept.slug);
  assert.equal(neu.name, "Omas Linsensuppe mit Speck");
  assert.ok(neu.tags.includes("schwein"));

  // Ausblenden statt löschen: für beide weg, Zeile bleibt in der DB
  const hide = await r.eigene.POST(post("/api/eigene", { action: "hide", guestId: anna.guestId, slug: rezept.slug }, auth(anna)));
  assert.equal(hide.status, 200);
  assert.deepEqual(await list(anna), []);
  assert.deepEqual(await list(ben), []);
  const { recipeStore } = await import("../src/lib/recipeStore.ts");
  const row = recipeStore().getRow(rezept.slug);
  assert.ok(row && row.ausgeblendet_am && row.privat === 1);
});

test("Ohne Anmeldung oder ohne Titel: abgelehnt", async () => {
  const fd = new FormData();
  fd.append("title", "Test");
  fd.append("ingredients", JSON.stringify(["a"]));
  const res = await r.eigene.POST(new Request("http://t/api/eigene", { method: "POST", body: fd }));
  assert.equal(res.status, 401);
  const u = await registerUser("Carla", "geheim3");
  assert.equal((await save(u, { title: "", ingredients: ["a"] })).status, 400);
  assert.equal((await save(u, { title: "Nur Titel" })).status, 400);
});

test("Aus Text einfügen: Überschriften, Aufzählungen, Zeit und Portionen", () => {
  const v = lib.rezeptAusText(`Schnelle Tomatensuppe
Für 2 Portionen, fertig in 20 Minuten.

Zutaten:
- 500 g Tomaten
- 1 Zwiebel
• Salz

Zubereitung:
1. Zwiebel würfeln und anbraten.
2. Tomaten dazu und 15 Min köcheln.
`);
  assert.equal(v.name, "Schnelle Tomatensuppe");
  assert.deepEqual(v.ingredients, ["500 g Tomaten", "1 Zwiebel", "Salz"]);
  assert.deepEqual(v.steps, ["Zwiebel würfeln und anbraten.", "Tomaten dazu und 15 Min köcheln."]);
  assert.equal(v.portions, "2");
  assert.equal(v.totalTime, "20 Min");
});

test("Aus Link: schema.org-Rezept aus JSON-LD", () => {
  const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},
    {"@type":"Recipe","name":"Käsespätzle","description":"Klassiker","recipeYield":"4 Portionen","totalTime":"PT1H15M",
     "recipeCategory":"Hauptgericht","image":["https://example.org/a.jpg"],
     "recipeIngredient":["400 g Mehl","4 Eier","200 g Bergkäse"],
     "recipeInstructions":[{"@type":"HowToStep","text":"Teig rühren."},{"@type":"HowToSection","itemListElement":[{"@type":"HowToStep","text":"Spätzle schaben."}]}]}]}</script></head></html>`;
  const v = lib.rezeptAusHtml(html, "https://example.org/kaesespaetzle");
  assert.equal(v.name, "Käsespätzle");
  assert.equal(v.portions, "4");
  assert.equal(v.totalTime, "1 Std 15 Min");
  assert.deepEqual(v.ingredients, ["400 g Mehl", "4 Eier", "200 g Bergkäse"]);
  assert.deepEqual(v.steps, ["Teig rühren.", "Spätzle schaben."]);
  assert.equal(v.imageUrl, "https://example.org/a.jpg");
  assert.equal(v.category, "Hauptgericht");
});

test("Link laden: keine Adressen im eigenen Netz", async () => {
  for (const u of ["http://127.0.0.1/", "http://192.168.2.201:9000/", "http://10.0.0.1/", "http://localhost/", "file:///etc/passwd", "http://[::1]/"]) {
    await assert.rejects(lib.sicherLaden(u, 1000), `${u} hätte abgelehnt werden müssen`);
  }
});
