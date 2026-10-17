#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────
// Vergleicht eine importierte Rezept-DB mit dem, was die Live-Seite heute ausliefert (18.10.2026).
//
//   node tools/vergleich-live.mjs --ziel <DATA_DIR> [--url https://rezepte.christianarns.de]
//
// Holt GET /api/recipes?lite=1 (öffentlich, nur lesend) und vergleicht Anzahl, Slugs, Namen und
// alle Felder der Lite-Liste mit storeList() aus der DB (Gast-Sicht: nur veröffentlichte).
// Abweichungen werden je Feld gezählt und mit Beispielen gezeigt. Schreibt nichts.
// ──────────────────────────────────────────────────────────────

import "./ts-laden.mjs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const dataDir = resolve(arg("ziel") ?? "./data");
const url = (arg("url") ?? "https://rezepte.christianarns.de").replace(/\/$/, "");
process.env.DATA_DIR = dataDir;

const { openRecipeStore } = await import("@/lib/recipeStore");
const store = openRecipeStore(join(dataDir, "rezepte.db"));
const db = store.list({ viewerGuestId: null });
store.close();

const res = await fetch(`${url}/api/recipes?lite=1`, { headers: { "cache-control": "no-cache" } });
if (!res.ok) { console.error(`Live antwortet ${res.status}`); process.exit(2); }
const live = (await res.json()).recipes;

const nfc = (s) => (typeof s === "string" ? s.normalize("NFC") : s);
const norm = (v) => JSON.stringify(v, (_k, x) => nfc(x));
const liveBy = new Map(live.map((r) => [nfc(r.slug), r]));
const dbBy = new Map(db.map((r) => [nfc(r.slug), r]));

console.log(`Anzahl: live ${live.length}, DB ${db.length} (veröffentlicht)`);
const nurLive = [...liveBy.keys()].filter((s) => !dbBy.has(s));
const nurDb = [...dbBy.keys()].filter((s) => !liveBy.has(s));
console.log(`Slugs nur live: ${nurLive.join(", ") || "keine"}`);
console.log(`Slugs nur DB:   ${nurDb.join(", ") || "keine"}`);
const reihenfolge = live.map((r) => nfc(r.slug)).join("|") === db.map((r) => nfc(r.slug)).join("|");
console.log(`Reihenfolge gleich: ${reihenfolge ? "ja" : "nein"}`);

// Alle Felder der Lite-Antwort außer dem Merker „lite“
const felder = [...new Set(live.flatMap((r) => Object.keys(r)))].filter((k) => k !== "lite");
const abw = {};
for (const [slug, l] of liveBy) {
  const d = dbBy.get(slug);
  if (!d) continue;
  for (const k of felder) {
    if (norm(l[k]) !== norm(d[k])) (abw[k] ??= []).push({ slug, live: l[k], db: d[k] });
  }
}
const gemeinsam = [...liveBy.keys()].filter((s) => dbBy.has(s)).length;
console.log(`\nFelder verglichen (${felder.length}): ${felder.join(", ")}`);
if (!Object.keys(abw).length) console.log(`Alle ${gemeinsam} gemeinsamen Rezepte in allen Feldern gleich.`);
for (const [k, list] of Object.entries(abw)) {
  console.log(`\n✗ ${k}: ${list.length} Abweichung(en)`);
  for (const a of list.slice(0, 5)) console.log(`   ${a.slug}: live ${JSON.stringify(a.live)} | DB ${JSON.stringify(a.db)}`);
}
process.exit(nurLive.length || nurDb.length ? 1 : 0);
