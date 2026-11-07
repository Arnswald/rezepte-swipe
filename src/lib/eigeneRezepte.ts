/**
 * Eigene Rezepte der Nutzer (07.11.2026).
 *
 * Ein Nutzer legt in der App ein Rezept an (Formular, optional „aus Link/Text einfügen“).
 * Es landet direkt in der Rezept-Datenbank, `privat = 1`, ohne n8n und ohne Freigabe:
 *  - sehen dürfen es der Ersteller (eingereicht_von) und seine Verbundenen („Zu zweit“),
 *  - bearbeiten und ausblenden nur der Ersteller,
 *  - gelöscht wird nie, „Löschen“ in der App heißt ausblenden (ausgeblendet_am).
 * Nicht im öffentlichen Stapel, nicht im Vault-Export, nicht in Trending.
 */

import { lookup } from "dns/promises";
import { isIP } from "net";
import { getConnections } from "@/lib/db";
import { deriveTags, invalidateRecipeCache, parseRecipeMarkdown, publicRecipe, type IngredientGroup, type Recipe } from "@/lib/recipes";
import { recipeStore, type StoredRecipe } from "@/lib/recipeStore";
import { bildSpeichern } from "@/lib/einreichung";
import { eindeutigerSlug, KATEGORIEN, normalisiereZutaten } from "@/lib/submission";

/** Kategorien, die das Formular anbietet (die vier Filtergruppen der App). */
export const EIGENE_KATEGORIEN = ["Frühstück", "Hauptgericht", "Snack", "Dessert"] as const;

export interface EigenesRezept extends Recipe {
  own: { mine: boolean; ownerName: string | null; updatedAt: string };
}

export interface EigeneFelder {
  name: string;
  description?: string;
  category?: string;
  totalTime?: string | null;
  portions?: string | null;
  ingredients: string[];
  steps: string[];
  tips?: string[];
  source?: string | null;
}

/** Wer darf die eigenen Rezepte von wem sehen: ich + alle, mit denen ich verbunden bin. */
export function sichtbareErsteller(guestId: string): string[] {
  let partner: string[] = [];
  try { partner = getConnections(guestId).map((g) => g.guest_id); } catch { /* keine Verbindungen */ }
  return [guestId, ...partner];
}

function alsEigenes(r: StoredRecipe, guestId: string): EigenesRezept {
  return { ...publicRecipe(r), own: { mine: r.submittedBy === guestId, ownerName: r.submittedName, updatedAt: r.updatedAt } };
}

/** Alle eigenen Rezepte, die dieser Gast sehen darf (eigene zuerst, dann die der Verbundenen). */
export function eigeneFuer(guestId: string): EigenesRezept[] {
  const store = recipeStore();
  const ids = sichtbareErsteller(guestId);
  const ph = ids.map(() => "?").join(",");
  const slugs = store.db
    .prepare(`SELECT slug FROM recipes WHERE privat = 1 AND ausgeblendet_am IS NULL AND eingereicht_von IN (${ph}) ORDER BY erstellt_am DESC`)
    .all(...ids) as { slug: string }[];
  return slugs
    .map((s) => store.get(s.slug, { viewerGuestIds: ids }))
    .filter((r): r is StoredRecipe => !!r)
    .map((r) => alsEigenes(r, guestId))
    .sort((a, b) => Number(b.own.mine) - Number(a.own.mine));
}

const zeilen = (l: string[] | undefined, max: number, len: number) =>
  (l ?? []).map((s) => String(s).replace(/\s+/g, " ").trim().slice(0, len)).filter(Boolean).slice(0, max);

