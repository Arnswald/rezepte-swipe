#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────
// Übernahme des Obsidian-Kochbuchs in die Rezept-Datenbank (18.10.2026).
//
//   node tools/import-obsidian.mjs --ziel <DATA_DIR> [--quelle <Gerichte-Ordner>] [--trocken]
//
// Liest den Vault NUR (Markdown + Bilder), schreibt <DATA_DIR>/rezepte.db und kopiert die
// Bilder nach <DATA_DIR>/bilder (Dateinamen und Änderungszeit bleiben gleich).
// Bericht: <DATA_DIR>/import-bericht.json. Mehrfach aufrufbar (siehe src/lib/obsidianImport.ts).
// Braucht Node ≥ 23.6 (lädt die TypeScript-Module der App direkt, ohne tsx).
// ──────────────────────────────────────────────────────────────

import "./ts-laden.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const VAULT_GERICHTE = join(
  homedir(),
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/Arns Obsidian Vault/06 Research/Gerichte",
);

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const ziel = arg("ziel");
if (!ziel) {
  console.error("Aufruf: node tools/import-obsidian.mjs --ziel <DATA_DIR> [--quelle <Gerichte-Ordner>] [--trocken]");
  process.exit(2);
}
const dataDir = resolve(ziel);
const quelle = resolve(arg("quelle") ?? process.env.OBSIDIAN_RECIPES_PATH ?? VAULT_GERICHTE);
const trocken = args.includes("--trocken");

// recipes.ts liest die Pfade beim Laden → vor dem Import setzen
process.env.OBSIDIAN_RECIPES_PATH = quelle;
process.env.OBSIDIAN_IMAGES_PATH = join(quelle, "Bilder");
process.env.DATA_DIR = dataDir;

const { importiereObsidian } = await import("@/lib/obsidianImport");

mkdirSync(dataDir, { recursive: true });
const bericht = await importiereObsidian({
  dbFile: join(dataDir, "rezepte.db"),
  bilderDir: join(dataDir, "bilder"),
  trocken,
  log: (...a) => console.log(...a),
});
writeFileSync(join(dataDir, "import-bericht.json"), JSON.stringify(bericht, null, 2));

const mb = (bericht.bilder.gesamtBytes / 1e6).toFixed(1);
console.log(`Quelle:          ${bericht.quelle}`);
console.log(`Markdown:        ${bericht.markdownDateien} Dateien, ${bericht.fehler.length} Parser-Fehler`);
console.log(`Rezepte:         ${bericht.importiert} neu, ${bericht.aktualisiert} aktualisiert, ${bericht.uebersprungen.length} übersprungen`);
console.log(`In der DB:       ${bericht.dbZeilen.gesamt} (${bericht.dbZeilen.veroeffentlicht} veröffentlicht, ${bericht.dbZeilen.abgelehnt} abgelehnt)`);
console.log(`Bilder:          ${bericht.dbZeilen.bilder} Datensätze, ${bericht.bilder.kopiert} kopiert, ${bericht.bilder.schonDa} schon da, ${mb} MB`);
console.log(`Dubletten:       ${bericht.dublettenAbgelehnt.map((d) => `${d.slug} (wie ${d.wie})`).join(", ") || "keine"}`);
console.log(`Ohne Titelbild:  ${bericht.ohneTitelbild.map((d) => `${d.slug} [${d.profilbild ?? "-"}]`).join(", ") || "keine"}`);
console.log(`Unzugeordnet:    ${bericht.unzugeordnet.length} Bilddateien (→ bilder/_unzugeordnet)`);
console.log(`Mehrfach:        ${bericht.mehrfach.length}`);
console.log(`Dauer:           ${(bericht.dauerMs / 1000).toFixed(1)} s · Bericht: ${join(dataDir, "import-bericht.json")}`);
