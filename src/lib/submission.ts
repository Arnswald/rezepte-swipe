/**
 * Einreichung per Link — Prüflogik (Entwurf, 18.10.2026) — NOCH NICHT VERDRAHTET.
 *
 * Reine Funktionen ohne Datenbank- oder Netzwerkzugriff: Plattform erkennen, Quelle
 * normalisieren, Slug bilden, ausgelesenes Rezept auf Plausibilität prüfen, Dubletten finden.
 * Die Routen (siehe API-Verträge unten) holen sich die Vergleichsdaten aus lib/recipeStore.ts
 * und rufen dann pruefeRezept().
 *
 * ── Wer liest den Link aus? Empfehlung: n8n (WF10b umbauen) ─────────────────────────────
 *
 *  WF10b kann heute schon alles, was die App bräuchte: Instagram über den Apify-Actor
 *  `apify~instagram-scraper` (Caption, Video-URL, Standbild), Transkript über AssemblyAI,
 *  Pinterest (Pin → Ziel-Website) und beliebige Websites (JSON-LD „Recipe“, og:image) per
 *  HTTP, dann Claude Sonnet 4.6 mit dem Kochbuch-Prompt (Kategorie-Enum, Makros pro
 *  Portion, metrische Einheiten). Umbau: nur das Ende ändern. Statt „Rezept Schreiben“ /
 *  „Bild speichern“ in den Vault ein HTTP-Request an POST /api/admin/recipes/import
 *  (Vertrag unten), Telegram danach mit dem Text aus der Antwort. Dazu ein TikTok-Zweig
 *  (heute landet TikTok im Web-Zweig und scheitert meist am HTML).
 *
 *  Direkt in der App hieße: Apify-Token, AssemblyAI- und Anthropic-Schlüssel in den
 *  öffentlichen Container, Poll-Schleifen für Apify/AssemblyAI in Next-Routen nachbauen,
 *  Claude-Prompt doppelt pflegen. Die API-Kosten sind in beiden Fällen dieselben.
 *
 *  Kosten pro Link (Stand 10/2026, Listenpreise):
 *   - Apify Instagram-Scraper: 2,70 $ / 1.000 Ergebnisse (Free-Plan) → ≈ 0,3 Cent je Reel;
 *     die 5 $ Freiguthaben im Monat reichen für ~1.800 Reels
 *   - Apify TikTok-Scraper (clockworks): ab 1,70 $ / 1.000, Video-Download kostet extra
 *   - AssemblyAI: ein 1-Minuten-Reel liegt im Bereich von Zehntel-Cent
 *   - Claude Sonnet 4.6 (3 $ / 15 $ je Mio. Tokens): ~6k rein + ~2k raus ≈ 5 Cent
 *   - Website/Pinterest: nur Claude, ≈ 5 Cent
 *   → grob 5–6 Cent je Einreichung, egal ob n8n oder App.
 *
 * ── Ablauf (Zielbild) ─────────────────────────────────────────────────────────────────
 *
 *   Gast tippt Link ein → POST /api/recipes/submit-link
 *     → App legt sofort einen Datensatz an: status „eingereicht“, pruefung.phase „auslesen“,
 *       eingereicht_von = guestId. Der Gast sieht seine Einreichung damit sofort im Profil.
 *     → App POSTet an N8N_LINK_WEBHOOK { einreichung: slug, url, plattform }
 *   n8n liest aus → POST /api/admin/recipes/import (Server-Schlüssel)
 *     → App prüft (pruefeRezept), speichert Felder + Bild, phase „fertig“
 *     → Antwort enthält telegramText + adminUrl → n8n schickt Telegram an Christian
 *   Christian öffnet /admin → „Freigeben“ (ein Tipp) → status „veroeffentlicht“
 *
 * ── API-Verträge (Entwurf) ──────────────────────────────────────────────────────────────
 *
 *  Auth:
 *   - Gäste: guestId im Body wie heute (Bearer im localStorage).
 *   - Admin-Oberfläche: Header `x-admin-pin` (checkAdminPin aus lib/guard.ts, mit Sperre).
 *   - Server zu Server (n8n, Mac-Runner): Header `x-server-key` = env RECIPE_SERVER_KEY
 *     (≥ 32 Zeichen Zufall, zeitkonstanter Vergleich wie checkAdminPin). NICHT den
 *     ADMIN_PIN dafür nehmen: kurz, und die Fehlversuch-Sperre gilt je IP, n8n und
 *     Cloudflare-Tunnel teilen sich aber Adressen.
 *
 *  1) POST /api/recipes/submit-link                         (Gast)
 *     Request:  { guestId: string, name?: string, url: string, notiz?: string }
 *     201:      { ok: true, slug: string, status: "eingereicht", phase: "auslesen" }
 *     409:      { error: "schon_da", slug: string, name: string }   // gleiche Quelle schon im Kochbuch
 *     400:      { error: "keine_url" | "unbekannter_gast" }
 *     429:      Bremse wie Codes (z. B. 10 Einreichungen / Stunde / guestId)
 *
 *  2) POST <N8N_LINK_WEBHOOK>                               (App → n8n, WF10b)
 *     Request:  { type: "recipe-link", einreichung: slug, url, plattform, submittedBy: name,
 *                 callbackUrl: "https://rezepte.christianarns.de/api/admin/recipes/import" }
 *
 *  3) POST /api/admin/recipes/import                        (n8n → App, x-server-key)
 *     Request:  {
 *       einreichung?: string,          // Slug aus 1); fehlt bei Telegram-Links von Christian
 *       herkunft: "link" | "formular" | "sprache",
 *       quelleUrl?: string, plattform?: Plattform,
 *       eingereichtVon?: string,       // guestId (nur ohne einreichung nötig)
 *       direktVeroeffentlichen?: boolean, // true bei Christians eigenem Telegram-Link
 *       rezept: AusgelesenesRezept,    // siehe Typ unten
 *       bild?: { url?: string, base64?: string, mimetype?: string },
 *       roh?: { caption?: string, transkript?: string }   // nur fürs Admin-Detail, gekürzt
 *     }
 *     200:      { ok: true, slug, status, pruefung: StoredCheck, adminUrl, telegramText }
 *     409:      { error: "schon_da", slug, name }          // Dublette über quelle_key
 *     422:      { error: "unplausibel", pruefung }          // wird trotzdem gespeichert (phase fertig),
 *                                                          // Christian entscheidet im Admin
 *
 *  4) GET  /api/admin/recipes?status=eingereicht            (x-admin-pin)
 *     200:      { recipes: (StoredRecipe & { pruefung: StoredCheck | null })[] }
 *
 *  5) POST /api/admin/recipes/<slug>/status                 (x-admin-pin) — der eine Tipp
 *     Request:  { status: "veroeffentlicht" | "abgelehnt" | "eingereicht", grund?: string }
 *     200:      { ok: true, recipe: StoredRecipe }
 *
 *  6) PATCH /api/admin/recipes/<slug>                       (x-admin-pin) — Korrekturen
 *     Request:  Partial<RecipeInput> (ohne slug/status)
 *
 *  7) GET  /api/admin/recipes/export?seit=<ISO>             (x-server-key, Mac-Runner)
 *     200:      { jetzt: ISO, rezepte: { slug, geaendertAm, markdown, bilder: string[] }[] }
 *     → Mac schreibt neue/geänderte Rezepte als Markdown in den Vault (kein Schreib-Mount).
 *
 *  8) GET  /api/admin/backup                                (x-server-key, Mac-Runner)
 *     200:      application/gzip — SQLite-Kopie über better-sqlite3 db.backup()
 *     GET  /api/admin/bilder?seit=<ISO>  → Liste { datei, bytes, sha1 } für den Bilder-Abgleich,
 *     Originale über /api/recipes/image/<datei>?orig=1 (nur mit x-server-key).
 */

