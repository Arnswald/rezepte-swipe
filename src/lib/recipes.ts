/**
 * Rezept-Parser — liest Kochbuch-Rezepte aus Christians Obsidian-Vault.
 *
 * Quelle (im Container): read-only Mount des Ordners `06 Research/Gerichte`.
 * Bilder: Unterordner `Bilder`.
 *
 * Frontmatter (bei allen Rezepten konsistent):
 *   name, Kurzbeschreibung, kategorie, kalorien, protein,
 *   kohlenhydrate, fette, Profilbild, erstellt, quelle?
 *
 * Body-Sektionen: 📋 Überblick (Tabelle), 🛒 Zutaten, 👨‍🍳 Zubereitung,
 *                 💡 Tipps & Variationen, 📝 Meine Notizen
 */

import matter from "gray-matter";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { env } from "@/lib/env";

/**
 * Pfad-Auflösung, zwei Varianten:
 *  1. OBSIDIAN_RECIPES_PATH / OBSIDIAN_IMAGES_PATH — absoluter Pfad (eigener Docker-Mount)
 *  2. Fallback: relativ zum OBSIDIAN_VAULT_PATH (wenn der ganze Vault gemountet ist)
 */
export const RECIPES_FOLDER = process.env.OBSIDIAN_RECIPES_FOLDER ?? "06 Research/Gerichte";
export const IMAGES_FOLDER = process.env.OBSIDIAN_IMAGES_FOLDER ?? "06 Research/Gerichte/Bilder";
const RECIPES_ABS = process.env.OBSIDIAN_RECIPES_PATH ?? null;
const IMAGES_ABS = process.env.OBSIDIAN_IMAGES_PATH ?? null;

export interface IngredientGroup {
  /** z.B. "Hähnchen:" — leer wenn ungruppiert */
  group: string;
  items: string[];
}

export interface Recipe {
  /** Slug aus Dateiname, z.B. "chicken-nourish-bowl" */
  slug: string;
  name: string;
  description: string;
  category: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** Dateiname des Profilbilds, z.B. "chicken-nourish-bowl.jpg" */
  image: string | null;
  /** true wenn die Bilddatei tatsächlich existiert */
  imageExists: boolean;
  /** Alle Bilder zum Rezept (Titelbild zuerst, dann _1, _2, _selbst … ) — für die Galerie */
  images: string[];
  created: string;
  source: string | null;
  /** Aus der Überblick-Tabelle */
  totalTime: string | null;
  portions: string | null;
  difficulty: string | null;
  ingredients: IngredientGroup[];
  steps: string[];
  tips: string[];
}

// ── Helpers ───────────────────────────────────────────────────

function vaultPath(): string | null {
  return env.OBSIDIAN_VAULT_PATH ?? null;
}

export function recipesDir(): string | null {
  if (RECIPES_ABS) return RECIPES_ABS;
  const v = vaultPath();
  return v ? join(v, RECIPES_FOLDER) : null;
}

export function imagesDir(): string | null {
  if (IMAGES_ABS) return IMAGES_ABS;
  const v = vaultPath();
  return v ? join(v, IMAGES_FOLDER) : null;
}

/**
 * Löst einen Bild-Dateinamen im Bilder-Ordner auf und gibt den tatsächlichen
 * Dateinamen zurück (oder null).
 *
 * Warum case-insensitive: im Vault steht z.B. `Profilbild: Protein-Pancakes.png`,
 * die Datei heisst aber `protein-pancakes.png`. Auf macOS egal, im Linux-Container
 * (case-sensitive) wäre das ein 404.
 */
export function resolveImageFile(name: string): string | null {
  const dir = imagesDir();
  if (!dir || !name) return null;
  // Schnellweg: exakter Treffer
  if (existsSync(join(dir, name))) return name;
  // Fallback: case-insensitiver Scan
  try {
    const lower = name.toLowerCase();
    for (const f of readdirSync(dir)) {
      if (f.toLowerCase() === lower) return f;
    }
  } catch { /* Ordner nicht lesbar */ }
  return null;
}