/** Eingaben säubern. Fehlertext oder bereinigte Felder. */
export function pruefeEigene(f: Partial<EigeneFelder>): { fehler: string } | { felder: EigeneFelder } {
  const name = String(f.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return { fehler: "Gib dem Rezept einen Namen." };
  const ingredients = zeilen(f.ingredients, 80, 200);
  const steps = zeilen(f.steps, 60, 1200).map((s) => s.replace(/^\d+[.)]\s*/, ""));
  if (ingredients.length === 0 && steps.length === 0) return { fehler: "Zutaten oder Schritte fehlen." };
  const cat = String(f.category ?? "");
  return {
    felder: {
      name,
      description: String(f.description ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
      category: (KATEGORIEN as readonly string[]).includes(cat) ? cat : "Hauptgericht",
      totalTime: String(f.totalTime ?? "").trim().slice(0, 40) || null,
      portions: String(f.portions ?? "").trim().slice(0, 20) || null,
      ingredients,
      steps,
      tips: zeilen(f.tips, 20, 600),
      source: /^https?:\/\//i.test(String(f.source ?? "")) ? String(f.source).trim().slice(0, 400) : null,
    },
  };
}

function datenAus(f: EigeneFelder) {
  const gruppen: IngredientGroup[] = normalisiereZutaten(f.ingredients);
  return {
    name: f.name,
    description: f.description ?? "",
    category: f.category ?? "Hauptgericht",
    totalTime: f.totalTime ?? null,
    portions: f.portions ?? null,
    ingredients: gruppen,
    steps: f.steps,
    tips: f.tips ?? [],
    tags: deriveTags(`${f.name} ${f.description ?? ""} ${f.ingredients.join(" ")}`),
    source: f.source ?? null,
  };
}

export type SpeichernErgebnis = { status: 200; rezept: EigenesRezept } | { status: 400 | 403 | 404; error: string };

/** Neu anlegen (ohne slug) oder bearbeiten (mit slug, nur der Ersteller). */
export async function eigenesSpeichern(o: {
  guestId: string;
  name: string;
  slug?: string | null;
  felder: EigeneFelder;
  bild?: Buffer | null;
}): Promise<SpeichernErgebnis> {
  const store = recipeStore();
  const daten = datenAus(o.felder);
  let slug: string;
  if (o.slug) {
    const row = store.getRow(o.slug);
    if (!row || !row.privat || row.ausgeblendet_am) return { status: 404, error: "Rezept nicht gefunden." };
    if (row.eingereicht_von !== o.guestId) return { status: 403, error: "Nur wer das Rezept angelegt hat, kann es ändern." };
    slug = row.slug;
    store.update(slug, daten);
  } else {
    slug = eindeutigerSlug(o.felder.name, (s) => !!store.getRow(s));
    store.insert({
      slug,
      ...daten,
      status: "veroeffentlicht",
      origin: "formular",
      privat: true,
      submittedBy: o.guestId,
      submittedName: o.name.slice(0, 80) || null,
    });
  }
  if (o.bild) {
    const img = await bildSpeichern(slug, o.bild);
    store.replaceImages(slug, "titel", img);
  }
  invalidateRecipeCache();
  const r = store.get(slug, { viewerGuestIds: [o.guestId] });
  if (!r) return { status: 404, error: "Rezept nicht gefunden." };
  return { status: 200, rezept: alsEigenes(r, o.guestId) };
}

/** Ausblenden statt löschen. Nur der Ersteller. */
export function eigenesAusblenden(guestId: string, slug: string, aus = true): { status: 200 | 403 | 404; error?: string } {
  const store = recipeStore();
  const row = store.getRow(slug);
  if (!row || !row.privat) return { status: 404, error: "Rezept nicht gefunden." };
  if (row.eingereicht_von !== guestId) return { status: 403, error: "Nur wer das Rezept angelegt hat, kann es ausblenden." };
  store.setHidden(slug, aus);
  invalidateRecipeCache();
  return { status: 200 };
}

// ── Aus Text oder Link einfügen ───────────────────────────────

export interface Vorschlag {
  name: string;
  description: string;
  category: string;
  totalTime: string;
  portions: string;
  ingredients: string[];
  steps: string[];
  tips: string[];
  source: string;
  imageUrl: string | null;
}

const leer = (): Vorschlag => ({
  name: "", description: "", category: "Hauptgericht", totalTime: "", portions: "",
  ingredients: [], steps: [], tips: [], source: "", imageUrl: null,
});

const ZUTATEN = /^(zutaten|ingredients|einkaufsliste|du brauchst)\b/i;
const SCHRITTE = /^(zubereitung|anleitung|so geht'?s|schritte|instructions|directions|method|preparation)/i;
const TIPPS = /^(tipps?|hinweise?|notes?|tips?)\b/i;
const ZEIT = /(\d+(?:[.,]\d+)?)\s*(min(?:uten)?|std\.?|stunden?|h)\b/i;
const PORT = /(\d+)\s*(portionen|personen|servings|stück)\b/i;

function kategorieRaten(text: string): string {
  const t = text.toLowerCase();
  if (/frühstück|breakfast|porridge|müsli|overnight|pancake|omelett/.test(t)) return "Frühstück";
  if (/dessert|kuchen|torte|cookie|keks|brownie|mousse|eis\b|tiramisu|pudding/.test(t)) return "Dessert";
  if (/snack|dip\b|fingerfood|riegel|bites/.test(t)) return "Snack";
  return "Hauptgericht";
}

/** Freitext (aus Notizen, WhatsApp, Webseite kopiert) oder Kochbuch-Markdown → Formularfelder. */
export function rezeptAusText(raw: string): Vorschlag {
  const text = String(raw ?? "").replace(/\r\n?/g, "\n").slice(0, 30_000);
  // Kochbuch-Markdown (Frontmatter oder die bekannten Abschnitte): der vorhandene Parser
  if (/^---\n[\s\S]*?\n---/.test(text) || /##\s*(🛒|👨‍🍳)/.test(text)) {
    try {
      const p = parseRecipeMarkdown(text, "eingefuegt", null);
      return {
        ...leer(),
        name: p.name === "eingefuegt" ? "" : p.name,
        description: p.description,
        category: (EIGENE_KATEGORIEN as readonly string[]).includes(p.category) ? p.category : kategorieRaten(`${p.name} ${p.category}`),
        totalTime: p.totalTime ?? "",
        portions: p.portions ?? "",
        ingredients: p.ingredients.flatMap((g) => g.items),
        steps: p.steps,
        tips: p.tips,
        source: p.source ?? "",
      };
    } catch { /* weiter mit Freitext */ }
  }
  const v = leer();
  const lines = text.split("\n").map((l) => l.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim());
  let teil: "kopf" | "zutaten" | "schritte" | "tipps" = "kopf";
  const kopf: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    const kurz = line.replace(/[:：]\s*$/, "");
    if (kurz.length < 40 && ZUTATEN.test(kurz)) { teil = "zutaten"; continue; }
    if (kurz.length < 40 && SCHRITTE.test(kurz)) { teil = "schritte"; continue; }
    if (kurz.length < 40 && TIPPS.test(kurz)) { teil = "tipps"; continue; }
    const item = line.replace(/^[-*•▢☐□]\s*/, "").replace(/^\[[ xX]?\]\s*/, "");
    if (teil === "zutaten") v.ingredients.push(item);
    else if (teil === "schritte") v.steps.push(item.replace(/^(schritt\s*)?\d+[.):]\s*/i, ""));
    else if (teil === "tipps") v.tips.push(item);
    else kopf.push(line);
  }
  // Ohne Überschriften: Aufzählungen als Zutaten, nummerierte Zeilen als Schritte
  if (v.ingredients.length === 0 && v.steps.length === 0) {
    const rest: string[] = [];
    for (const l of kopf.slice(1)) {
      if (/^\d+[.)]\s+/.test(l)) v.steps.push(l.replace(/^\d+[.)]\s+/, ""));
      else if (/^[-*•]\s+/.test(l) || /^\d+([.,]\d+)?\s*(g|kg|ml|l|el|tl|stk|prise|bund|dose|becher|pck)\b/i.test(l)) v.ingredients.push(l.replace(/^[-*•]\s+/, ""));
      else rest.push(l);
    }
    kopf.splice(1, kopf.length - 1, ...rest);
  }
  const url = text.match(/https?:\/\/[^\s)]+/i)?.[0] ?? "";
  const titel = kopf.find((l) => !/^https?:\/\//i.test(l)) ?? "";
  v.name = titel.length <= 90 ? titel : "";
  v.description = kopf.filter((l) => l !== titel && !/^https?:\/\//i.test(l) && !ZEIT.test(l) && !PORT.test(l)).join(" ").slice(0, 400);
  const zeit = text.match(ZEIT);
  if (zeit) v.totalTime = `${zeit[1]} ${/^(std|stunde|h)/i.test(zeit[2]) ? "Std" : "Min"}`;
  const port = text.match(PORT);
  if (port) v.portions = port[1];
  v.category = kategorieRaten(`${v.name} ${v.description}`);
  v.source = url;
  return v;
}

/** ISO-8601-Dauer (PT1H30M) → „1 Std 30 Min“. */
export function dauerLesbar(iso: unknown): string {
  const m = String(iso ?? "").match(/^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m || (!m[1] && !m[2])) return "";
  return [m[1] && `${Number(m[1])} Std`, m[2] && Number(m[2]) > 0 && `${Number(m[2])} Min`].filter(Boolean).join(" ");
}

const html2text = (s: unknown) =>
  String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();

function schritteAus(ins: unknown): string[] {
  if (!ins) return [];
  if (typeof ins === "string") return ins.split(/\n+|<br\s*\/?>|<\/p>/i).map(html2text).filter(Boolean);
  if (Array.isArray(ins)) return ins.flatMap(schritteAus);
  if (typeof ins === "object") {
    const o = ins as Record<string, unknown>;
    if (o.itemListElement) return schritteAus(o.itemListElement);
    if (o.text) return [html2text(o.text)];
    if (o.name) return [html2text(o.name)];
  }
  return [];
}

function bildAus(img: unknown): string | null {
  if (!img) return null;
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return bildAus(img[0]);
  if (typeof img === "object") return bildAus((img as Record<string, unknown>).url);
  return null;
}

/** schema.org/Recipe aus den JSON-LD-Blöcken einer Seite (Chefkoch, Blogs, fast alle Rezeptseiten). */
export function rezeptAusHtml(html: string, url: string): Vorschlag | null {
  const kandidaten: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { kandidaten.push(JSON.parse(m[1].trim())); } catch { /* kaputtes JSON überspringen */ }
  }
  const flach: Record<string, unknown>[] = [];
  const sammle = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(sammle);
    else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      flach.push(o);
      if (o["@graph"]) sammle(o["@graph"]);
    }
  };
  kandidaten.forEach(sammle);
  const r = flach.find((o) => {
    const t = o["@type"];
    return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
  });
  if (!r) return null;
  const yieldRaw = Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield;
  const cat = Array.isArray(r.recipeCategory) ? r.recipeCategory.join(" ") : String(r.recipeCategory ?? "");
  const name = html2text(r.name).slice(0, 120);
  const description = html2text(r.description).slice(0, 400);
  return {
    ...leer(),
    name,
    description,
    category: kategorieRaten(`${cat} ${name}`),
    totalTime: dauerLesbar(r.totalTime) || dauerLesbar(r.cookTime) || "",
    portions: String(yieldRaw ?? "").match(/\d+/)?.[0] ?? "",
    ingredients: (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : []).map(html2text).filter(Boolean),
    steps: schritteAus(r.recipeInstructions),
    source: url,
    imageUrl: bildAus(r.image),
  };
}

