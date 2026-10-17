/**
 * Einmalige Übernahme des Obsidian-Kochbuchs in die Rezept-Datenbank (Entwurf, 18.10.2026).
 * NOCH NIRGENDS IN DER APP IMPORTIERT.
 *
 * Zwei Aufrufer:
 *  - tools/import-obsidian.mjs (lokaler Probelauf auf dem Mac, Ziel per Argument)
 *  - später eine Admin-Route im Container (liest den noch vorhandenen RO-Mount /app/recipes,
 *    schreibt in DATA_DIR/rezepte.db + DATA_DIR/bilder). So muss keine DB-Datei auf den
 *    Server kopiert werden, und der Import läuft dort, wo die App die Daten braucht.
 *
 * Der Parser ist der aus recipes.ts (parseRecipeFile, galleryImages, sourceKey) — nicht kopiert.
 * Damit übernimmt der Import automatisch jede Änderung am Parser. recipes.ts liest die
 * Ordner aus OBSIDIAN_RECIPES_PATH / OBSIDIAN_IMAGES_PATH, die müssen vor dem ersten
 * Import dieses Moduls gesetzt sein.
 *
 * Der Vault wird nur GELESEN (readFileSync, readdirSync, copyFileSync als Quelle).
 *
 * Idempotent: ein zweiter Lauf legt nichts doppelt an. Bestehende Slugs werden nur
 * überschrieben, wenn sie aus Obsidian stammen UND in der App seitdem nicht geändert wurden
 * (geaendert_am = erstellt_am). So kann man während der Parallelphase neue Vault-Rezepte
 * nachziehen, ohne App-Änderungen zu verlieren.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, statSync, copyFileSync, utimesSync, constants } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import sharp from "sharp";
import matter from "gray-matter";
import { parseRecipeFile, sourceKey, recipesDir, obsidianImagesDir, resolveImageFile, type Recipe } from "@/lib/recipes";
import { openRecipeStore, type ImageInput, type ImageRole, type RecipeStore } from "@/lib/recipeStore";
import { erkennePlattform, quelleKey } from "@/lib/submission";

export interface ImportOptions {
  /** Ziel-DB (Datei). */
  dbFile: string;
  /** Ziel-Bilderordner (DATA_DIR/bilder). */
  bilderDir: string;
  /** Nur zählen, nichts schreiben. */
  trocken?: boolean;
  log?: (...a: unknown[]) => void;
}

export interface ImportBericht {
  quelle: string;
  bilderQuelle: string;
  markdownDateien: number;
  importiert: number;
  aktualisiert: number;
  uebersprungen: { slug: string; grund: string }[];
  fehler: { datei: string; grund: string }[];
  dublettenAbgelehnt: { slug: string; wie: string }[];
  ohneTitelbild: { slug: string; profilbild: string | null }[];
  bilder: { kopiert: number; schonDa: number; gesamtBytes: number; zugeordnet: number };
  /** Bilddateien im Vault, die zu keinem Rezept gehören — werden nach bilder/_unzugeordnet kopiert */
  unzugeordnet: string[];
  /** Bilddateien, die mehreren Rezepten zugeordnet sind */
  mehrfach: { datei: string; slugs: string[] }[];
  dbZeilen: { gesamt: number; veroeffentlicht: number; abgelehnt: number; bilder: number };
  dauerMs: number;
}

/** Rolle aus dem Dateinamen (Vault-Konvention, siehe Kochbuch-Struktur.md). */
export function rolleAusDatei(datei: string, titel: string | null): ImageRole {
  if (titel && bildKey(datei) === bildKey(titel)) return "titel";
  const base = datei.replace(/\.(jpe?g|png|webp)$/i, "").toLowerCase();
  if (base.endsWith("_ki")) return "ki";
  if (/_selbst(-\d+)?$/.test(base)) return "selbst";
  if (base.endsWith("_original")) return "original";
  return "galerie";
}

/** Vergleichsform eines Dateinamens: NFC + klein. macOS liefert Umlaute aus readdir als NFD
 *  („Pfirsich Hähnchen.png“), das Frontmatter als NFC; ohne das stand dasselbe Bild doppelt
 *  in der Galerie. Gespeichert wird immer der NFC-Name. */
export const bildKey = (datei: string) => datei.normalize("NFC").toLowerCase();

/** Bilder eines Rezepts: entdoppelt (NFC), Reihenfolge wie galleryImages(). */
export function bilderVon(r: Recipe): { quelle: string; datei: string }[] {
  const seen = new Set<string>();
  const out: { quelle: string; datei: string }[] = [];
  for (const b of r.images) {
    const k = bildKey(b);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ quelle: b, datei: b.normalize("NFC") });
  }
  return out;
}

const sha1 = (buf: Buffer) => createHash("sha1").update(buf).digest("hex");

