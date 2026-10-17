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
import kartenbildListe from "@/lib/kartenbild.json";
import { recipeStore, recipeImagesDir, type StoredRecipe } from "@/lib/recipeStore";

/**
 * Rezept-Quelle (seit 17.10.2026): `obsidian` liest den RO-Mount wie bisher, `db` die
 * Rezept-Datenbank in DATA_DIR/rezepte.db (Bilder in DATA_DIR/bilder, gleiche Dateinamen).
 * Umschalten per Stack-Env RECIPE_SOURCE, Rückweg = Variable zurück. Plan: docs/plan-datenbank.md
 */
export const RECIPE_SOURCE: "obsidian" | "db" = process.env.RECIPE_SOURCE === "db" ? "db" : "obsidian";

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
  /** Kartenbild: Dateiname des Bildes für Karte, Raster, Detail-Kopf und Teilen-Vorschau.
   *  Meist das Profilbild, bei Standbildern ohne Gericht das KI-Bild (siehe `kartenbild`). */
  image: string | null;
  /** true, wenn das Kartenbild ein KI-Bild ist (Dateiname endet auf _KI) */
  imageIsAi: boolean;
  /** true wenn die Bilddatei tatsächlich existiert */
  imageExists: boolean;
  /** Alle Bilder zum Rezept (Kartenbild zuerst, dann Profilbild, _1, _2, _selbst … ) — für die Galerie */
  images: string[];
  /** Von Hand gesetzter Bildfokus des Kartenbilds in Prozent [x, y] (Frontmatter `bildfokus`), sonst null */
  imageFocus: [number, number] | null;
  created: string;
  source: string | null;
  /** Aus der Überblick-Tabelle */
  totalTime: string | null;
  portions: string | null;
  difficulty: string | null;
  ingredients: IngredientGroup[];
  steps: string[];
  tips: string[];
  /** Abgeleitete Zutaten-/Küchen-Tags für Empfehlungen (z.B. hähnchen, pasta, käse, vegetarisch) */
  tags: string[];
}

