/**
 * Einreichungen in die Rezept-Datenbank (seit 18.10.2026).
 *
 * Drei Wege, ein Ende:
 *  - Gast reicht in der App einen Link, ein Formular oder eine Sprachnachricht ein
 *    → /api/recipes/submit legt sofort einen Datensatz an (status „eingereicht“), bei
 *      Link und Sprache als Platzhalter (pruefung.phase „auslesen“, Slug `eingereicht-…`).
 *  - n8n liest aus (WF10b Link, WF14 Formular/Sprache) und schickt das fertige
 *    Kochbuch-Markdown an /api/admin/recipes/import → uebernehmen() füllt den Datensatz,
 *    prüft ihn (lib/submission.ts) und speichert das Bild.
 *  - Christians eigene Telegram-Links kommen ohne Platzhalter an und werden direkt
 *    veröffentlicht, wenn die Prüfung ok ist.
 * Freigabe danach im Admin (/admin, Reiter Einreichungen).
 */

import sharp from "sharp";
import { createHash } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { env } from "@/lib/env";
import { deriveTags, invalidateRecipeCache, parseRecipeMarkdown } from "@/lib/recipes";
import {
  recipeImagesDir, recipeStore,
  type Herkunft, type ImageInput, type Plattform, type RecipeInput, type StoredCheck, type StoredRecipe,
} from "@/lib/recipeStore";
import {
  KATEGORIEN, eindeutigerSlug, erkennePlattform, normalisiereZutaten, pruefeRezept, quelleKey, telegramText,
  type AusgelesenesRezept,
} from "@/lib/submission";

/** Slug-Vorsilbe, solange der Titel noch nicht feststeht. */
export const PLATZHALTER = "eingereicht-";

const MAX_BILD_BYTES = 15 * 1024 * 1024;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

/** Platzhalter, die nach so langer Zeit noch „auslesen“ melden, gelten als gescheitert (n8n-Fehler). */
export const AUSLESEN_MAX_MS = 20 * 60_000;

/** Phase für die Anzeige: hängengebliebenes Auslesen wird zu „fehlgeschlagen“. */
export function anzeigePhase(phase: StoredCheck["phase"] | undefined, erstelltAm: string): StoredCheck["phase"] {
  if (phase === "auslesen" && Date.now() - Date.parse(erstelltAm) > AUSLESEN_MAX_MS) return "fehlgeschlagen";
  return phase ?? "fertig";
}

export function leerePruefung(phase: StoredCheck["phase"], fehler: string[] = []): StoredCheck {
  return { ok: false, phase, fehler, hinweise: [], dubletten: [], geprueftAm: new Date().toISOString() };
}

// ── Bilder ────────────────────────────────────────────────────

export interface BildQuelle { url?: string | null; base64?: string | null; mimetype?: string | null; ki?: boolean }

/** Bild aus URL (n8n: Instagram-Standbild, og:image) oder Base64 (Formular, KI-Bild). */
export async function bildLaden(b: BildQuelle | null | undefined): Promise<Buffer | null> {
  if (!b) return null;
  if (b.base64) {
    const buf = Buffer.from(b.base64.replace(/^data:[^,]+,/, ""), "base64");
    return buf.length > 0 && buf.length <= MAX_BILD_BYTES ? buf : null;
  }
  if (b.url && /^https?:\/\//i.test(b.url)) {
    const res = await fetch(b.url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Bild-Download ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BILD_BYTES) throw new Error(`Bild zu groß oder leer (${buf.length} B)`);
    return buf;
  }
  return null;
}

/**
 * Speichert ein Bild als JPEG in DATA_DIR/bilder. Dateiname <slug>.jpg (KI: <slug>_KI.jpg);
 * ist der Name schon belegt, kommt eine Endung dazu: Cloudflare hält Bild-URLs lange im
 * Cache, ein überschriebenes Bild unter altem Namen bliebe dort alt.
 */
export async function bildSpeichern(slug: string, buf: Buffer, opts: { ki?: boolean; herkunftUrl?: string | null } = {}): Promise<ImageInput> {
  const { data, info } = await sharp(buf)
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const dir = recipeImagesDir();
  mkdirSync(dir, { recursive: true });
  const basis = `${slug}${opts.ki ? "_KI" : ""}`;
  let datei = `${basis}.jpg`;
  if (existsSync(join(dir, datei))) datei = `${basis}-${Date.now().toString(36)}.jpg`;
  writeFileSync(join(dir, datei), data);
  return {
    rolle: "titel",
    datei,
    breite: info.width,
    hoehe: info.height,
    bytes: data.length,
    sha1: createHash("sha1").update(data).digest("hex"),
    herkunftUrl: opts.herkunftUrl ?? null,
  };
}

