/**
 * Rezept-Datenbank (Entwurf, 17.10.2026) — NOCH NIRGENDS IMPORTIERT.
 *
 * Löst später den Obsidian-Ordner als Rezeptquelle ab. Die Datenbank ist dann führend,
 * Obsidian bekommt nur noch eine Kopie (Export vom Mac aus, siehe docs/plan-datenbank.md).
 *
 * Wo: dieselbe SQLite-Datei wie die Verdicts (DATA_DIR/rezepte.db). Eine Datei heißt
 * eine Sicherung, und Abfragen wie „Trending nur über veröffentlichte Rezepte“ gehen
 * per JOIN. better-sqlite3 verträgt zwei Verbindungen auf dieselbe Datei (WAL).
 *
 * Bilder: als Dateien in DATA_DIR/bilder, die Tabelle `recipe_images` verweist darauf.
 * Die Dateinamen bleiben die aus dem Vault (`<slug>.jpg`, `<slug>_1.jpg`, `_selbst`, `_KI` …):
 * so bleiben alle Bild-URLs (/api/recipes/image/<name>), der Varianten-Cache in
 * DATA_DIR/image-cache und der Fokus-Cache (focus-v1.json, Schlüssel Name + Größe + mtime)
 * gültig. Die Bild-Route muss später nur auf DATA_DIR/bilder zeigen.
 *
 * Zutaten/Schritte/Tipps als JSON-Spalten, nicht als eigene Tabellen. Begründung:
 *  - Sie werden immer als Ganzes mit dem Rezept gelesen und geschrieben (Detail, Export,
 *    Einreichung), nie einzeln abgefragt.
 *  - Reihenfolge und Gruppen („**Sauce:**“) sind Teil der Daten; in Tabellen bräuchte es
 *    Positions- und Gruppen-Spalten plus drei JOINs für jede Rezeptliste.
 *  - Die Zutaten-Tags für Empfehlungen werden beim Schreiben abgeleitet und in `tags`
 *    gespeichert. Wer doch einmal quer suchen will: SQLite kann json_each().
 *  - Bei ~200 Rezepten (≈1.800 Zutatenzeilen) gibt es keinen Grund für Normalisierung.
 *
 * Migration: idempotent (CREATE … IF NOT EXISTS) mit Versionsnummer in `schema_versionen`
 * (eigener Bereich „rezepte“, damit `PRAGMA user_version` für db.ts frei bleibt).
 * Neue Spalten später als Schritt `version < N` in migrate() ergänzen, nie bestehende ändern.
 *
 * Sichtbarkeit (Entscheidung Christian, 17.10.2026):
 *  - alle sehen `veroeffentlicht` (Christians Rezepte + freigegebene Einreichungen)
 *  - wer einreicht, sieht seine `eingereicht`-Rezepte sofort selbst (eingereicht_von = guestId)
 *  - `abgelehnt` sieht nur der Admin
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { env } from "@/lib/env";
import type { IngredientGroup, Recipe } from "@/lib/recipes";

export const RECIPE_SCHEMA_VERSION = 1;

export type RecipeStatus = "veroeffentlicht" | "eingereicht" | "abgelehnt";
export const RECIPE_STATUSES: readonly RecipeStatus[] = ["veroeffentlicht", "eingereicht", "abgelehnt"];

export type Plattform = "instagram" | "tiktok" | "pinterest" | "web";

/** Woher der Datensatz kam — für Auswertung und Export. */
export type Herkunft = "obsidian" | "link" | "formular" | "sprache" | "admin";

/** Rolle eines Bildes. `original` = ersetztes Altbild (`_original` im Vault). */
export type ImageRole = "titel" | "galerie" | "selbst" | "ki" | "original";

/** Ergebnis der Plausibilitätsprüfung (siehe lib/submission.ts), als JSON gespeichert. */
export interface StoredCheck {
  ok: boolean;
  /** auslesen = Link ist bei n8n, Felder noch leer (UI zeigt „wird ausgelesen“, Stapel blendet aus) */
  phase?: "auslesen" | "fertig" | "fehlgeschlagen";
  fehler: string[];
  hinweise: string[];
  dubletten?: { slug: string; name: string; grund: string }[];
  geprueftAm: string;
}