import type { IngredientGroup } from "@/lib/recipes";
import type { Plattform, StoredCheck } from "@/lib/recipeStore";

// ── Plattform & Quelle ────────────────────────────────────────

/** Erste http(s)-URL aus einem Text, ohne angehängte Satzzeichen. */
export function extrahiereUrl(text: string): string | null {
  const m = (text ?? "").match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[).,\]!?;:]+$/, "") : null;
}

/** Plattform aus der URL. null, wenn es keine http(s)-URL ist. */
export function erkennePlattform(url: string | null | undefined): Plattform | null {
  if (!url) return null;
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    host = u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  if (host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am") return "instagram";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok"; // auch vm./vt.tiktok.com
  if (/^([a-z]{2}\.)?pinterest\.[a-z.]+$/.test(host) || host === "pin.it") return "pinterest";
  return "web";
}

/**
 * Vergleichsschlüssel einer Quelle (für Dubletten). Für Instagram und Websites identisch mit
 * sourceKey() aus recipes.ts (damit Altbestand und neue Einreichungen zusammenpassen), dazu
 * TikTok per Video-ID und Pinterest per Pin-ID.
 */
export function quelleKey(u: string | null | undefined): string {
  if (!u) return "";
  const ig = u.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (ig) return `ig:${ig[1]}`;
  const tt = u.match(/tiktok\.com\/(?:@[^/]+\/)?(?:video|photo)\/(\d+)/i);
  if (tt) return `tt:${tt[1]}`;
  const pin = u.match(/pinterest\.[a-z.]+\/pin\/(?:[^/]*--)?(\d+)/i);
  if (pin) return `pin:${pin[1]}`;
  return u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
}

// ── Slug ──────────────────────────────────────────────────────

/** Slug wie im Kochbuch (ä→ae …, Bindestriche). Gleiche Regel wie api/recipes/submit. */
export function slugify(name: string): string {
  const umlaut: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };
  let s = (name ?? "").toLowerCase().replace(/[äöüß]/g, (c) => umlaut[c] ?? c);
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return s || "rezept";
}