// ── Platzhalter (Gast hat eingereicht, n8n liest noch aus) ─────

/** Gleiche Quelle schon im Kochbuch (veröffentlicht oder in Prüfung)? */
export function gleicheQuelle(url: string | null | undefined, ausser?: number) {
  const key = quelleKey(url);
  if (!key) return [];
  return recipeStore().findBySourceKey(key).filter((r) => r.status !== "abgelehnt" && r.id !== ausser);
}

export function platzhalterAnlegen(o: {
  herkunft: Herkunft;
  url?: string | null;
  guestId?: string | null;
  submittedName?: string | null;
  name?: string | null;
}): StoredRecipe {
  const store = recipeStore();
  const slug = eindeutigerSlug(`${PLATZHALTER}${Date.now().toString(36)}`, (s) => !!store.getRow(s));
  const r = store.insert({
    slug,
    name: (o.name ?? "").trim().slice(0, 120) || (o.herkunft === "sprache" ? "Rezept aus Sprachnachricht" : "Rezept aus Link"),
    status: "eingereicht",
    origin: o.herkunft,
    source: o.url ?? null,
    sourceKey: quelleKey(o.url) || null,
    platform: erkennePlattform(o.url),
    submittedBy: o.guestId ?? null,
    submittedName: o.submittedName ?? null,
    check: leerePruefung("auslesen"),
  });
  invalidateRecipeCache();
  return r;
}

/** n8n nicht erreichbar oder Auslesen gescheitert: Platzhalter sichtbar als „fehlgeschlagen“ markieren. */
export function alsFehlgeschlagen(slug: string, grund: string) {
  recipeStore().update(slug, { check: leerePruefung("fehlgeschlagen", [grund]) });
}

// ── Übernahme von n8n ─────────────────────────────────────────

export interface ImportAnfrage {
  /** Slug des Platzhalters aus /api/recipes/submit; fehlt bei Christians Telegram-Links */
  einreichung?: string | null;
  herkunft?: Herkunft;
  quelleUrl?: string | null;
  plattform?: Plattform | null;
  eingereichtVon?: string | null;
  eingereichtName?: string | null;
  direktVeroeffentlichen?: boolean;
  /** Kochbuch-Markdown wie früher für den Vault (bevorzugt) … */
  markdown?: string | null;
  /** … oder die Felder einzeln */
  rezept?: AusgelesenesRezept | null;
  slugVorschlag?: string | null;
  bild?: BildQuelle | null;
  /** n8n meldet: Auslesen gescheitert (dann nur Platzhalter markieren) */
  fehler?: string | null;
}

export interface ImportErgebnis { status: number; body: Record<string, unknown> }

const heute = () => new Date().toISOString().slice(0, 10);