// ── Zutaten-/Küchen-Tags (für Empfehlungen "könnte dir gefallen") ──────────────
// Kuratiertes Lexikon: Schlüsselwort (kleingeschrieben) → kanonischer Tag.
// Bewusst robust statt vollständig — deckt die häufigen Bausteine ab.
const TAG_LEXICON: { tag: string; patterns: string[] }[] = [
  // Proteine
  { tag: "hähnchen", patterns: ["hähnchen", "haehnchen", "hühn", "huhn", "chicken", "poulet", "geflügel", "pute", "truthahn"] },
  { tag: "rind", patterns: ["rind", "beef", "hackfleisch", "steak", "gulasch", "roastbeef", "tafelspitz"] },
  { tag: "schwein", patterns: ["schwein", "pork", "speck", "bacon", "schinken", "kassler", "bratwurst", "salami", "chorizo", "pancetta"] },
  { tag: "fisch", patterns: ["fisch", "lachs", "salmon", "thunfisch", "tuna", "garnele", "shrimp", "scampi", "forelle", "kabeljau", "dorsch", "meeresfrüchte", "sardine", "hering", "makrele"] },
  { tag: "lamm", patterns: ["lamm", "lamb"] },
  { tag: "tofu", patterns: ["tofu", "tempeh", "sojaschnetzel", "sojagranulat"] },
  { tag: "ei", patterns: ["spiegelei", "rührei", "ruehrei", "omelett", "omelette", "eier", "pochiert", "tamago", "frittata", "shakshuka"] },
  // Basis / Kohlenhydrate
  { tag: "pasta", patterns: ["pasta", "nudel", "spaghetti", "penne", "lasagne", "tagliatelle", "fusilli", "makkaroni", "ravioli", "spätzle", "spaetzle", "tortellini"] },
  { tag: "reis", patterns: ["reis", "risotto", "sushi", "paella", "jambalaya"] },
  { tag: "kartoffel", patterns: ["kartoffel", "potato", "pommes", "püree", "pueree", "bratkartoffel", "rösti", "roesti", "gnocchi"] },
  { tag: "brot", patterns: ["brot", "toast", "sandwich", "burger", "wrap", "tortilla", "baguette", "brötchen", "broetchen", "focaccia", "pita", "naan", "bun"] },
  { tag: "getreide", patterns: ["couscous", "bulgur", "quinoa", "haferflocken", "hafer", "oats", "porridge", "polenta"] },
  // Milchprodukte
  { tag: "käse", patterns: ["käse", "kaese", "cheese", "mozzarella", "parmesan", "feta", "gouda", "cheddar", "ricotta", "frischkäse", "halloumi", "burrata", "gruyère"] },
  { tag: "sahne", patterns: ["sahne", "cream", "crème", "creme fraiche", "schmand", "mascarpone", "kokosmilch"] },
  // Gemüse / häufige Zutaten (auch für "Was ich nicht mag")
  { tag: "tomate", patterns: ["tomate", "tomato", "passata", "sugo"] },
  { tag: "pilz", patterns: ["pilz", "champignon", "mushroom", "steinpilz", "pfifferling", "shiitake"] },
  { tag: "spinat", patterns: ["spinat", "spinach"] },
  { tag: "brokkoli", patterns: ["brokkoli", "broccoli"] },
  { tag: "paprika", patterns: ["paprika", "bell pepper"] },
  { tag: "zwiebel", patterns: ["zwiebel", "onion", "schalotte"] },
  { tag: "knoblauch", patterns: ["knoblauch", "garlic"] },
  { tag: "avocado", patterns: ["avocado", "guacamole"] },
  { tag: "kürbis", patterns: ["kürbis", "kuerbis", "pumpkin", "hokkaido"] },
  { tag: "aubergine", patterns: ["aubergine", "eggplant"] },
  { tag: "zucchini", patterns: ["zucchini", "courgette"] },
  { tag: "spargel", patterns: ["spargel", "asparagus"] },
  { tag: "mais", patterns: ["mais", "corn"] },
  { tag: "linse", patterns: ["linse", "lentil"] },
  { tag: "bohne", patterns: ["bohne", "kidneybohne", "kichererbse", "chickpea"] },
  { tag: "kokos", patterns: ["kokos", "coconut"] },
  // Küche / Charakter
  { tag: "asiatisch", patterns: ["asia", "asiat", "sojasauce", "sojasoße", "teriyaki", "curry", "ingwer", "wok", "ramen", "udon", "miso", "kimchi", "thai", "japan", "korean", "chinesisch", "szechuan"] },
  { tag: "mexikanisch", patterns: ["mexi", "taco", "burrito", "quesadilla", "enchilada", "jalapeño", "jalapeno", "fajita"] },
  { tag: "scharf", patterns: ["chili", "sriracha", "harissa", "sambal", "peperoni"] },
  { tag: "süß", patterns: ["dessert", "schoko", "chocolate", "kuchen", "cookie", "keks", "pancake", "waffel", "muffin", "vanille", "karamell", "caramel", "honig", "mousse", "pudding", "beere", "erdbeer", "banane", "zimt"] },
];

const MEAT_TAGS = new Set(["hähnchen", "rind", "schwein", "fisch", "lamm"]);

/** Leitet Tags aus Name + Beschreibung + Zutatentext ab. */
export function deriveTags(blob: string): string[] {
  const b = " " + blob.toLowerCase() + " ";
  const tags = new Set<string>();
  for (const { tag, patterns } of TAG_LEXICON) {
    if (patterns.some((p) => b.includes(p))) tags.add(tag);
  }
  // vegetarisch, wenn nichts Fleischiges/Fischiges erkannt wurde
  if (![...MEAT_TAGS].some((t) => tags.has(t))) tags.add("vegetarisch");
  return [...tags];
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

/** Bilder, die die App ausliefert: bei Quelle `db` DATA_DIR/bilder, sonst der Vault-Ordner. */
export function imagesDir(): string | null {
  return RECIPE_SOURCE === "db" ? recipeImagesDir() : obsidianImagesDir();
}

/** Bilder-Ordner im Vault (Mount), unabhängig von der Quelle: für Parser und Import. */
export function obsidianImagesDir(): string | null {
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
export function resolveImageFile(name: string, dir: string | null = imagesDir()): string | null {
  if (!dir || !name) return null;
  // Schnellweg: exakter Treffer
  if (existsSync(join(dir, name))) return name;
  // Fallback: case-insensitiver Scan, Umlaute NFC (macOS liefert Dateinamen zerlegt)
  const lower = name.normalize("NFC").toLowerCase();
  for (const f of listImageDir(dir) ?? []) {
    if (f.normalize("NFC").toLowerCase() === lower) return f;
  }
  return null;
}

/** Inhalt des Bilder-Ordners, 10 s gemerkt. Vorher las jedes Rezept beim Scannen
 *  den ganzen Ordner neu ein (≈190 × readdir mit ~300 Dateien pro Anfrage). */
let dirCache: { dir: string; at: number; files: string[] } | null = null;
function listImageDir(dir: string): string[] | null {
  const now = Date.now();
  if (dirCache && dirCache.dir === dir && now - dirCache.at < 10_000) return dirCache.files;
  try {
    dirCache = { dir, at: now, files: readdirSync(dir) };
    return dirCache.files;
  } catch {
    return null;
  }
}

/**
 * Frontmatter `bildfokus` → [x, y] in Prozent, oder null.
 * Erlaubt: „50 70“ / „50% 70%“ / „50,70“ (x y), eine Zahl = nur senkrecht („70“ → [50, 70]),
 * Wörter: oben, unten, mitte, links, rechts, auch kombiniert („unten links“).
 */
export function parseFocus(raw: unknown): [number, number] | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).toLowerCase().trim();
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const nums = s.match(/-?\d+(?:[.,]\d+)?/g)?.map((n) => parseFloat(n.replace(",", ".")));
  if (nums && nums.length >= 2) return [clamp(nums[0]), clamp(nums[1])];
  if (nums && nums.length === 1) return [50, clamp(nums[0])];
  let x = 50, y = 50, hit = false;
  if (/oben/.test(s)) { y = 15; hit = true; }
  if (/unten/.test(s)) { y = 85; hit = true; }
  if (/links/.test(s)) { x = 15; hit = true; }
  if (/rechts/.test(s)) { x = 85; hit = true; }
  if (/mitte/.test(s)) hit = true;
  return hit ? [x, y] : null;
}