/** Freien Slug finden: basis, basis-2, basis-3 … */
export function eindeutigerSlug(basis: string, vergeben: (slug: string) => boolean): string {
  const b = slugify(basis);
  if (!vergeben(b)) return b;
  for (let i = 2; i < 1000; i++) if (!vergeben(`${b}-${i}`)) return `${b}-${i}`;
  return `${b}-${Date.now().toString(36)}`;
}

// ── Ausgelesenes Rezept ───────────────────────────────────────

export const KATEGORIEN = [
  "Frühstück", "Hauptgericht", "Salat", "Suppe", "Snack", "Dessert", "Getränk", "Beilage", "Sauce",
] as const;

/** Was n8n (oder ein späterer App-Scraper) liefert. Gleiche Felder wie das Kochbuch-Template. */
export interface AusgelesenesRezept {
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
  /** Gruppiert wie in der App, oder flache Liste (eine Zeile = eine Zutat) */
  ingredients: IngredientGroup[] | string[];
  steps: string[];
  tips?: string[];
}

/** Flache Zutatenliste → Gruppen (eine ungruppierte Gruppe). */
export function normalisiereZutaten(z: IngredientGroup[] | string[] | undefined): IngredientGroup[] {
  if (!z || z.length === 0) return [];
  if (typeof z[0] === "string") {
    const items = (z as string[]).map((s) => s.replace(/^[-*]\s*(\[[ xX]\]\s*)?/, "").trim()).filter(Boolean);
    return items.length ? [{ group: "", items }] : [];
  }
  return (z as IngredientGroup[])
    .map((g) => ({ group: (g.group ?? "").trim(), items: (g.items ?? []).map((s) => s.trim()).filter(Boolean) }))
    .filter((g) => g.items.length > 0);
}