/**
 * Findet ALLE Bilder zu einem Rezept-Slug für die Galerie.
 * Reihenfolge: Titelbild zuerst, dann numerierte (_1, _2 …), dann selbst-Fotos,
 * KI-/Original-Varianten ans Ende. Case-insensitiv (Linux-Container).
 */
export function galleryImages(slug: string, heroFile: string | null): string[] {
  const dir = imagesDir();
  if (!dir) return heroFile ? [heroFile] : [];
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return heroFile ? [heroFile] : [];
  }
  const slugLower = slug.toLowerCase();
  const isImg = (f: string) => /\.(jpe?g|png|webp)$/i.test(f);
  // Alle Dateien die mit dem Slug beginnen (name.jpg, name_1.jpg, name_selbst.jpg …)
  const matches = files.filter((f) => {
    if (!isImg(f)) return false;
    const base = f.replace(/\.(jpe?g|png|webp)$/i, "").toLowerCase();
    return base === slugLower || base.startsWith(slugLower + "_");
  });

  // Sortier-Priorität: Titelbild → _1.._9 → _selbst → _2/_original → _KI ans Ende
  const rank = (f: string): number => {
    const base = f.replace(/\.(jpe?g|png|webp)$/i, "").toLowerCase();
    if (base === slugLower) return 0;
    if (base.endsWith("_ki")) return 90;
    if (/_selbst(-\d+)?$/.test(base)) return 40;
    if (base.endsWith("_original")) return 80;
    const num = base.match(/_(\d+)$/);
    if (num) return 10 + parseInt(num[1]);
    return 50;
  };
  matches.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return matches;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Extrahiert einen H2-Abschnitt aus dem Markdown-Body (bis zum nächsten H2 oder ---) */
function extractSection(content: string, headingIncludes: string): string {
  const lines = content.split("\n");
  let capturing = false;
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (capturing) break;               // nächster H2 → fertig
      capturing = line.includes(headingIncludes);
      continue;
    }
    if (capturing) out.push(line);
  }
  return out.join("\n").trim();
}

/** Parst die Überblick-Tabelle: `| ⏳ Gesamtzeit | 30 Min |` */
function parseOverview(content: string): { totalTime: string | null; portions: string | null; difficulty: string | null } {
  const section = extractSection(content, "Überblick");
  const pick = (needle: string): string | null => {
    for (const line of section.split("\n")) {
      if (!line.trim().startsWith("|")) continue;
      const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
      if (cells.length >= 2 && cells[0].includes(needle)) return cells[1];
    }
    return null;
  };
  return {
    totalTime: pick("Gesamtzeit"),
    portions: pick("Portionen"),
    difficulty: pick("Schwierigkeit"),
  };
}

/** Parst Zutaten: Fettgedruckte Zeilen sind Gruppen, `- [ ] xyz` sind Items */
function parseIngredients(content: string): IngredientGroup[] {
  const section = extractSection(content, "Zutaten");
  const groups: IngredientGroup[] = [];
  let current: IngredientGroup = { group: "", items: [] };

  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Gruppen-Header: **Hähnchen:**
    const groupMatch = line.match(/^\*\*(.+?):?\*\*:?$/);
    if (groupMatch) {
      if (current.items.length > 0) groups.push(current);
      current = { group: groupMatch[1].replace(/:$/, "").trim(), items: [] };
      continue;
    }
    // Checkbox-Item: `- [ ] 150 g Süßkartoffel`
    // Leerzeichen nach dem Bullet ist Pflicht, sonst matcht auch `*(für 1 Portion)*`
    const itemMatch = line.match(/^[-*]\s+(?:\[[ xX]\]\s*)?(.+)$/);
    if (itemMatch) {
      const text = itemMatch[1].trim();
      if (text) current.items.push(text);
    }
  }
  if (current.items.length > 0) groups.push(current);
  return groups;
}

