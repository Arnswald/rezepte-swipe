#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────
// Gegenprobe zum Import (18.10.2026):
//
//   node tools/pruefe-import.mjs --ziel <DATA_DIR> [--quelle <Gerichte-Ordner>] [--stichprobe 5]
//
//  1. Anzahl: Markdown-Dateien im Vault = Zeilen in der DB
//  2. Rundreise, alle Rezepte: DB → Recipe gleich parseRecipeFile() (gleicher Parser wie die App)
//  3. Stichprobe Feld für Feld gegen die ROHE Markdown-Datei (eigene, einfache Auswertung,
//     nicht der App-Parser — sonst prüft man den Parser mit sich selbst)
//  4. Bilder: jede Datei da, sha1 gleich Vault, jede Vault-Bilddatei zugeordnet oder abgelegt
//  5. Selbsttest der Sichtbarkeit (eingereicht / veröffentlicht) in einer Wegwerf-DB
// Liest Vault und DB nur.
// ──────────────────────────────────────────────────────────────

import "./ts-laden.mjs";
import { readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import matter from "gray-matter";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const dataDir = resolve(arg("ziel") ?? "./data");
const quelle = resolve(arg("quelle") ?? process.env.OBSIDIAN_RECIPES_PATH ??
  join(homedir(), "Library/Mobile Documents/iCloud~md~obsidian/Documents/Arns Obsidian Vault/06 Research/Gerichte"));
const n = Number(arg("stichprobe") ?? 5);
process.env.OBSIDIAN_RECIPES_PATH = quelle;
process.env.OBSIDIAN_IMAGES_PATH = join(quelle, "Bilder");
process.env.DATA_DIR = dataDir;

const { parseRecipeFile } = await import("@/lib/recipes");
const { openRecipeStore } = await import("@/lib/recipeStore");
const { bilderVon, bildKey } = await import("@/lib/obsidianImport");

const sha1 = (b) => createHash("sha1").update(b).digest("hex");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let probleme = 0;
const melde = (...a) => { probleme++; console.log("  ✗", ...a); };

const store = openRecipeStore(join(dataDir, "rezepte.db"));
const alle = store.list({ status: "alle" });
const bySlug = new Map(alle.map((r) => [r.slug, r]));
const md = readdirSync(quelle).filter((f) => f.endsWith(".md"));

// 1) Anzahl
console.log(`1) Anzahl: ${md.length} Markdown-Dateien, ${alle.length} in der DB ` +
  `(${alle.filter((r) => r.status === "veroeffentlicht").length} veröffentlicht)`);
if (md.length !== alle.length) melde("Anzahl weicht ab");

// 2) Rundreise
let rundOk = 0;
const FELDER = ["name", "description", "category", "kcal", "protein", "carbs", "fat", "image", "imageIsAi", "imageExists",
  "imageFocus", "created", "source", "totalTime", "portions", "difficulty", "ingredients", "steps", "tips", "tags"];
for (const f of md) {
  const p = parseRecipeFile(join(quelle, f), join(quelle, "Bilder"));
  const d = bySlug.get(p.slug);
  if (!d) { melde(`fehlt in DB: ${p.slug}`); continue; }
  // image per bildKey: auf macOS gibt der Parser den Frontmatter-Namen zurück („Protein-Pancakes.png“),
  // im Linux-Container den echten Dateinamen — die DB speichert den echten.
  const erwartet = { ...p, image: p.image && bildKey(p.image), images: bilderVon(p).map((b) => bildKey(b.datei)) };
  const ist = { ...d, image: d.image && bildKey(d.image), images: d.images.map(bildKey) };
  const diff = [...FELDER, "images"].filter((k) => !eq(erwartet[k], ist[k]));
  if (diff.length) melde(`${p.slug}: ${diff.join(", ")}`);
  else rundOk++;
}
console.log(`2) Rundreise: ${rundOk}/${md.length} Rezepte in allen ${FELDER.length + 1} Feldern gleich`);

// 3) Stichprobe gegen rohes Markdown
const section = (body, needle) => {
  const out = []; let on = false;
  for (const l of body.split("\n")) {
    if (l.startsWith("## ")) { if (on) break; on = l.includes(needle); continue; }
    if (on) out.push(l);
  }
  return out;
};
const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
// Feste Stichprobe über den Slug-Hash, damit ein zweiter Lauf dieselben prüft; plus das Sonderzeichen-Rezept
const sorted = [...md].sort((a, b) => sha1(a).localeCompare(sha1(b)));
const probe = [...new Set([...sorted.slice(0, n - 1), md.find((f) => /[^\x20-\x7e]/.test(f)) ?? sorted[n - 1]])];
console.log(`3) Stichprobe gegen die Markdown-Datei: ${probe.map((f) => f.replace(/\.md$/, "")).join(", ")}`);
for (const f of probe) {
  const raw = readFileSync(join(quelle, f), "utf-8");
  const { data: fm, content } = matter(raw);
  const r = bySlug.get(f.replace(/\.md$/, ""));
  const zeilen = [];
  const check = (feld, soll, ist) => {
    const ok = eq(soll, ist);
    zeilen.push(`${ok ? "✓" : "✗"} ${feld}`);
    if (!ok) melde(`${r.slug} ${feld}: Markdown ${JSON.stringify(soll)} ≠ DB ${JSON.stringify(ist)}`);
  };
  check("name", String(fm.name), r.name);
  check("Kurzbeschreibung", String(fm.Kurzbeschreibung ?? ""), r.description);
  check("kategorie", String(fm.kategorie), r.category);
  check("kalorien", num(fm.kalorien), r.kcal);
  check("protein", num(fm.protein), r.protein);
  check("kohlenhydrate", num(fm.kohlenhydrate), r.carbs);
  check("fette", num(fm.fette), r.fat);
  const titel = store.images(r.id).find((i) => i.rolle === "titel");
  check("Profilbild", bildKey(String(fm.Profilbild)), titel && bildKey(titel.datei));
  check("erstellt", fm.erstellt instanceof Date ? fm.erstellt.toISOString().slice(0, 10) : String(fm.erstellt), r.created);
  check("quelle", fm.quelle ? String(fm.quelle) : null, r.source);
  const ueber = section(content, "Überblick").join("\n");
  for (const [feld, wert] of [["Gesamtzeit", r.totalTime], ["Portionen", r.portions], ["Schwierigkeit", r.difficulty]]) {
    check(`Überblick ${feld}`, true, wert != null && ueber.includes(feld) && ueber.includes(wert));
  }
  const zutatZeilen = section(content, "Zutaten").filter((l) => /^\s*[-*]\s+/.test(l)).length;
  check("Anzahl Zutaten", zutatZeilen, r.ingredients.reduce((s, g) => s + g.items.length, 0));
  const schrittZeilen = section(content, "Zubereitung").filter((l) => /^\s*\d+\.\s+\S/.test(l));
  check("Anzahl Schritte", schrittZeilen.length, r.steps.length);
  check("Schritttexte wörtlich im Markdown", true, r.steps.every((s) => raw.includes(s)));
  check("Zutatentexte wörtlich im Markdown", true, r.ingredients.every((g) => g.items.every((i) => raw.includes(i))));
  check("Tipps vorhanden", section(content, "Tipps").some((l) => /^\s*[-*]\s+/.test(l)), r.tips.length > 0);
  console.log(`   ${r.slug}: ${zeilen.filter((z) => z.startsWith("✓")).length}/${zeilen.length} Felder ok`);
}

// 4) Bilder
const bilderDir = join(dataDir, "bilder");
const vaultBilder = readdirSync(join(quelle, "Bilder")).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
const vaultBySha = new Map();
for (const f of vaultBilder) vaultBySha.set(bildKey(f), sha1(readFileSync(join(quelle, "Bilder", f))));
const rows = store.db.prepare(`SELECT datei, sha1, rolle FROM recipe_images`).all();
let bildOk = 0;
for (const row of rows) {
  const p = join(bilderDir, row.datei);
  if (!existsSync(p)) { melde(`Bild fehlt: ${row.datei}`); continue; }
  const s = sha1(readFileSync(p));
  if (s !== row.sha1 || s !== vaultBySha.get(bildKey(row.datei))) { melde(`sha1 weicht ab: ${row.datei}`); continue; }
  bildOk++;
}
const zugeordnet = new Set(rows.map((r) => bildKey(r.datei)));
const abgelegt = existsSync(join(bilderDir, "_unzugeordnet")) ? readdirSync(join(bilderDir, "_unzugeordnet")).map(bildKey) : [];
const verloren = vaultBilder.filter((f) => !zugeordnet.has(bildKey(f)) && !abgelegt.includes(bildKey(f)));
console.log(`4) Bilder: ${bildOk}/${rows.length} Datensätze mit Datei und gleicher Prüfsumme wie im Vault; ` +
  `Vault ${vaultBilder.length} Dateien = ${zugeordnet.size} zugeordnet + ${abgelegt.length} in _unzugeordnet` +
  (verloren.length ? `, ${verloren.length} VERLOREN: ${verloren.join(", ")}` : ", nichts verloren"));
if (verloren.length) probleme++;
const rollen = store.db.prepare(`SELECT rolle, COUNT(*) n FROM recipe_images GROUP BY rolle`).all();
console.log(`   Rollen: ${rollen.map((r) => `${r.rolle} ${r.n}`).join(", ")}`);
store.close();

// 5) Selbsttest Sichtbarkeit (Wegwerf-DB)
const tmp = join(tmpdir(), `rezepte-selbsttest-${process.pid}.db`);
const t = openRecipeStore(tmp);
try {
  t.insert({ slug: "eigenes", name: "Eigenes", status: "veroeffentlicht", origin: "admin" });
  t.insert({ slug: "von-anna", name: "Von Anna", status: "eingereicht", origin: "link", submittedBy: "gast-anna",
    ingredients: [{ group: "", items: ["1 Ei"] }], steps: ["a", "b"] },
  [{ rolle: "titel", datei: "von-anna.jpg" }, { rolle: "ki", datei: "von-anna_KI.jpg" }]);
  const sicht = (g) => t.list({ viewerGuestId: g }).map((r) => r.slug).join(",");
  const a = sicht("gast-anna"), b = sicht("gast-ben"), o = sicht(null);
  t.setStatus("von-anna", "veroeffentlicht");
  const b2 = sicht("gast-ben");
  t.update("von-anna", { name: "Annas Ei", imageFocus: [50, 70] });
  const g = t.get("von-anna", { viewerGuestId: "gast-ben" });
  t.setStatus("von-anna", "abgelehnt", { reason: "Test" });
  const a3 = sicht("gast-anna");
  const ok = a === "eigenes,von-anna" && b === "eigenes" && o === "eigenes" && b2.includes("von-anna") &&
    g?.name === "Annas Ei" && eq(g?.imageFocus, [50, 70]) && g?.image === "von-anna.jpg" && a3 === "eigenes";
  console.log(`5) Sichtbarkeit: Anna sieht [${a}], Ben [${b}], ohne Login [${o}], nach Freigabe Ben [${b2}], ` +
    `nach Ablehnung Anna [${a3}] → ${ok ? "ok" : "FALSCH"}`);
  if (!ok) probleme++;
} finally {
  t.close();
  rmSync(tmp, { force: true }); rmSync(`${tmp}-wal`, { force: true }); rmSync(`${tmp}-shm`, { force: true });
}

console.log(probleme ? `\n${probleme} Problem(e).` : "\nAlles gleich.");
process.exit(probleme ? 1 : 0);