// ── Kartenbild: Profilbild oder KI-Bild ──────────────────────
// Viele Profilbilder sind Instagram-Standbilder, auf denen eine Person oder Schrift zu
// sehen ist, aber kein Gericht. Gibt es zum Rezept ein passendes KI-Bild (<slug>_KI.jpg),
// zeigt die Karte dann das KI-Bild; das Profilbild bleibt in der Galerie.
// Die Einstufung aller Profilbilder liegt in `kartenbild.json` (von Hand am Kontaktbogen
// geprüft, 17.10.2026): slug → { kategorie: gericht|person|schrift|unklar, quelle: ki|original, grund }.
// Frontmatter `kartenbild: ki | original` übersteuert die Datei.

type KartenbildEintrag = { kategorie: string; quelle: string; grund: string; kiPasst?: boolean };
const KARTENBILD = kartenbildListe as Record<string, KartenbildEintrag>;

export const isAiImage = (f: string) => /_ki\.(jpe?g|png|webp)$/i.test(f);

/** Gewünschte Quelle des Kartenbilds: Frontmatter vor Datei, sonst Original. */
export function kartenbildQuelle(slug: string, raw: unknown): "ki" | "original" {
  const fm = raw == null ? "" : String(raw).toLowerCase().trim();
  if (fm === "ki" || fm === "original") return fm;
  return KARTENBILD[slug]?.quelle === "ki" ? "ki" : "original";
}

/**
 * Findet ALLE Bilder zu einem Rezept-Slug für die Galerie.
 * Reihenfolge: Titelbild zuerst, dann numerierte (_1, _2 …), dann selbst-Fotos,
 * KI-/Original-Varianten ans Ende. Case-insensitiv (Linux-Container).
 */
export function galleryImages(slug: string, heroFile: string | null, dir: string | null = imagesDir()): string[] {
  if (!dir) return heroFile ? [heroFile] : [];
  const files = listImageDir(dir);
  if (!files) return heroFile ? [heroFile] : [];
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

/** Parst Tipps als Bullet-Liste. „**Titel:** Text“ → „Titel: Text“ (Doppelpunkt
 *  steht im Vault meist INNERHALB der Sternchen → sonst „Titel:: Text“). */
function parseTips(content: string): string[] {
  const section = extractSection(content, "Tipps");
  const tips: string[] = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.*)$/);
    if (m && m[1].trim()) tips.push(m[1].trim().replace(/^\*\*(.+?):?\*\*:?\s*/, "$1: "));
  }
  return tips;
}

// ── Public API ────────────────────────────────────────────────

export function parseRecipeFile(filePath: string, imgDir: string | null = obsidianImagesDir()): Recipe | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const fileName = filePath.split("/").pop() ?? "";
    return parseRecipeMarkdown(raw, fileName.replace(/\.md$/, ""), imgDir);
  } catch (err) {
    console.error(`[recipes] parse failed: ${filePath}`, err);
    return null;
  }
}