/** Zeile der Tabelle `recipes`, wie sie aus SQLite kommt. */
export interface RecipeRow {
  id: number;
  slug: string;
  name: string;
  beschreibung: string;
  kategorie: string;
  kalorien: number | null;
  protein: number | null;
  kohlenhydrate: number | null;
  fette: number | null;
  gesamtzeit: string | null;
  portionen: string | null;
  schwierigkeit: string | null;
  zutaten: string;
  schritte: string;
  tipps: string;
  tags: string;
  erstellt: string;
  status: RecipeStatus;
  status_grund: string | null;
  quelle_url: string | null;
  quelle_key: string | null;
  plattform: Plattform | null;
  herkunft: Herkunft;
  eingereicht_von: string | null;
  eingereicht_name: string | null;
  pruefung: string | null;
  bildfokus: string | null;
  kartenbild: string | null;
  obsidian_datei: string | null;
  obsidian_original: string | null;
  obsidian_hash: string | null;
  obsidian_export_hash: string | null;
  erstellt_am: string;
  geaendert_am: string;
  freigegeben_am: string | null;
}

export interface ImageRow {
  id: number;
  recipe_id: number;
  rolle: ImageRole;
  datei: string;
  sortierung: number;
  breite: number | null;
  hoehe: number | null;
  bytes: number | null;
  sha1: string | null;
  herkunft_url: string | null;
  erstellt_am: string;
}

/** Eingabe für insert/update. Feldnamen wie im App-Typ `Recipe`, damit die Routen nichts übersetzen müssen. */
export interface RecipeInput {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  kcal?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  totalTime?: string | null;
  portions?: string | null;
  difficulty?: string | null;
  ingredients?: IngredientGroup[];
  steps?: string[];
  tips?: string[];
  tags?: string[];
  /** YYYY-MM-DD, wie Frontmatter `erstellt` */
  created?: string;
  status?: RecipeStatus;
  statusReason?: string | null;
  source?: string | null;
  sourceKey?: string | null;
  platform?: Plattform | null;
  origin?: Herkunft;
  submittedBy?: string | null;
  submittedName?: string | null;
  check?: StoredCheck | null;
  /** Bildfokus des Kartenbilds [x, y] in Prozent */
  imageFocus?: [number, number] | null;
  /** Dateiname des Kartenbilds (Karte, Raster, Detail-Kopf), falls nicht das Profilbild — siehe kartenbild.json */
  cardImage?: string | null;
  obsidianFile?: string | null;
  obsidianOriginal?: string | null;
  obsidianHash?: string | null;
  /** ISO-Zeitpunkt; Default jetzt */
  now?: string;
}

export interface ImageInput {
  rolle: ImageRole;
  datei: string;
  sortierung?: number;
  breite?: number | null;
  hoehe?: number | null;
  bytes?: number | null;
  sha1?: string | null;
  herkunftUrl?: string | null;
  now?: string;
}

/** Recipe wie heute aus recipes.ts, plus die neuen Datenbank-Felder (optional für die UI). */
export interface StoredRecipe extends Recipe {
  id: number;
  status: RecipeStatus;
  platform: Plattform | null;
  submittedBy: string | null;
  submittedName: string | null;
  cardImage: string | null;
  updatedAt: string;
}

export interface ListOptions {
  /** Gast, der fragt. Sieht zusätzlich seine eigenen `eingereicht`-Rezepte. */
  viewerGuestId?: string | null;
  /** Admin: bestimmte Status statt der Gast-Sicht. „alle“ = alles. */
  status?: RecipeStatus | RecipeStatus[] | "alle";
}

// ── Schema ────────────────────────────────────────────────────