async function bildInfo(file: string): Promise<{ breite: number | null; hoehe: number | null; bytes: number; sha1: string }> {
  const buf = readFileSync(file);
  let breite: number | null = null;
  let hoehe: number | null = null;
  try {
    const m = await sharp(buf).metadata();
    breite = m.width ?? null;
    hoehe = m.height ?? null;
    // EXIF-Drehung 5–8: Breite/Höhe wie angezeigt
    if (m.orientation && m.orientation >= 5 && breite && hoehe) [breite, hoehe] = [hoehe, breite];
  } catch {
    /* kein lesbares Bild: Maße bleiben leer */
  }
  return { breite, hoehe, bytes: buf.length, sha1: sha1(buf) };
}

/** Kopiert eine Datei, wenn sie am Ziel fehlt oder abweicht. Behält die Änderungszeit
 *  (der Fokus-Cache in DATA_DIR/image-cache/focus-v1.json hängt an Größe + mtime). */
function kopiere(src: string, dst: string, srcSha: string): "kopiert" | "schonDa" {
  if (existsSync(dst)) {
    const d = statSync(dst);
    const s = statSync(src);
    if (d.size === s.size && sha1(readFileSync(dst)) === srcSha) return "schonDa";
  }
  // FICLONE: auf APFS (Mac) eine Klon-Kopie ohne zusätzlichen Platz, sonst normale Kopie
  copyFileSync(src, dst, constants.COPYFILE_FICLONE);
  const s = statSync(src);
  utimesSync(dst, s.atime, s.mtime);
  return "kopiert";
}