/**
 * Kochbuch-Markdown (Frontmatter + Abschnitte) → Recipe. Auch für Rezepte, die n8n als
 * Markdown an /api/admin/recipes/import schickt (gleicher Claude-Prompt wie früher für den
 * Vault). imgDir = null: Bilder werden nicht aufgelöst (image/images leer). Wirft bei
 * kaputtem YAML.
 */
export function parseRecipeMarkdown(raw: string, slug: string, imgDir: string | null): Recipe {
  {
    const { data: fm, content } = matter(raw);

    // Tatsächlichen Dateinamen auflösen (kann in der Schreibweise abweichen)
    const declared = fm.Profilbild ? String(fm.Profilbild).trim() : null;
    const profile = declared ? resolveImageFile(declared, imgDir) : null;
    // Galerie: alle Bilder zum Slug, Profilbild garantiert an erster Stelle
    const gallery = galleryImages(slug, profile, imgDir);
    let images = profile && !gallery.some((g) => g.toLowerCase() === profile.toLowerCase())
      ? [profile, ...gallery]
      : gallery;
    // Kartenbild: KI-Bild statt Profilbild, wenn so eingestuft (oder per Frontmatter) und vorhanden.
    // Es rückt in der Galerie nach vorn (= Detail-Kopf), das Profilbild folgt direkt dahinter.
    const aiFile = images.find(isAiImage) ?? null;
    let image = profile;
    if (aiFile && profile !== aiFile && kartenbildQuelle(slug, fm.kartenbild ?? fm.Kartenbild) === "ki") image = aiFile;
    // Kartenbild immer vorn, damit Karte und Detail-Kopf dasselbe zeigen (auch wenn das
    // Profilbild selbst ein _KI-Bild ist und galleryImages das Original davor sortiert)
    // (Vergleich ohne Groß/Klein: auf macOS liefert resolveImageFile die Frontmatter-Schreibweise)
    if (image && images[0]?.toLowerCase() !== image.toLowerCase()) {
      const lower = image.toLowerCase();
      images = [image, ...images.filter((f) => f.toLowerCase() !== lower)];
    }
    const imageExists = image !== null;

    const overview = parseOverview(content);
    const ingredients = parseIngredients(content);
    const name = String(fm.name ?? slug);
    const description = String(fm.Kurzbeschreibung ?? "");
    const ingredientBlob = ingredients.flatMap((g) => [g.group, ...g.items]).join(" ");
    const tags = deriveTags(`${name} ${description} ${ingredientBlob}`);

    // erstellt kann als Date-Objekt geparst werden
    const rawCreated = fm.erstellt;
    const created = rawCreated instanceof Date
      ? rawCreated.toISOString().slice(0, 10)
      : String(rawCreated ?? "");

    return {
      slug,
      name,
      description,
      category: String(fm.kategorie ?? "Sonstiges"),
      kcal: toNumber(fm.kalorien),
      protein: toNumber(fm.protein),
      carbs: toNumber(fm.kohlenhydrate),
      fat: toNumber(fm.fette),
      image,
      imageIsAi: image ? isAiImage(image) : false,
      imageExists,
      images,
      imageFocus: image ? parseFocus(fm.bildfokus ?? fm.Bildfokus) : null,
      created,
      source: fm.quelle ? String(fm.quelle) : null,
      totalTime: overview.totalTime,
      portions: overview.portions,
      difficulty: overview.difficulty,
      ingredients,
      steps: parseSteps(content),
      tips: parseTips(content),
      tags,
    };
  }
}

/** Gescannte Liste 20 s merken: /api/recipes, die Teilen-Seite und die Bild-Route
 *  (Fokus-Übersteuerung) fragen oft kurz hintereinander. Neue Rezepte erscheinen
 *  also spätestens 20 s nach dem Sync. */
let scanCache: { at: number; recipes: Recipe[] } | null = null;
const SCAN_TTL_MS = 20_000;

export function scanRecipes(): Recipe[] {
  const now = Date.now();
  if (scanCache && now - scanCache.at < SCAN_TTL_MS) return scanCache.recipes;
  const recipes = scanRecipesUncached();
  scanCache = { at: now, recipes };
  focusOverrides = new Map(
    recipes.filter((r) => r.image && r.imageFocus).map((r) => [r.image!.toLowerCase(), r.imageFocus!]),
  );
  return recipes;
}

/** Von Hand gesetzter Fokus (Frontmatter `bildfokus`) je Titelbild-Dateiname (klein). */
let focusOverrides: Map<string, [number, number]> | null = null;
export function focusOverrideFor(imageName: string): [number, number] | null {
  if (!focusOverrides) scanRecipes();
  return focusOverrides?.get(imageName.toLowerCase()) ?? null;
}