const SCHEMA_V1 = `
  CREATE TABLE IF NOT EXISTS schema_versionen (
    bereich      TEXT PRIMARY KEY,
    version      INTEGER NOT NULL,
    geaendert_am TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recipes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    slug            TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- = Dateiname im Vault ohne .md, URL /rezept/<slug>
    name            TEXT NOT NULL,
    beschreibung    TEXT NOT NULL DEFAULT '',
    kategorie       TEXT NOT NULL DEFAULT 'Hauptgericht',
    kalorien        REAL,          -- pro Portion
    protein         REAL,
    kohlenhydrate   REAL,
    fette           REAL,
    gesamtzeit      TEXT,          -- Freitext wie im Vault („30 Min + 4 Std Kühlzeit“)
    portionen       TEXT,
    schwierigkeit   TEXT,
    zutaten         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(zutaten)),   -- [{group, items[]}]
    schritte        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(schritte)),  -- [string]
    tipps           TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tipps)),     -- [string]
    tags            TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),      -- abgeleitete Zutaten-Tags
    erstellt        TEXT NOT NULL DEFAULT '',  -- YYYY-MM-DD (Frontmatter erstellt), Sortierung
    status          TEXT NOT NULL DEFAULT 'eingereicht'
                    CHECK (status IN ('veroeffentlicht', 'eingereicht', 'abgelehnt')),
    status_grund    TEXT,          -- z. B. Ablehnungsgrund, „Doppelte Quelle wie …“
    quelle_url      TEXT,
    quelle_key      TEXT,          -- Vergleichsschlüssel (IG per Post-ID), für Dubletten
    plattform       TEXT CHECK (plattform IS NULL OR plattform IN ('instagram', 'tiktok', 'pinterest', 'web')),
    herkunft        TEXT NOT NULL DEFAULT 'admin'
                    CHECK (herkunft IN ('obsidian', 'link', 'formular', 'sprache', 'admin')),
    eingereicht_von TEXT,          -- guestId des Gasts (NULL = Christian / Vault)
    eingereicht_name TEXT,         -- Anzeigename zum Zeitpunkt der Einreichung
    pruefung        TEXT,          -- JSON StoredCheck (Plausibilität, Dubletten)
    bildfokus       TEXT,          -- „x y“ in Prozent, übersteuert den automatischen Fokus
    kartenbild      TEXT,          -- Dateiname des Kartenbilds (z. B. <slug>_KI.jpg), NULL = Profilbild (rolle titel)
    obsidian_datei  TEXT,          -- Dateiname im Vault beim Import (Rückweg / Export)
    obsidian_original TEXT,        -- Markdown beim Import, unverändert (nichts geht verloren)
    obsidian_hash   TEXT,          -- sha1 von obsidian_original
    obsidian_export_hash TEXT,     -- sha1 des zuletzt exportierten Markdowns (Export nur bei Änderung)
    erstellt_am     TEXT NOT NULL, -- ISO, Zeitpunkt des Datensatzes
    geaendert_am    TEXT NOT NULL,
    freigegeben_am  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_recipes_status     ON recipes(status);
  CREATE INDEX IF NOT EXISTS idx_recipes_quelle_key ON recipes(quelle_key);
  CREATE INDEX IF NOT EXISTS idx_recipes_von        ON recipes(eingereicht_von);
  CREATE INDEX IF NOT EXISTS idx_recipes_geaendert  ON recipes(geaendert_am);

  CREATE TABLE IF NOT EXISTS recipe_images (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id    INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    rolle        TEXT NOT NULL CHECK (rolle IN ('titel', 'galerie', 'selbst', 'ki', 'original')),
    datei        TEXT NOT NULL,        -- Dateiname in DATA_DIR/bilder (Original, unverändert)
    sortierung   INTEGER NOT NULL DEFAULT 0,  -- Reihenfolge in der Galerie
    breite       INTEGER,
    hoehe        INTEGER,
    bytes        INTEGER,
    sha1         TEXT,
    herkunft_url TEXT,                 -- woher das Bild geladen wurde (Einreichung per Link)
    erstellt_am  TEXT NOT NULL,
    UNIQUE (recipe_id, datei)
  );
  CREATE INDEX IF NOT EXISTS idx_images_recipe ON recipe_images(recipe_id);
  CREATE INDEX IF NOT EXISTS idx_images_datei  ON recipe_images(datei COLLATE NOCASE);
  -- Höchstens ein Titelbild je Rezept
  CREATE UNIQUE INDEX IF NOT EXISTS idx_images_ein_titel ON recipe_images(recipe_id) WHERE rolle = 'titel';
`;