export async function importiereObsidian(opts: ImportOptions): Promise<ImportBericht> {
  const t0 = Date.now();
  const log = opts.log ?? (() => {});
  const rDir = recipesDir();
  const iDir = obsidianImagesDir();
  if (!rDir || !existsSync(rDir)) throw new Error(`Rezept-Ordner nicht gefunden: ${rDir}`);
  if (!iDir || !existsSync(iDir)) throw new Error(`Bilder-Ordner nicht gefunden: ${iDir}`);

  const bericht: ImportBericht = {
    quelle: rDir,
    bilderQuelle: iDir,
    markdownDateien: 0,
    importiert: 0,
    aktualisiert: 0,
    uebersprungen: [],
    fehler: [],
    dublettenAbgelehnt: [],
    ohneTitelbild: [],
    bilder: { kopiert: 0, schonDa: 0, gesamtBytes: 0, zugeordnet: 0 },
    unzugeordnet: [],
    mehrfach: [],
    dbZeilen: { gesamt: 0, veroeffentlicht: 0, abgelehnt: 0, bilder: 0 },
    dauerMs: 0,
  };

  // 1) Parsen — exakt wie scanRecipes(), aber ohne das Ausblenden der Dubletten
  const dateien = readdirSync(rDir).filter((f) => f.endsWith(".md"));
  bericht.markdownDateien = dateien.length;
  const geparst: { datei: string; raw: string; r: Recipe }[] = [];
  for (const datei of dateien) {
    const r = parseRecipeFile(join(rDir, datei), iDir);
    if (!r) {
      bericht.fehler.push({ datei, grund: "Parser lieferte null" });
      continue;
    }
    geparst.push({ datei, raw: readFileSync(join(rDir, datei), "utf-8"), r });
  }
  geparst.sort((a, b) => b.r.created.localeCompare(a.r.created) || a.r.slug.localeCompare(b.r.slug));

  // Wie scanRecipes: gleiche Quelle → nur das erste (neueste) zeigen, die anderen „abgelehnt“
  const gesehen = new Map<string, string>();
  const dublette = new Map<string, string>();
  for (const { r } of geparst) {
    const key = sourceKey(r.source);
    if (!key) continue;
    const erstes = gesehen.get(key);
    if (erstes) dublette.set(r.slug, erstes);
    else gesehen.set(key, r.slug);
  }

  // 2) Bilder: Zuordnung prüfen
  const alleBilder = readdirSync(iDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  const zuordnung = new Map<string, string[]>(); // datei (klein) → slugs
  for (const { r } of geparst) {
    for (const { datei } of bilderVon(r)) {
      const k = bildKey(datei);
      zuordnung.set(k, [...(zuordnung.get(k) ?? []), r.slug]);
    }
  }
  bericht.unzugeordnet = alleBilder.filter((f) => !zuordnung.has(bildKey(f))).sort();
  bericht.mehrfach = [...zuordnung.entries()].filter(([, s]) => s.length > 1).map(([datei, slugs]) => ({ datei, slugs }));

  if (opts.trocken) {
    bericht.dauerMs = Date.now() - t0;
    return bericht;
  }

  // 3) Schreiben
  mkdirSync(opts.bilderDir, { recursive: true });
  const store: RecipeStore = openRecipeStore(opts.dbFile);
  const jetzt = new Date().toISOString();
  try {
    // Bildinfos vorab (async), dann alles in einer Transaktion
    const infos = new Map<string, Awaited<ReturnType<typeof bildInfo>>>();
    for (const { r } of geparst) {
      for (const { quelle, datei } of bilderVon(r)) {
        if (infos.has(datei)) continue;
        const src = join(iDir, quelle);
        if (!existsSync(src)) continue;
        const info = await bildInfo(src);
        infos.set(datei, info);
        const erg = kopiere(src, join(opts.bilderDir, datei), info.sha1);
        bericht.bilder[erg]++;
        bericht.bilder.gesamtBytes += info.bytes;
      }
    }
    if (bericht.unzugeordnet.length) {
      const ablage = join(opts.bilderDir, "_unzugeordnet");
      mkdirSync(ablage, { recursive: true });
      for (const f of bericht.unzugeordnet) {
        const src = join(iDir, f);
        kopiere(src, join(ablage, f.normalize("NFC")), sha1(readFileSync(src)));
      }
    }

    const tx = store.db.transaction(() => {
      for (const { datei, raw, r } of geparst) {
        const vorhanden = store.getRow(r.slug);
        if (vorhanden) {
          const unberuehrt = vorhanden.herkunft === "obsidian" && vorhanden.geaendert_am === vorhanden.erstellt_am;
          if (!unberuehrt) {
            bericht.uebersprungen.push({ slug: r.slug, grund: "in der App geändert oder nicht aus Obsidian" });
            continue;
          }
          if (vorhanden.obsidian_hash === sha1(Buffer.from(raw))) {
            bericht.uebersprungen.push({ slug: r.slug, grund: "unverändert" });
            continue;
          }
          store.db.prepare(`DELETE FROM recipes WHERE id = ?`).run(vorhanden.id); // Bilder per CASCADE
          bericht.aktualisiert++;
        } else {
          bericht.importiert++;
        }

        // Profilbild (rolle titel) = Frontmatter `Profilbild`. r.image ist seit 17.10.2026 das
        // Kartenbild (bei Standbildern ohne Gericht das KI-Bild, siehe kartenbild.json).
        const declared = matter(raw).data.Profilbild;
        const profil = declared ? resolveImageFile(String(declared).trim(), iDir) : null;
        const kartenbild = r.image && (!profil || bildKey(r.image) !== bildKey(profil)) ? r.image.normalize("NFC") : null;

        const wie = dublette.get(r.slug);
        if (wie) bericht.dublettenAbgelehnt.push({ slug: r.slug, wie });
        if (!r.image) {
          const m = raw.match(/^Profilbild:\s*"?([^"\n]*)"?\s*$/m);
          bericht.ohneTitelbild.push({ slug: r.slug, profilbild: m?.[1]?.trim() || null });
        }

        const bilder: ImageInput[] = bilderVon(r)
          .filter(({ datei }) => infos.has(datei))
          .map(({ datei }, i) => {
            const info = infos.get(datei)!;
            bericht.bilder.zugeordnet++;
            return {
              rolle: rolleAusDatei(datei, profil),
              datei,
              sortierung: i,
              breite: info.breite,
              hoehe: info.hoehe,
              bytes: info.bytes,
              sha1: info.sha1,
              now: jetzt,
            };
          });

        store.insert(
          {
            slug: r.slug,
            name: r.name,
            description: r.description,
            category: r.category,
            kcal: r.kcal,
            protein: r.protein,
            carbs: r.carbs,
            fat: r.fat,
            totalTime: r.totalTime,
            portions: r.portions,
            difficulty: r.difficulty,
            ingredients: r.ingredients,
            steps: r.steps,
            tips: r.tips,
            tags: r.tags,
            created: r.created,
            status: wie ? "abgelehnt" : "veroeffentlicht",
            statusReason: wie ? `Doppelte Quelle wie ${wie} (beim Import ausgeblendet, wie bisher in der App)` : null,
            source: r.source,
            sourceKey: quelleKey(r.source) || null,
            platform: erkennePlattform(r.source),
            origin: "obsidian",
            imageFocus: r.imageFocus,
            cardImage: kartenbild,
            obsidianFile: datei,
            obsidianOriginal: raw,
            obsidianHash: sha1(Buffer.from(raw)),
            now: jetzt,
          },
          bilder,
        );
      }
    });
    tx();

    bericht.dbZeilen = {
      gesamt: store.count(),
      veroeffentlicht: store.count("veroeffentlicht"),
      abgelehnt: store.count("abgelehnt"),
      bilder: (store.db.prepare(`SELECT COUNT(*) AS n FROM recipe_images`).get() as { n: number }).n,
    };
    log(`Import: ${bericht.importiert} neu, ${bericht.aktualisiert} aktualisiert, ${bericht.uebersprungen.length} übersprungen`);
  } finally {
    store.close();
  }
  bericht.dauerMs = Date.now() - t0;
  return bericht;
}