/** Nach jedem Schreiben in die DB: nächste Anfrage liest frisch statt aus dem 20-s-Merker. */
export function invalidateRecipeCache() {
  scanCache = null;
  focusOverrides = null;
}

/** DB-Zeile → genau der öffentliche Recipe-Typ (ohne id, Status, guestId der Einreichenden). */
export function publicRecipe(r: StoredRecipe): Recipe {
  return {
    slug: r.slug, name: r.name, description: r.description, category: r.category,
    kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat,
    image: r.image, imageIsAi: r.imageIsAi, imageExists: r.imageExists, images: r.images,
    imageFocus: r.imageFocus, created: r.created, source: r.source,
    totalTime: r.totalTime, portions: r.portions, difficulty: r.difficulty,
    ingredients: r.ingredients, steps: r.steps, tips: r.tips, tags: r.tags,
  };
}

function scanRecipesUncached(): Recipe[] {
  if (RECIPE_SOURCE === "db") return recipeStore().list().map(publicRecipe);
  return scanObsidian();
}

/** Liest den Obsidian-Ordner direkt (Quelle `obsidian`, Parallelvergleich im Admin). */
export function scanObsidian(): Recipe[] {
  const dir = recipesDir();
  if (!dir || !existsSync(dir)) {
    console.error(`[recipes] Ordner nicht gefunden: ${dir}`);
    return [];
  }
  const imgDir = obsidianImagesDir();
  const recipes: Recipe[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const r = parseRecipeFile(join(dir, file), imgDir);
    if (r) recipes.push(r);
  }
  // Neueste zuerst (bei gleichem Datum stabil nach Slug)
  recipes.sort((a, b) => b.created.localeCompare(a.created) || a.slug.localeCompare(b.slug));
  // Zweites Netz gegen Doppelungen im Vault: gleiche Quelle = gleiches Rezept, nur einmal
  // zeigen. Entstanden, wenn die Automation einen Link zweimal bekam und Claude den Namen
  // anders vergab. Seit 09.10.2026 prüft WF10b das schon vor dem Anlegen.
  const seen = new Set<string>();
  return recipes.filter((r) => {
    const key = sourceKey(r.source);
    if (!key) return true;
    if (seen.has(key)) { console.warn(`[recipes] Doppelte Quelle, ausgeblendet: ${r.slug}`); return false; }
    seen.add(key);
    return true;
  });
}

/** Vergleichsschlüssel einer Quelle: Instagram per Post-ID (/p/, /reel/ egal), sonst URL ohne Query. */
export function sourceKey(u: string | null): string {
  if (!u) return "";
  const ig = u.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (ig) return `ig:${ig[1]}`;
  return u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
}

/**
 * Ein einzelnes Rezept per Slug (Dateiname ohne .md) — für die teilbare
 * Detail-Seite `/rezept/[slug]`. Case-insensitiv, damit geteilte Links robust sind.
 */
export function getRecipeBySlug(slug: string): Recipe | null {
  if (RECIPE_SOURCE === "db") {
    const r = recipeStore().get(slug);
    return r ? publicRecipe(r) : null;
  }
  const dir = recipesDir();
  if (!dir || !existsSync(dir) || !slug) return null;
  // Nur reine Dateinamen: kein „../“, keine Unterordner (Next dekodiert %2F im Param)
  if (/[\\/]/.test(slug) || slug.startsWith(".")) return null;
  const imgDir = obsidianImagesDir();
  const target = `${slug}.md`;
  // Schnellweg: exakter Dateiname
  if (existsSync(join(dir, target))) {
    return parseRecipeFile(join(dir, target), imgDir);
  }
  // Fallback: case-insensitiver Scan (Linux-Container)
  try {
    const lower = target.toLowerCase();
    for (const f of readdirSync(dir)) {
      if (f.toLowerCase() === lower) return parseRecipeFile(join(dir, f), imgDir);
    }
  } catch { /* Ordner nicht lesbar */ }
  return null;
}

/** Diagnose: sind Rezept- und Bild-Ordner im Container erreichbar? */
export function recipesDiagnostics() {
  if (RECIPE_SOURCE === "db") {
    const iDir = imagesDir();
    return {
      source: "db" as const,
      recipesDir: null,
      recipesDirExists: false,
      imagesDir: iDir,
      imagesDirExists: iDir ? existsSync(iDir) : false,
      recipeCount: recipeStore().count("veroeffentlicht"),
    };
  }
  const v = vaultPath();
  const rDir = recipesDir();
  const iDir = imagesDir();
  return {
    source: "obsidian" as const,
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