/** Bringt eine Datenbank auf den aktuellen Stand. Mehrfach aufrufbar. */
export function migrateRecipeSchema(db: Database.Database): number {
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_versionen (
    bereich TEXT PRIMARY KEY, version INTEGER NOT NULL, geaendert_am TEXT NOT NULL)`);
  const row = db.prepare(`SELECT version FROM schema_versionen WHERE bereich = 'rezepte'`).get() as
    | { version: number }
    | undefined;
  const current = row?.version ?? 0;
  if (current >= RECIPE_SCHEMA_VERSION) return current;
  const step = db.transaction(() => {
    if (current < 1) db.exec(SCHEMA_V1);
    // if (current < 2) db.exec(`ALTER TABLE recipes ADD COLUMN …`);
    db.prepare(`
      INSERT INTO schema_versionen (bereich, version, geaendert_am) VALUES ('rezepte', ?, ?)
      ON CONFLICT(bereich) DO UPDATE SET version = excluded.version, geaendert_am = excluded.geaendert_am
    `).run(RECIPE_SCHEMA_VERSION, new Date().toISOString());
  });
  step();
  return RECIPE_SCHEMA_VERSION;
}

// ── Hilfen ────────────────────────────────────────────────────

const json = (v: unknown) => JSON.stringify(v ?? []);
function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** „50 70“ → [50, 70]. Gespeichert wird immer normalisiert (siehe focusToText). */
export function focusFromText(s: string | null): [number, number] | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,3})\s+(\d{1,3})$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
export function focusToText(f: [number, number] | null | undefined): string | null {
  return f ? `${Math.round(f[0])} ${Math.round(f[1])}` : null;
}

/** Gleiche Sortierung wie scanRecipes(): neueste zuerst, bei gleichem Datum nach Slug. */
export function compareRecipes(a: { erstellt: string; slug: string }, b: { erstellt: string; slug: string }): number {
  return b.erstellt.localeCompare(a.erstellt) || a.slug.localeCompare(b.slug);
}

/** Datenbank-Zeile + Bilder → derselbe Typ, den die App heute aus recipes.ts bekommt. */
export function rowToRecipe(row: RecipeRow, images: ImageRow[]): StoredRecipe {
  const sorted = [...images].sort((a, b) => a.sortierung - b.sortierung || a.datei.localeCompare(b.datei));
  const profil = sorted.find((i) => i.rolle === "titel") ?? null;
  // Kartenbild (Karte, Raster, Detail-Kopf, Teilen): eigene Wahl, sonst das Profilbild
  const karte = (row.kartenbild && sorted.find((i) => i.datei.toLowerCase() === row.kartenbild!.toLowerCase())) || profil;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.beschreibung,
    category: row.kategorie,
    kcal: row.kalorien,
    protein: row.protein,
    carbs: row.kohlenhydrate,
    fat: row.fette,
    image: karte?.datei ?? null,
    imageIsAi: karte ? karte.rolle === "ki" || /_ki\.(jpe?g|png|webp)$/i.test(karte.datei) : false,
    imageExists: karte !== null,
    // Kartenbild vorn (wie recipes.ts), sonst Reihenfolge der Galerie
    images: karte ? [karte.datei, ...sorted.filter((i) => i !== karte).map((i) => i.datei)] : sorted.map((i) => i.datei),
    imageFocus: karte ? focusFromText(row.bildfokus) : null,
    created: row.erstellt,
    source: row.quelle_url,
    totalTime: row.gesamtzeit,
    portions: row.portionen,
    difficulty: row.schwierigkeit,
    ingredients: parseJson<IngredientGroup[]>(row.zutaten, []),
    steps: parseJson<string[]>(row.schritte, []),
    tips: parseJson<string[]>(row.tipps, []),
    tags: parseJson<string[]>(row.tags, []),
    status: row.status,
    platform: row.plattform,
    submittedBy: row.eingereicht_von,
    submittedName: row.eingereicht_name,
    cardImage: row.kartenbild,
    updatedAt: row.geaendert_am,
  };
}

/** Spalten, die update() setzen darf: Eingabefeld → Spalte (+ Umwandlung). */
const UPDATABLE: Record<string, [string, (v: unknown) => unknown]> = {
  name: ["name", (v) => String(v ?? "")],
  description: ["beschreibung", (v) => String(v ?? "")],
  category: ["kategorie", (v) => String(v ?? "Hauptgericht")],
  kcal: ["kalorien", (v) => v ?? null],
  protein: ["protein", (v) => v ?? null],
  carbs: ["kohlenhydrate", (v) => v ?? null],
  fat: ["fette", (v) => v ?? null],
  totalTime: ["gesamtzeit", (v) => v ?? null],
  portions: ["portionen", (v) => v ?? null],
  difficulty: ["schwierigkeit", (v) => v ?? null],
  ingredients: ["zutaten", json],
  steps: ["schritte", json],
  tips: ["tipps", json],
  tags: ["tags", json],
  created: ["erstellt", (v) => String(v ?? "")],
  statusReason: ["status_grund", (v) => v ?? null],
  source: ["quelle_url", (v) => v ?? null],
  sourceKey: ["quelle_key", (v) => v ?? null],
  platform: ["plattform", (v) => v ?? null],
  submittedName: ["eingereicht_name", (v) => v ?? null],
  check: ["pruefung", (v) => (v ? JSON.stringify(v) : null)],
  imageFocus: ["bildfokus", (v) => focusToText(v as [number, number] | null)],
  cardImage: ["kartenbild", (v) => v ?? null],
  obsidianFile: ["obsidian_datei", (v) => v ?? null],
  obsidianOriginal: ["obsidian_original", (v) => v ?? null],
  obsidianHash: ["obsidian_hash", (v) => v ?? null],
};

// ── Store ─────────────────────────────────────────────────────

export interface RecipeStore {
  db: Database.Database;
  list(opts?: ListOptions): StoredRecipe[];
  get(slug: string, opts?: ListOptions): StoredRecipe | null;
  getRow(slug: string): RecipeRow | null;
  insert(input: RecipeInput, images?: ImageInput[]): StoredRecipe;
  update(slug: string, patch: Partial<Omit<RecipeInput, "slug" | "status">>): StoredRecipe | null;
  setStatus(slug: string, status: RecipeStatus, opts?: { reason?: string | null; now?: string }): StoredRecipe | null;
  addImage(slug: string, image: ImageInput): ImageRow | null;
  /** Ersetzt alle Bilder einer Rolle (z. B. neues Titelbild aus n8n). */
  replaceImages(slug: string, rolle: ImageRole, image: ImageInput): ImageRow | null;
  /** Slug ändern (Platzhalter-Slug einer Einreichung → Slug aus dem Titel). */
  rename(slug: string, neu: string): boolean;
  images(recipeId: number): ImageRow[];
  findBySourceKey(key: string): RecipeRow[];
  /** Für die Dubletten-Prüfung: alle Namen außer abgelehnten. */
  titles(): { slug: string; name: string; status: RecipeStatus }[];
  count(status?: RecipeStatus): number;
  close(): void;
}

/** Öffnet (und migriert) eine Rezept-Datenbank. Ohne Pfad: DATA_DIR/rezepte.db. */
export function openRecipeStore(file?: string): RecipeStore {
  const path = file ?? join(env.DATA_DIR, "rezepte.db");
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrateRecipeSchema(db);

  const stImagesFor = db.prepare(`SELECT * FROM recipe_images WHERE recipe_id = ? ORDER BY sortierung, datei`);
  const stRowBySlug = db.prepare(`SELECT * FROM recipes WHERE slug = ?`);
  const stInsertImage = db.prepare(`
    INSERT INTO recipe_images (recipe_id, rolle, datei, sortierung, breite, hoehe, bytes, sha1, herkunft_url, erstellt_am)
    VALUES (@recipe_id, @rolle, @datei, @sortierung, @breite, @hoehe, @bytes, @sha1, @herkunft_url, @erstellt_am)
    ON CONFLICT(recipe_id, datei) DO UPDATE SET
      rolle = excluded.rolle, sortierung = excluded.sortierung, breite = excluded.breite,
      hoehe = excluded.hoehe, bytes = excluded.bytes, sha1 = excluded.sha1
  `);

  const images = (recipeId: number) => stImagesFor.all(recipeId) as ImageRow[];
  const getRow = (slug: string) => (slug ? ((stRowBySlug.get(slug) as RecipeRow | undefined) ?? null) : null);

  /** Darf dieser Betrachter das Rezept sehen? */
  const visible = (row: RecipeRow, opts?: ListOptions): boolean => {
    const s = opts?.status;
    if (s === "alle") return true;
    if (s) return (Array.isArray(s) ? s : [s]).includes(row.status);
    if (row.status === "veroeffentlicht") return true;
    return row.status === "eingereicht" && !!opts?.viewerGuestId && row.eingereicht_von === opts.viewerGuestId;
  };

  const insertImage = (recipeId: number, img: ImageInput, fallbackSort: number) =>
    stInsertImage.run({
      recipe_id: recipeId,
      rolle: img.rolle,
      datei: img.datei,
      sortierung: img.sortierung ?? fallbackSort,
      breite: img.breite ?? null,
      hoehe: img.hoehe ?? null,
      bytes: img.bytes ?? null,
      sha1: img.sha1 ?? null,
      herkunft_url: img.herkunftUrl ?? null,
      erstellt_am: img.now ?? new Date().toISOString(),
    });

  const store: RecipeStore = {
    db,

    list(opts) {
      // Alle Zeilen holen und in JS filtern/sortieren: ~200 Rezepte, und so ist die
      // Reihenfolge exakt die von scanRecipes() (localeCompare statt SQLite-Binärvergleich).
      const rows = (db.prepare(`SELECT * FROM recipes`).all() as RecipeRow[]).filter((r) => visible(r, opts));
      const imgs = db.prepare(`SELECT * FROM recipe_images ORDER BY sortierung, datei`).all() as ImageRow[];
      const byRecipe = new Map<number, ImageRow[]>();
      for (const i of imgs) {
        const list = byRecipe.get(i.recipe_id) ?? [];
        list.push(i);
        byRecipe.set(i.recipe_id, list);
      }
      rows.sort(compareRecipes);
      return rows.map((r) => rowToRecipe(r, byRecipe.get(r.id) ?? []));
    },

    get(slug, opts) {
      if (!slug || /[\\/]/.test(slug)) return null;
      const row = getRow(slug);
      if (!row || !visible(row, opts)) return null;
      return rowToRecipe(row, images(row.id));
    },

    getRow,

    insert(input, imgs = []) {
      const now = input.now ?? new Date().toISOString();
      const status = input.status ?? "eingereicht";
      const run = db.transaction(() => {
        const info = db.prepare(`
          INSERT INTO recipes (
            slug, name, beschreibung, kategorie, kalorien, protein, kohlenhydrate, fette,
            gesamtzeit, portionen, schwierigkeit, zutaten, schritte, tipps, tags, erstellt,
            status, status_grund, quelle_url, quelle_key, plattform, herkunft,
            eingereicht_von, eingereicht_name, pruefung, bildfokus, kartenbild,
            obsidian_datei, obsidian_original, obsidian_hash,
            erstellt_am, geaendert_am, freigegeben_am
          ) VALUES (
            @slug, @name, @beschreibung, @kategorie, @kalorien, @protein, @kohlenhydrate, @fette,
            @gesamtzeit, @portionen, @schwierigkeit, @zutaten, @schritte, @tipps, @tags, @erstellt,
            @status, @status_grund, @quelle_url, @quelle_key, @plattform, @herkunft,
            @eingereicht_von, @eingereicht_name, @pruefung, @bildfokus, @kartenbild,
            @obsidian_datei, @obsidian_original, @obsidian_hash,
            @now, @now, @freigegeben_am
          )
        `).run({
          slug: input.slug,
          name: input.name,
          beschreibung: input.description ?? "",
          kategorie: input.category || "Hauptgericht",
          kalorien: input.kcal ?? null,
          protein: input.protein ?? null,
          kohlenhydrate: input.carbs ?? null,
          fette: input.fat ?? null,
          gesamtzeit: input.totalTime ?? null,
          portionen: input.portions ?? null,
          schwierigkeit: input.difficulty ?? null,
          zutaten: json(input.ingredients),
          schritte: json(input.steps),
          tipps: json(input.tips),
          tags: json(input.tags),
          erstellt: input.created ?? now.slice(0, 10),
          status,
          status_grund: input.statusReason ?? null,
          quelle_url: input.source ?? null,
          quelle_key: input.sourceKey ?? null,
          plattform: input.platform ?? null,
          herkunft: input.origin ?? "admin",
          eingereicht_von: input.submittedBy ?? null,
          eingereicht_name: input.submittedName ?? null,
          pruefung: input.check ? JSON.stringify(input.check) : null,
          bildfokus: focusToText(input.imageFocus),
          kartenbild: input.cardImage ?? null,
          obsidian_datei: input.obsidianFile ?? null,
          obsidian_original: input.obsidianOriginal ?? null,
          obsidian_hash: input.obsidianHash ?? null,
          now,
          freigegeben_am: status === "veroeffentlicht" ? now : null,
        });
        const id = Number(info.lastInsertRowid);
        imgs.forEach((img, i) => insertImage(id, { ...img, now: img.now ?? now }, i));
        return id;
      });
      const id = run();
      const row = db.prepare(`SELECT * FROM recipes WHERE id = ?`).get(id) as RecipeRow;
      return rowToRecipe(row, images(id));
    },

    update(slug, patch) {
      const row = getRow(slug);
      if (!row) return null;
      const sets: string[] = [];
      const params: Record<string, unknown> = { id: row.id, now: patch.now ?? new Date().toISOString() };
      for (const [key, value] of Object.entries(patch)) {
        const map = UPDATABLE[key];
        if (!map || value === undefined) continue;
        sets.push(`${map[0]} = @${map[0]}`);
        params[map[0]] = map[1](value);
      }
      if (sets.length === 0) return rowToRecipe(row, images(row.id));
      db.prepare(`UPDATE recipes SET ${sets.join(", ")}, geaendert_am = @now WHERE id = @id`).run(params);
      return rowToRecipe(db.prepare(`SELECT * FROM recipes WHERE id = ?`).get(row.id) as RecipeRow, images(row.id));
    },

    setStatus(slug, status, opts) {
      if (!RECIPE_STATUSES.includes(status)) throw new Error(`Unbekannter Status: ${status}`);
      const row = getRow(slug);
      if (!row) return null;
      const now = opts?.now ?? new Date().toISOString();
      db.prepare(`
        UPDATE recipes SET status = @status, status_grund = @grund, geaendert_am = @now,
          freigegeben_am = CASE WHEN @status = 'veroeffentlicht' THEN COALESCE(freigegeben_am, @now) ELSE freigegeben_am END
        WHERE id = @id
      `).run({ id: row.id, status, grund: opts?.reason ?? null, now });
      return rowToRecipe(db.prepare(`SELECT * FROM recipes WHERE id = ?`).get(row.id) as RecipeRow, images(row.id));
    },

    addImage(slug, image) {
      const row = getRow(slug);
      if (!row) return null;
      const next = (db.prepare(`SELECT COALESCE(MAX(sortierung), -1) + 1 AS n FROM recipe_images WHERE recipe_id = ?`).get(row.id) as { n: number }).n;
      insertImage(row.id, image, next);
      db.prepare(`UPDATE recipes SET geaendert_am = ? WHERE id = ?`).run(image.now ?? new Date().toISOString(), row.id);
      return (db.prepare(`SELECT * FROM recipe_images WHERE recipe_id = ? AND datei = ?`).get(row.id, image.datei) as ImageRow) ?? null;
    },

    replaceImages(slug, rolle, image) {
      const row = getRow(slug);
      if (!row) return null;
      db.prepare(`DELETE FROM recipe_images WHERE recipe_id = ? AND rolle = ?`).run(row.id, rolle);
      return store.addImage(slug, { ...image, rolle });
    },

    rename(slug, neu) {
      const row = getRow(slug);
      if (!row || !neu || getRow(neu)) return false;
      db.prepare(`UPDATE recipes SET slug = ?, geaendert_am = ? WHERE id = ?`).run(neu, new Date().toISOString(), row.id);
      return true;
    },

    images,

    findBySourceKey(key) {
      if (!key) return [];
      return db.prepare(`SELECT * FROM recipes WHERE quelle_key = ?`).all(key) as RecipeRow[];
    },

    titles() {
      return db.prepare(`SELECT slug, name, status FROM recipes WHERE status != 'abgelehnt'`).all() as {
        slug: string; name: string; status: RecipeStatus;
      }[];
    },

    count(status) {
      const r = status
        ? (db.prepare(`SELECT COUNT(*) AS n FROM recipes WHERE status = ?`).get(status) as { n: number })
        : (db.prepare(`SELECT COUNT(*) AS n FROM recipes`).get() as { n: number });
      return r.n;
    },

    close() {
      db.close();
    },
  };
  return store;
}

// LAZY-Singleton für die App (wie db.ts: erst beim ersten Aufruf öffnen, nicht beim Import,
// sonst „database is locked“ während `next build`).
const globalForStore = globalThis as unknown as { rezepteStore?: RecipeStore };
export function recipeStore(): RecipeStore {
  if (!globalForStore.rezepteStore) globalForStore.rezepteStore = openRecipeStore();
  return globalForStore.rezepteStore;
}

/** Bilder-Ordner im Datenvolume. */
export function recipeImagesDir(dataDir: string = env.DATA_DIR): string {
  return join(dataDir, "bilder");
}