// ── Sicher von außen laden (keine Adressen im eigenen Netz) ───

function privateAdresse(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return privateAdresse(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/**
 * Lädt eine öffentliche URL (http/https, Port 80/443), höchstens `maxBytes`. Folgt bis zu drei
 * Weiterleitungen und prüft vor jedem Schritt, dass der Name nicht auf eine interne Adresse
 * zeigt (der Server steht im Heimnetz, die App ist öffentlich).
 */
export async function sicherLaden(url: string, maxBytes: number, accept = "text/html"): Promise<{ body: Buffer; type: string; url: string }> {
  let ziel = url;
  for (let i = 0; i < 4; i++) {
    const u = new URL(ziel);
    if (!/^https?:$/.test(u.protocol)) throw new Error("Nur http- und https-Links.");
    if (u.port && u.port !== "80" && u.port !== "443") throw new Error("Link nicht erlaubt.");
    const adressen = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true });
    if (adressen.length === 0 || adressen.some((a) => privateAdresse(a.address))) throw new Error("Link nicht erlaubt.");
    const res = await fetch(u, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", Accept: accept },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      ziel = new URL(res.headers.get("location")!, u).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`Seite antwortet mit ${res.status}.`);
    const reader = res.body.getReader();
    const teile: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > maxBytes) { await reader.cancel(); throw new Error("Seite zu groß."); }
      teile.push(value);
    }
    return { body: Buffer.concat(teile), type: res.headers.get("content-type") ?? "", url: u.toString() };
  }
  throw new Error("Zu viele Weiterleitungen.");
}

/** Link → Formularfelder. Instagram/TikTok liefern ohne Anmeldung kein Rezept, dann bleibt nur der Text. */
export async function rezeptAusLink(url: string): Promise<Vorschlag> {
  const { body, url: final } = await sicherLaden(url, 3 * 1024 * 1024);
  const html = body.toString("utf-8");
  const v = rezeptAusHtml(html, final);
  if (v && (v.ingredients.length || v.steps.length)) return v;
  // Kein schema.org-Rezept: Titel und Beschreibung aus den Meta-Angaben, Rest füllt man selbst
  const meta = (p: string) =>
    html2text(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ?? "");
  return {
    ...leer(),
    name: (meta("og:title") || html2text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])).slice(0, 120),
    description: meta("og:description").slice(0, 400),
    source: final,
    imageUrl: meta("og:image") || null,
  };
}