// ── Dubletten über den Titel ──────────────────────────────────

/** Titel → Vergleichsform: klein, ohne Umlaute/Satzzeichen, Füllwörter raus. */
export function titelNorm(t: string): string {
  return slugify(t)
    .split("-")
    .filter((w) => w && !["mit", "und", "der", "die", "das", "a", "la", "al", "the", "with", "and", "rezept", "recipe"].includes(w))
    .join(" ");
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Ähnlichkeit zweier Titel 0..1: Maximum aus Dice (Bigramme) und Wortmengen-Überdeckung.
 *  Wortmengen fangen vertauschte Reihenfolge („Rotkohl-Granatapfel“ / „Granatapfel-Rotkohl“). */
export function titelAehnlichkeit(a: string, b: string): number {
  const na = titelNorm(a);
  const nb = titelNorm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const A = bigrams(na);
  const B = bigrams(nb);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((s, n) => s + n, 0) + [...B.values()].reduce((s, n) => s + n, 0);
  const dice = total ? (2 * inter) / total : 0;
  const wa = new Set(na.split(" "));
  const wb = new Set(nb.split(" "));
  const common = [...wa].filter((w) => wb.has(w)).length;
  const words = common / Math.max(wa.size, wb.size);
  return Math.max(dice, words);
}

export const AEHNLICH_AB = 0.82;

// ── Plausibilität ─────────────────────────────────────────────

export interface PruefKontext {
  /** Bestehende Rezepte mit gleicher Quelle (recipeStore.findBySourceKey) */
  gleicheQuelle: { slug: string; name: string }[];
  /** Alle nicht abgelehnten Titel (recipeStore.titles), ohne die Einreichung selbst */
  titel: { slug: string; name: string }[];
  /** Gibt es ein Bild (heruntergeladen oder hochgeladen)? */
  hatBild: boolean;
  /** Eigener Slug, damit die Einreichung sich nicht selbst als Dublette findet */
  eigenerSlug?: string;
  jetzt?: string;
}

const MENGE = /^\s*(ca\.?\s*)?(\d+([.,/]\d+)?|½|¼|¾|⅓|⅔|eine?n?|etwas|prise|handvoll|schuss)\b/i;

/**
 * Prüft ein ausgelesenes Rezept. `fehler` = so nicht veröffentlichen (Christian kann trotzdem
 * freigeben, sieht aber rot), `hinweise` = auffällig, aber kein Grund zur Ablehnung.
 */
export function pruefeRezept(r: AusgelesenesRezept, k: PruefKontext): StoredCheck {
  const fehler: string[] = [];
  const hinweise: string[] = [];
  const dubletten: { slug: string; name: string; grund: string }[] = [];

  // Titel
  const name = (r.name ?? "").trim();
  if (!name) fehler.push("Titel fehlt");
  else if (name.length < 3) fehler.push("Titel zu kurz");
  else if (name.length > 120) hinweise.push("Titel sehr lang (über 120 Zeichen)");
  if (/https?:\/\//i.test(name)) fehler.push("Titel ist ein Link");

  // Zutaten und Schritte
  const gruppen = normalisiereZutaten(r.ingredients);
  const zutaten = gruppen.flatMap((g) => g.items);
  const schritte = (r.steps ?? []).map((s) => s.trim()).filter(Boolean);
  if (zutaten.length < 3) fehler.push(`Nur ${zutaten.length} Zutat(en), mindestens 3`);
  if (schritte.length < 2) fehler.push(`Nur ${schritte.length} Schritt(e), mindestens 2`);
  if (zutaten.length > 40) hinweise.push(`${zutaten.length} Zutaten, ungewöhnlich viele`);
  if (schritte.length > 30) hinweise.push(`${schritte.length} Schritte, ungewöhnlich viele`);
  if (zutaten.length >= 3) {
    const mitMenge = zutaten.filter((z) => MENGE.test(z)).length;
    if (mitMenge / zutaten.length < 0.5) hinweise.push("Weniger als die Hälfte der Zutaten hat eine Mengenangabe");
  }
  if ([...zutaten, ...schritte].some((s) => /https?:\/\//i.test(s))) hinweise.push("Links in Zutaten oder Schritten");
  if (schritte.some((s) => s.length < 8)) hinweise.push("Sehr kurze Schritte, evtl. abgeschnitten");

  // Bild
  if (!k.hatBild) fehler.push("Kein Bild");

  // Kategorie
  if (r.category && !(KATEGORIEN as readonly string[]).includes(r.category)) {
    hinweise.push(`Kategorie „${r.category}“ nicht im Kochbuch-Enum, wird Hauptgericht`);
  }

  // Makros (pro Portion)
  const { kcal, protein, carbs, fat } = r;
  if (kcal == null) hinweise.push("Keine Kalorien");
  else if (kcal < 30 || kcal > 2500) hinweise.push(`${kcal} kcal pro Portion, unplausibel`);
  if ([protein, carbs, fat].some((v) => v != null && (v < 0 || v > 300))) hinweise.push("Makro-Wert außerhalb 0–300 g");
  if (kcal && protein != null && carbs != null && fat != null) {
    const rechnerisch = 4 * protein + 4 * carbs + 9 * fat;
    if (Math.abs(rechnerisch - kcal) / kcal > 0.25) {
      hinweise.push(`Makros ergeben ${Math.round(rechnerisch)} kcal statt ${kcal} (über 25 % daneben)`);
    }
  }

  // Portionen
  const p = parseFloat(String(r.portions ?? "").replace(",", "."));
  if (r.portions && (!Number.isFinite(p) || p < 1 || p > 24)) hinweise.push(`Portionen „${r.portions}“ unplausibel`);

  // Dubletten
  for (const d of k.gleicheQuelle) {
    if (d.slug === k.eigenerSlug) continue;
    dubletten.push({ ...d, grund: "gleiche Quelle" });
  }
  if (dubletten.length) fehler.push(`Gleiche Quelle schon im Kochbuch: ${dubletten.map((d) => d.name).join(", ")}`);
  if (name) {
    for (const t of k.titel) {
      if (t.slug === k.eigenerSlug || dubletten.some((d) => d.slug === t.slug)) continue;
      const a = titelAehnlichkeit(name, t.name);
      if (a >= AEHNLICH_AB) dubletten.push({ ...t, grund: `ähnlicher Titel (${Math.round(a * 100)} %)` });
    }
    const aehnlich = dubletten.filter((d) => d.grund.startsWith("ähnlich"));
    if (aehnlich.length) hinweise.push(`Ähnlich wie: ${aehnlich.map((d) => d.name).join(", ")}`);
  }

  return {
    ok: fehler.length === 0,
    phase: "fertig",
    fehler,
    hinweise,
    dubletten,
    geprueftAm: k.jetzt ?? new Date().toISOString(),
  };
}

/** Telegram-Text für Christian (n8n schickt ihn, die App formuliert ihn). Plaintext. */
export function telegramText(o: { name: string; eingereichtVon: string | null; pruefung: StoredCheck; adminUrl: string }): string {
  const wer = o.eingereichtVon ? `${o.eingereichtVon} hat` : "Neu:";
  const ampel = o.pruefung.ok ? "Prüfung ok" : `Prüfung: ${o.pruefung.fehler.join("; ")}`;
  const hinweis = o.pruefung.hinweise.length ? `\nHinweise: ${o.pruefung.hinweise.slice(0, 3).join("; ")}` : "";
  return `${wer} „${o.name}“ eingereicht.\n${ampel}${hinweis}\nFreigeben: ${o.adminUrl}`;
}