/** Parst nummerierte Zubereitungsschritte */
function parseSteps(content: string): string[] {
  const section = extractSection(content, "Zubereitung");
  const steps: string[] = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^\d+\.\s+(.*)$/);
    if (m && m[1].trim()) steps.push(m[1].trim());
  }
  return steps;
}

/** Parst Tipps als Bullet-Liste */
function parseTips(content: string): string[] {
  const section = extractSection(content, "Tipps");
  const tips: string[] = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.*)$/);
    if (m && m[1].trim()) tips.push(m[1].trim().replace(/^\*\*(.+?)\*\*:?\s*/, "$1: "));
  }
  return tips;
}

// ── Public API ────────────────────────────────────────────────

export function parseRecipeFile(filePath: string, _imgDir: string | null): Recipe | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const { data: fm, content } = matter(raw);

    const fileName = filePath.split("/").pop() ?? "";
    const slug = fileName.replace(/\.md$/, "");

    // Tatsächlichen Dateinamen auflösen (kann in der Schreibweise abweichen)
    const declared = fm.Profilbild ? String(fm.Profilbild).trim() : null;
    const image = declared ? resolveImageFile(declared) : null;
    const imageExists = image !== null;
    // Galerie: alle Bilder zum Slug, Titelbild garantiert an erster Stelle
    const gallery = galleryImages(slug, image);
    const images = image && !gallery.some((g) => g.toLowerCase() === image.toLowerCase())
      ? [image, ...gallery]
      : gallery;

    const overview = parseOverview(content);

    // erstellt kann als Date-Objekt geparst werden
    const rawCreated = fm.erstellt;
    const created = rawCreated instanceof Date
      ? rawCreated.toISOString().slice(0, 10)
      : String(rawCreated ?? "");

    return {
      slug,
      name: String(fm.name ?? slug),
      description: String(fm.Kurzbeschreibung ?? ""),
      category: String(fm.kategorie ?? "Sonstiges"),
      kcal: toNumber(fm.kalorien),
      protein: toNumber(fm.protein),
      carbs: toNumber(fm.kohlenhydrate),
      fat: toNumber(fm.fette),
      image,
      imageExists,
      images,
      created,
      source: fm.quelle ? String(fm.quelle) : null,
      totalTime: overview.totalTime,
      portions: overview.portions,
      difficulty: overview.difficulty,
      ingredients: parseIngredients(content),
      steps: parseSteps(content),
      tips: parseTips(content),
    };
  } catch (err) {
    console.error(`[recipes] parse failed: ${filePath}`, err);
    return null;
  }
}

export function scanRecipes(): Recipe[] {
  const dir = recipesDir();
  if (!dir || !existsSync(dir)) {
    console.error(`[recipes] Ordner nicht gefunden: ${dir}`);
    return [];
  }
  const imgDir = imagesDir();
  const recipes: Recipe[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const r = parseRecipeFile(join(dir, file), imgDir);
    if (r) recipes.push(r);
  }
  // Neueste zuerst
  recipes.sort((a, b) => b.created.localeCompare(a.created));
  return recipes;
}

/** Diagnose: sind Rezept- und Bild-Ordner im Container erreichbar? */
export function recipesDiagnostics() {
  const v = vaultPath();
  const rDir = recipesDir();
  const iDir = imagesDir();
  return {
    vaultPath: v,
    recipesDir: rDir,
    recipesDirExists: rDir ? existsSync(rDir) : false,
    imagesDir: iDir,
    imagesDirExists: iDir ? existsSync(iDir) : false,
    recipeCount: rDir && existsSync(rDir)
      ? readdirSync(rDir).filter((f) => f.endsWith(".md")).length
      : 0,
  };
}