export async function uebernehmen(a: ImportAnfrage): Promise<ImportErgebnis> {
  const store = recipeStore();
  const row = a.einreichung ? store.getRow(a.einreichung) : null;
  if (a.einreichung && !row) return { status: 404, body: { error: "einreichung_unbekannt", einreichung: a.einreichung } };

  if (a.fehler) {
    if (row) alsFehlgeschlagen(row.slug, String(a.fehler).slice(0, 300));
    invalidateRecipeCache();
    return { status: 200, body: { ok: true, slug: row?.slug ?? null, status: "fehlgeschlagen", telegramText: `Rezept konnte nicht ausgelesen werden: ${String(a.fehler).slice(0, 200)}${a.quelleUrl ? `\n${a.quelleUrl}` : ""}` } };
  }

  // 1) Felder
  let rezept: AusgelesenesRezept;
  let quelleAusMarkdown: string | null = null;
  if (a.markdown) {
    let p;
    try {
      p = parseRecipeMarkdown(String(a.markdown), "import", null);
    } catch (err) {
      return { status: 400, body: { error: "markdown_kaputt", detail: err instanceof Error ? err.message : String(err) } };
    }
    quelleAusMarkdown = p.source;
    rezept = {
      name: p.name === "import" ? "" : p.name,
      description: p.description, category: p.category,
      kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat,
      totalTime: p.totalTime, portions: p.portions, difficulty: p.difficulty,
      ingredients: p.ingredients, steps: p.steps, tips: p.tips,
    };
  } else if (a.rezept) {
    rezept = a.rezept;
  } else {
    return { status: 400, body: { error: "rezept_fehlt" } };
  }
  const name = (rezept.name ?? "").trim().slice(0, 120);
  if (!name) return { status: 400, body: { error: "titel_fehlt" } };

  // 2) Quelle und Dubletten
  const url = a.quelleUrl || quelleAusMarkdown || row?.quelle_url || null;
  const gleiche = gleicheQuelle(url, row?.id);
  if (!row && gleiche.length) {
    const d = gleiche[0];
    return { status: 409, body: { error: "schon_da", slug: d.slug, name: d.name, status: d.status, telegramText: `Gibt es schon im Kochbuch: „${d.name}“\n${env.SITE_URL}/rezept/${d.slug}` } };
  }

  // 3) Bild
  let buf: Buffer | null = null;
  const bildHinweis: string[] = [];
  try {
    buf = await bildLaden(a.bild);
  } catch (err) {
    bildHinweis.push(`Bild nicht geladen: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4) Slug: Platzhalter bekommt den Titel-Slug, ein schon benannter Datensatz behält seinen
  const zielSlug = row && !row.slug.startsWith(PLATZHALTER)
    ? row.slug
    : eindeutigerSlug(a.slugVorschlag || name, (s) => s !== row?.slug && !!store.getRow(s));

  // 5) Prüfen
  const hatBildSchon = row ? store.images(row.id).some((i) => i.rolle === "titel") : false;
  const pruefung = pruefeRezept({ ...rezept, name }, {
    gleicheQuelle: gleiche.map((g) => ({ slug: g.slug, name: g.name })),
    titel: store.titles().filter((t) => t.slug !== row?.slug),
    hatBild: !!buf || hatBildSchon,
    eigenerSlug: row?.slug,
  });
  pruefung.hinweise.push(...bildHinweis);

  // 6) Speichern
  const gruppen = normalisiereZutaten(rezept.ingredients);
  const description = (rezept.description ?? "").trim().slice(0, 400);
  const felder: Omit<RecipeInput, "slug"> = {
    name,
    description,
    category: rezept.category && (KATEGORIEN as readonly string[]).includes(rezept.category) ? rezept.category : "Hauptgericht",
    kcal: rezept.kcal ?? null,
    protein: rezept.protein ?? null,
    carbs: rezept.carbs ?? null,
    fat: rezept.fat ?? null,
    totalTime: rezept.totalTime ?? null,
    portions: rezept.portions != null ? String(rezept.portions) : null,
    difficulty: rezept.difficulty ?? null,
    ingredients: gruppen,
    steps: (rezept.steps ?? []).map((s) => s.trim()).filter(Boolean),
    tips: (rezept.tips ?? []).map((s) => s.trim()).filter(Boolean),
    tags: deriveTags(`${name} ${description} ${gruppen.flatMap((g) => [g.group, ...g.items]).join(" ")}`),
    source: url,
    sourceKey: quelleKey(url) || null,
    platform: a.plattform ?? erkennePlattform(url),
    check: pruefung,
  };
  if (row) {
    if (zielSlug !== row.slug) store.rename(row.slug, zielSlug);
    store.update(zielSlug, felder);
  } else {
    store.insert({
      slug: zielSlug,
      ...felder,
      created: heute(),
      status: "eingereicht",
      origin: a.herkunft ?? "link",
      submittedBy: a.eingereichtVon ?? null,
      submittedName: a.eingereichtName ?? null,
    });
  }
  if (buf) {
    try {
      const img = await bildSpeichern(zielSlug, buf, { ki: !!a.bild?.ki, herkunftUrl: a.bild?.url ?? null });
      store.replaceImages(zielSlug, "titel", img);
    } catch (err) {
      pruefung.hinweise.push(`Bild nicht lesbar: ${err instanceof Error ? err.message : String(err)}`);
      store.update(zielSlug, { check: pruefung });
    }
  }

  // 7) Status
  const direkt = !!a.direktVeroeffentlichen && pruefung.ok;
  if (direkt) store.setStatus(zielSlug, "veroeffentlicht");
  invalidateRecipeCache();

  const final = store.getRow(zielSlug)!;
  const adminUrl = `${env.SITE_URL}/admin#einreichungen`;
  const text = direkt
    ? `Neu im Kochbuch: „${name}“\n${env.SITE_URL}/rezept/${zielSlug}`
    : telegramText({ name, eingereichtVon: final.eingereicht_name, pruefung, adminUrl });
  return {
    status: 200,
    body: { ok: true, slug: zielSlug, status: final.status, pruefung, adminUrl, telegramText: text },
  };
}
