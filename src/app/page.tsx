"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { preload, createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion, useMotionValue, useTransform, animate } from "framer-motion";
import {
  Loader2, ChevronRight, ChevronDown, Clock, Users, Flame,
  X, ExternalLink, AlertCircle, Check,
  Heart, Star, RotateCcw, User, Search, Copy, UserPlus, Sparkles, LogOut,
  CookingPot, UtensilsCrossed, ChefHat, Lightbulb, Soup, Share2, ImagePlus, Mic, Square, Pencil, BookOpen,
} from "lucide-react";

// Instagram-Glyph (aus lucide entfernt) als inline-SVG
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}
import { NumberFlow } from "@/components/ui/NumberFlow";
import { Lens } from "@/components/ui/Lens";
import { AnimatedInput } from "@/components/ui/AnimatedInput";
import { useToast } from "@/components/ui/Toast";
import { dayKey, shiftDay, showYesterday } from "@/lib/day";

// ── Types ─────────────────────────────────────────────────────

interface IngredientGroup { group: string; items: string[] }

interface Recipe {
  slug: string;
  name: string;
  description: string;
  category: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** Kartenbild (Profilbild oder, bei Standbildern ohne Gericht, das KI-Bild) */
  image: string | null;
  imageIsAi?: boolean;
  imageExists: boolean;
  images: string[];
  /** Von Hand gesetzter Bildfokus des Kartenbilds [x, y] in % (Frontmatter `bildfokus`) */
  imageFocus?: [number, number] | null;
  created: string;
  source: string | null;
  totalTime: string | null;
  portions: string | null;
  difficulty: string | null;
  ingredients: IngredientGroup[];
  steps: string[];
  tips: string[];
  tags: string[];
  /** true = aus der schlanken Liste (ohne Zubereitung/Tipps), volles Rezept lädt im Detail nach */
  lite?: boolean;
}

// Swipe-Verdikt (Tinder-Logik) — lokal persistiert bis der öffentliche Login kommt
type Verdict = "like" | "nope" | "super";

const FAV_KEY = "rezepte-verdicts-v1";
const NAME_KEY = "rezepte-guest-name";
const ID_KEY = "rezepte-guest-id";

function loadVerdicts(): Record<string, Verdict> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || "{}"); } catch { return {}; }
}
function saveVerdict(slug: string, v: Verdict | null) {
  try {
    const all = loadVerdicts();
    if (v === null) delete all[slug]; else all[slug] = v;
    localStorage.setItem(FAV_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}
// Lokalen Verdict-Cache komplett ersetzen (nach Login/Server-Hydration).
function replaceVerdicts(all: Record<string, Verdict>) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

// Sterne-Bewertung (nach dem Kochen), lokal gespiegelt.
const RATE_KEY = "rezepte-ratings-v1";
function loadRatings(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(RATE_KEY) || "{}"); } catch { return {}; }
}
function saveRatingLocal(slug: string, stars: number | null) {
  try {
    const all = loadRatings();
    if (stars === null) delete all[slug]; else all[slug] = stars;
    localStorage.setItem(RATE_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}
function replaceRatings(all: Record<string, number>) {
  try { localStorage.setItem(RATE_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

// „Was ich nicht mag" (Tokens), lokal gespiegelt.
const DISLIKE_KEY = "rezepte-dislikes-v1";
function loadDislikes(): string[] {
  if (typeof window === "undefined") return [];
  try { const v = JSON.parse(localStorage.getItem(DISLIKE_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function replaceDislikes(list: string[]) {
  try { localStorage.setItem(DISLIKE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

// „Heute gemerkt“: Tageseinträge je Gericht (Tag beginnt 4:00 Berlin, lib/day.ts).
// Kopie des Server-Stands (swipe_days) plus eigene, noch nicht bestätigte Swipes.
// before = je Gericht die Tage mit like/super VOR `from` (vom Server gezählt).
const DAYS_KEY = "rezepte-heute-v1";
type DayEntry = { v: Verdict; at: string };
interface DayStore { from: string; days: Record<string, Record<string, DayEntry>>; before: Record<string, number> }
const EMPTY_DAYS: DayStore = { from: "", days: {}, before: {} };
function loadDayStore(): DayStore {
  if (typeof window === "undefined") return EMPTY_DAYS;
  try {
    const v = JSON.parse(localStorage.getItem(DAYS_KEY) || "null");
    return v && typeof v === "object" && v.days ? { from: v.from ?? "", days: v.days, before: v.before ?? {} } : EMPTY_DAYS;
  } catch { return EMPTY_DAYS; }
}
function saveDayStore(st: DayStore) {
  try { localStorage.setItem(DAYS_KEY, JSON.stringify(st)); } catch { /* ignore */ }
}
/** Tageseintrag setzen (null = entfernen), gibt den neuen Stand zurück. */
function withDayEntry(st: DayStore, day: string, slug: string, e: DayEntry | null): DayStore {
  const dayMap = { ...(st.days[day] ?? {}) };
  if (e) dayMap[slug] = e; else delete dayMap[slug];
  return { ...st, days: { ...st.days, [day]: dayMap } };
}
const isLike = (v?: Verdict | null) => v === "like" || v === "super";
/** An wie vielen Tagen gemocht: Server-Zählung vor `from` + eigene Tage ab `from`. */
function computeLikeCounts(st: DayStore): Record<string, number> {
  const out: Record<string, number> = { ...st.before };
  for (const [day, map] of Object.entries(st.days)) {
    if (st.from && day < st.from) continue;
    for (const [slug, e] of Object.entries(map)) if (isLike(e.v)) out[slug] = (out[slug] ?? 0) + 1;
  }
  return out;
}

// YYYY-MM-DD → TT.MM.JJJJ (für den Koch-Verlauf)
function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}
// Heutiges Datum als YYYY-MM-DD (lokal)
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Empfehlungslogik (zutatenbasiert) ─────────────────────────
// Durchsuchbarer Text eines Rezepts (Name + Beschreibung + Zutaten), kleingeschrieben.
function ingredientBlob(r: Recipe): string {
  const ing = r.ingredients.flatMap((g) => [g.group, ...g.items]).join(" ");
  return `${r.name} ${r.description} ${ing}`.toLowerCase();
}
// Welche Abneigungen treffen auf ein Rezept zu (Tag- oder Text-Treffer).
function dislikeHits(r: Recipe, dislikes: string[]): string[] {
  if (dislikes.length === 0) return [];
  const blob = ingredientBlob(r);
  const tagset = new Set(r.tags);
  return dislikes.filter((d) => tagset.has(d) || blob.includes(d));
}
// Score eines Rezepts: Summe der Geschmacksprofil-Gewichte seiner Tags,
// dicker Malus bei Abneigungs-Treffern.
function recipeScore(r: Recipe, profile: Record<string, number>, dislikes: string[]): number {
  let s = 0;
  for (const t of r.tags) s += profile[t] ?? 0;
  if (dislikeHits(r, dislikes).length) s -= 100;
  return s;
}

// Frisch entstandenes Match (für die „Es ist ein Match!"-Animation)
interface MatchPing { name: string; theirs: Verdict; bothSuper: boolean }

// Koch-Verlauf-Eintrag ("bereits gekocht", optional mit wem)
interface CookEvent {
  id: number; slug: string; recipeName: string; category: string;
  cookedOn: string; withGuest: string | null; withName: string | null; isAuthor: boolean;
}
// Verbundene Person (fürs „mit wem"-Dropdown)
interface Friend { guestId: string; name: string }
// Undo-Verlauf: Dauerstand davor + (Heute gemerkt) Tag und Tageseintrag davor
interface HistoryItem { slug: string; prev: Verdict | null; day?: string; prevDay?: Verdict | null }

// Verdict ans Backend schicken. Gibt die Antwort zurück (u.a. frische Matches);
// bleibt aber unkritisch — die UI hängt nicht davon ab. Schlägt das Senden fehl
// (offline, 500), merkt sich die App den Swipe und schickt ihn beim nächsten Öffnen
// nach. Sonst überschrieb /api/me ihn dort still mit dem alten Server-Stand.
type VerdictBody = {
  guestId: string; name: string; slug: string;
  recipeName?: string; category?: string; verdict: Verdict | null;
  day?: string; swipedAt?: string; undo?: boolean; dayVerdict?: Verdict | null;
};
const PENDING_KEY = "rezepte-pending-v1";
function loadPending(): Record<string, VerdictBody> {
  try { const v = JSON.parse(localStorage.getItem(PENDING_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
// Schlüssel je Gericht UND Tag: ein offline gemerkter Swipe von gestern darf nicht
// vom heutigen überschrieben werden.
const pendingKey = (b: VerdictBody) => `${b.slug}|${b.day ?? ""}`;
function pendingSlugs(): string[] {
  return Object.values(loadPending()).map((b) => b.slug);
}
function setPending(key: string, body: VerdictBody | null) {
  try {
    const p = loadPending();
    if (body) p[key] = body; else delete p[key];
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}
async function postVerdict(body: VerdictBody): Promise<{ ok?: boolean; matches?: MatchPing[] } | null> {
  try {
    const res = await fetch("/api/verdict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    if (!res.ok) throw new Error(String(res.status));
    setPending(pendingKey(body), null);
    return await res.json();
  } catch {
    setPending(pendingKey(body), body);
    return null;
  }
}
// Liegengebliebene Swipes nachschicken (nur die des aktuellen Accounts).
async function flushPending(guestId: string) {
  const all = Object.values(loadPending());
  // Ältere App-Versionen merkten nur den Slug als Schlüssel → aufs neue Format umschlüsseln
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(Object.fromEntries(all.map((b) => [pendingKey(b), b])))); } catch { /* ignore */ }
  await Promise.all(all.filter((b) => b.guestId === guestId).map((b) => postVerdict(b)));
}

interface Diagnostics {
  vaultPath: string | null;
  recipesDir: string | null;
  recipesDirExists: boolean;
  imagesDir: string | null;
  imagesDirExists: boolean;
  recipeCount: number;
}

// ── Helpers ───────────────────────────────────────────────────

const CATEGORY_EMOJI: Record<string, string> = {
  "Frühstück": "🍳",
  "Hauptgericht": "🍽️",
  "Dessert": "🍰",
  "Snack": "🥨",
  "Salat": "🥗",
};

// Filter in vier Gruppen (21.10.2026, vorher drei): Unter „Gerichte“ standen auch Soßen, Beilagen
// und Snacks und passten beim Filtern nicht. Salate zählen zum Hauptgang (meist Bowls).
// Die Karte zeigt weiter die echte Kategorie aus dem Rezept.
const CAT_GROUPS = ["Frühstück", "Hauptgang", "Snacks & Co", "Dessert"] as const;
function catGroup(cat: string): string {
  if (cat === "Frühstück" || cat === "Dessert") return cat;
  if (cat === "Hauptgericht" || cat === "Salat" || cat === "Suppe") return "Hauptgang";
  return "Snacks & Co";
}

// Kürzere Anzeige-Labels für die Filter-Pills (Frontmatter im Vault bleibt unverändert).
const CATEGORY_LABEL: Record<string, string> = {
  "Hauptgericht": "Gerichte",
};
function catLabel(cat: string): string {
  return CATEGORY_LABEL[cat] ?? cat;
}

// Aggregierte Beliebtheits-Zähler (aus /api/recipes/trending) — likes = like+super.
type TrendCount = { likes: number; supers: number };
type TrendCounts = Record<string, TrendCount>;
function trendScore(c?: TrendCount): number {
  return c ? c.likes + c.supers : 0; // super zählt doppelt (einmal in likes + Bonus)
}

// Gewünschte Filter-Reihenfolge (alles andere hinten dran, alphabetisch)

// ── Bild-URLs ─────────────────────────────────────────────────
// Jede Ansicht bekommt ihren Zuschnitt vom Server (um den Bildfokus, siehe
// lib/imageFocus.ts) und per srcset die passende Breite; AVIF mit WebP als Rückfall.
type Shape = "card" | "tile" | "square" | "wide" | "detail";
const SHAPES: Record<Shape, { ar: string; widths: number[] }> = {
  card: { ar: "4x5", widths: [480, 720, 1080] },      // Swipe-Karte
  tile: { ar: "8x7", widths: [320, 480, 720, 1080] }, // Raster „Alle Gerichte“
  square: { ar: "1x1", widths: [160, 320, 480, 720] }, // Mini-Vorschauen, Match
  wide: { ar: "3x2", widths: [320, 480, 720] },       // Favoriten, „Für dich“
  detail: { ar: "16x10", widths: [720, 1080] },       // Detail-Kopf
};
/** Version der Zuschnitt-Logik. Hochzählen, wenn sich der Ausschnitt ändert → neue URLs. */
const IMG_V = 2;
/** Karte: Seitenrand 2 × 16 px + Kartenpolster 2 × 12 px; Container max. 768 px. */
const CARD_SIZES = "(min-width: 768px) 712px, calc(100vw - 56px)";

function imageSrc(image: string, shape: Shape, w: number, fmt: "avif" | "webp", focus?: [number, number] | null): string {
  const f = focus ? `&f=${focus[0]}-${focus[1]}` : "";
  return `/api/recipes/image/${encodeURIComponent(image)}?w=${w}&ar=${SHAPES[shape].ar}&fmt=${fmt}&v=${IMG_V}${f}`;
}
function imageSrcSet(image: string, shape: Shape, fmt: "avif" | "webp", focus?: [number, number] | null): string {
  return SHAPES[shape].widths.map((w) => `${imageSrc(image, shape, w, fmt, focus)} ${w}w`).join(", ");
}

/** <picture> mit AVIF + WebP. `contents`, damit das img selbst im Layout sitzt. */
function Pic({
  image, shape, sizes, focus, alt, className, eager = false, priority = "auto", onError, onLoad,
}: {
  image: string; shape: Shape; sizes: string; focus?: [number, number] | null; alt: string;
  className?: string; eager?: boolean; priority?: "high" | "low" | "auto"; onError?: () => void; onLoad?: () => void;
}) {
  const widths = SHAPES[shape].widths;
  return (
    <picture className="contents">
      <source type="image/avif" srcSet={imageSrcSet(image, shape, "avif", focus)} sizes={sizes} />
      <img
        src={imageSrc(image, shape, widths[Math.min(1, widths.length - 1)], "webp", focus)}
        srcSet={imageSrcSet(image, shape, "webp", focus)}
        sizes={sizes}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority}
        draggable={false}
        onError={onError}
        onLoad={onLoad}
        className={className}
      />
    </picture>
  );
}

// ── Makro-Chips ───────────────────────────────────────────────

function MacroChips({ r, size = "md", animate = false }: { r: Recipe; size?: "sm" | "md"; animate?: boolean }) {
  const chips = [
    { key: "kcal", label: "kcal", value: r.kcal, suffix: "", color: "text-orange-500 bg-orange-500/10" },
    { key: "P", label: "P", value: r.protein, suffix: "g", color: "text-emerald-600 bg-emerald-500/10" },
    { key: "K", label: "K", value: r.carbs, suffix: "g", color: "text-blue-500 bg-blue-500/10" },
    { key: "F", label: "F", value: r.fat, suffix: "g", color: "text-amber-600 bg-amber-500/10" },
  ].filter((c): c is typeof c & { value: number } => c.value != null);

  const pad = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs";

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {chips.map((c) => (
        <span key={c.key} className={`${pad} rounded-md font-semibold ${c.color}`}>
          {animate
            ? <NumberFlow value={c.value} format={(n) => `${n}${c.suffix}`} />
            : `${c.value}${c.suffix}`}
          {" "}
          <span className="opacity-60 font-normal">{c.label}</span>
        </span>
      ))}
    </div>
  );
}

// ── Bild mit Fallback ─────────────────────────────────────────

function RecipeImage({
  r, shape, sizes, className, eager = false, priority = "auto", onLoad,
}: {
  r: Recipe; shape: Shape; sizes: string; className?: string; eager?: boolean; priority?: "high" | "low" | "auto"; onLoad?: () => void;
}) {
  const [failed, setFailed] = useState(false);

  if (!r.imageExists || !r.image || failed) {
    return (
      <div className={`flex items-center justify-center bg-surface-elevated ${className}`}>
        <span className="text-5xl opacity-40">{CATEGORY_EMOJI[r.category] ?? "🍽️"}</span>
      </div>
    );
  }
  return (
    <Pic
      image={r.image}
      shape={shape}
      sizes={sizes}
      focus={r.imageFocus}
      alt={r.name}
      eager={eager}
      priority={priority}
      onLoad={onLoad}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

// ── Karten-Inhalt (wird pro Stapel-Karte gerendert) ───────────

// Grüne Info-Pill im Swipe-for-Dinner-Stil
function InfoPill({ icon: Icon, children }: { icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#3f6b43]/10 text-[#3f6b43] border border-[#3f6b43]/15">
      {Icon && <Icon className="w-3 h-3" />}
      {children}
    </span>
  );
}

function RecipeCardFace({
  r, index, total, onOpen, onImageLoad, likeCount = 0, likedToday = false, priority = "high",
}: {
  r: Recipe; index: number; total: number; onOpen: () => void; animateMacros?: boolean; onImageLoad?: () => void;
  priority?: "high" | "auto";
  /** an wie vielen Tagen schon gemocht (Badge ab 2) */
  likeCount?: number;
  /** heute schon nach rechts/hoch (nur bei „Nochmal alle ansehen“ im Stapel) */
  likedToday?: boolean;
}) {
  return (
    <div className="bg-surface rounded-[26px] shadow-[0_10px_30px_rgba(70,50,30,0.10)] border border-border p-3 sm:p-3.5 h-full flex flex-col">
      {/* Kopfzeile: Kategorie-Label + Rezept-Pill */}
      <div className="flex items-center justify-between px-1 pb-2 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          — {r.category}
        </span>
        <span className="text-[11px] font-medium tabular-nums text-text-muted">{index + 1} / {total}</span>
      </div>

      {/* Foto füllt den verfügbaren Platz (Tinder-Prinzip) */}
      <button
        onClick={onOpen}
        aria-label={`${r.name} öffnen`}
        className="relative block w-full flex-1 min-h-0 rounded-2xl overflow-hidden bg-surface-elevated"
      >
        <RecipeImage r={r} shape="card" sizes={CARD_SIZES} eager priority={priority} onLoad={onImageLoad} className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
        {(likeCount >= 2 || likedToday) && (
          <span className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none">
            {likeCount >= 2 && (
              <span className="px-2 py-1 rounded-full bg-black/55 text-white text-[12px] font-semibold tabular-nums flex items-center gap-1">
                <Heart className="w-3 h-3 fill-white" /> {likeCount}×
              </span>
            )}
            {likedToday && (
              <span className="px-2 py-1 rounded-full bg-[#3f6b43]/90 text-white text-[12px] font-semibold">Heute gemerkt</span>
            )}
          </span>
        )}
        <span className="absolute bottom-2 right-2 px-2 py-1 rounded-full bg-black/55 text-white text-[10px] font-semibold flex items-center gap-0.5 pointer-events-none">
          Rezept <ChevronRight className="w-3 h-3" />
        </span>
      </button>

      {/* Text unter dem Foto — kompakt, feste Höhe */}
      <div className="px-1 pt-2.5 shrink-0">
        <h2 className="text-[1.25rem] sm:text-[1.35rem] leading-[1.12] font-extrabold text-text-primary tracking-tight line-clamp-2">{r.name}</h2>
        <p className="text-[13px] text-text-secondary leading-snug mt-1 line-clamp-2">{r.description}</p>

        {/* Info-Pills */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          {r.totalTime && <InfoPill icon={Clock}>{r.totalTime}</InfoPill>}
          {r.difficulty && <InfoPill icon={Flame}>{r.difficulty}</InfoPill>}
          {r.kcal != null && <InfoPill>{r.kcal} kcal</InfoPill>}
          {r.protein != null && <InfoPill>{r.protein}g Protein</InfoPill>}
        </div>
      </div>
    </div>
  );
}

// ── Swipe-Deck mit Verdicts (Tinder-Logik) ────────────────────
// Rechts = Lecker, links = Nö, hoch = Superlike. Farbige Stamps beim Wischen,
// gestapelte Karten dahinter. Verdicts landen (vorerst) in localStorage.

function SwipeDeck({
  recipes, index, setIndex, onOpen, onVerdict, onUndo, canUndo, likeCounts, todayMap,
}: {
  recipes: Recipe[];
  index: number;
  setIndex: (i: number) => void;
  onOpen: (r: Recipe) => void;
  onVerdict: (r: Recipe, v: Verdict) => void;
  onUndo: () => void;
  canUndo: boolean;
  likeCounts?: Record<string, number>;
  todayMap?: Record<string, DayEntry>;
}) {
  const prefersReduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-14, 14]);
  const likeOp = useTransform(x, [30, 120], [0, 1]);
  const nopeOp = useTransform(x, [-120, -30], [1, 0]);
  const superOp = useTransform(y, [-120, -30], [1, 0]);

  const current = recipes[index];
  // Vorausladen erst, wenn die vorderste Karte ihr Bild hat (spätestens nach 1,5 s) —
  // sonst teilen sich beim Start sechs Bilder die Leitung und die sichtbare Karte kommt zuletzt.
  const [primed, setPrimed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPrimed(true), 1500);
    return () => clearTimeout(t);
  }, []);
  // Sperre während der Abflug-Animation: ein zweiter Tipp in den 0,32 s traf sonst
  // dieselbe Karte noch einmal und überschrieb das erste Urteil.
  const flying = useRef(false);

  const commit = useCallback((v: Verdict) => {
    if (!current || flying.current) return;
    flying.current = true;
    const tx = v === "like" ? 560 : v === "nope" ? -560 : 0;
    const ty = v === "super" ? -720 : 60;
    const finish = () => {
      onVerdict(current, v);
      x.set(0); y.set(0);
      setIndex(index + 1);
      flying.current = false;
    };
    if (prefersReduced) { finish(); return; }
    animate(x, tx, { duration: 0.32, ease: [0.35, 0.6, 0.3, 1] });
    animate(y, ty, { duration: 0.32, ease: [0.35, 0.6, 0.3, 1], onComplete: finish });
  }, [current, index, onVerdict, setIndex, prefersReduced, x, y]);

  const springBack = useCallback(() => {
    animate(x, 0, { type: "spring", stiffness: 400, damping: 32 });
    animate(y, 0, { type: "spring", stiffness: 400, damping: 32 });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Nicht wischen, während man in einem Feld tippt oder ein Sheet offen ist
      // (Datum, „mit wem“, Scrollen im Rezept trafen sonst die Karte dahinter).
      const t = e.target;
      if (t instanceof Element && t.closest("input, select, textarea, [contenteditable]")) return;
      if (document.querySelector(".fixed.inset-0")) return;
      if (e.key === "ArrowLeft") commit("nope");
      if (e.key === "ArrowRight") commit("like");
      if (e.key === "ArrowUp") commit("super");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit]);

  if (!current) return null;

  // Vorne + zwei dahinter, in EINER Liste mit dem Slug als Schlüssel (21.10.2026): Rückt eine
  // Karte nach vorne, bleibt sie dasselbe Element mit demselben, schon dekodierten Bild. Vorher
  // waren hintere Karten und vordere Karte getrennte Bäume; die nachrückende Karte wurde neu
  // aufgebaut, das Bild kam einen Moment später und sprang dann nach vorne.
  const visible = recipes.slice(index, index + 3);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="relative flex-1 min-h-0" style={{ touchAction: "pan-y" }}>
        {/* Vorausladen: die drei Karten hinter dem sichtbaren Stapel, gleiche URLs wie die
            Karte selbst (srcset/sizes), niedrige Priorität — die vorderste Karte geht vor. */}
        <div aria-hidden className="absolute w-px h-px overflow-hidden opacity-0 pointer-events-none">
          {primed && recipes.slice(index + 3, index + 6).map((recipe) => (
            <RecipeImage key={recipe.slug} r={recipe} shape="card" sizes={CARD_SIZES} eager priority="low" className="w-full h-full" />
          ))}
        </div>

        {visible.map((recipe, pos) => {
          const front = pos === 0;
          return (
            <motion.div
              key={recipe.slug}
              className="absolute inset-0"
              initial={false}
              animate={{ scale: 1 - pos * 0.05, y: pos * 12, opacity: 1 - pos * 0.12 }}
              transition={prefersReduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
              style={{ zIndex: 20 - pos, transformOrigin: "top center" }}
              aria-hidden={!front || undefined}
            >
              <motion.div
                className={`relative w-full h-full select-none ${front ? "" : "pointer-events-none"}`}
                style={front ? { x, y, rotate, transformOrigin: "top center" } : undefined}
                drag={front && !prefersReduced}
                dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                dragElastic={0.55}
                whileDrag={{ cursor: "grabbing" }}
                onDragEnd={(_, info) => {
                  if (!front) return;
                  const up = info.offset.y < -110 && Math.abs(info.offset.y) > Math.abs(info.offset.x);
                  if (up || info.velocity.y < -700) { commit("super"); return; }
                  if (info.offset.x > 100 || info.velocity.x > 500) { commit("like"); return; }
                  if (info.offset.x < -100 || info.velocity.x < -500) { commit("nope"); return; }
                  springBack();
                }}
              >
                {/* Verdict-Stamps — mittig, damit sie beim Wischen nicht aus dem Bild wandern.
                    Auch hinten vorhanden (unsichtbar), damit die Karte beim Nachrücken gleich bleibt. */}
                <motion.div style={{ opacity: front ? likeOp : 0 }} className="absolute top-24 left-1/2 -translate-x-1/2 z-30 rotate-[8deg] px-4 py-1.5 rounded-2xl border-[4px] border-[#57a75f] text-[#57a75f] text-[2.1rem] font-black uppercase tracking-wide pointer-events-none bg-white/25">
                  Lecker
                </motion.div>
                <motion.div style={{ opacity: front ? nopeOp : 0 }} className="absolute top-24 left-1/2 -translate-x-1/2 z-30 -rotate-[8deg] px-4 py-1.5 rounded-2xl border-[4px] border-[#bd5138] text-[#bd5138] text-[2.1rem] font-black uppercase tracking-wide pointer-events-none bg-white/25">
                  Nö
                </motion.div>
                <motion.div style={{ opacity: front ? superOp : 0 }} className="absolute left-1/2 -translate-x-1/2 top-1/3 z-30 -rotate-[6deg] px-3 py-1.5 rounded-xl border-[3px] border-[#d99a2b] text-[#d99a2b] text-xl font-black uppercase tracking-wide pointer-events-none flex items-center gap-1.5">
                  <Star className="w-5 h-5 fill-[#d99a2b]" /> Superlike
                </motion.div>

                <RecipeCardFace
                  r={recipe}
                  index={index + pos}
                  total={recipes.length}
                  onOpen={() => onOpen(recipe)}
                  priority={front ? "high" : "auto"}
                  onImageLoad={front ? () => setPrimed(true) : undefined}
                  likeCount={likeCounts?.[recipe.slug] ?? 0}
                  likedToday={isLike(todayMap?.[recipe.slug]?.v)}
                />
              </motion.div>
            </motion.div>
          );
        })}
      </div>

      {/* Action-Buttons — Swipe-for-Dinner-Stil, fix unter dem Deck */}
      <div className="shrink-0 flex items-center justify-center gap-4 pt-5">
        <button
          onClick={() => commit("nope")}
          aria-label="Nö"
          className="w-14 h-14 rounded-full bg-surface border-2 border-[#bd5138]/40 flex items-center justify-center text-[#bd5138] active:scale-90 transition-transform shadow-sm"
        >
          <X className="w-6 h-6" strokeWidth={2.5} />
        </button>
        <button
          onClick={() => { if (!flying.current) onUndo(); }}
          disabled={!canUndo}
          aria-label="Rückgängig"
          className="w-11 h-11 rounded-full bg-surface border border-border flex items-center justify-center text-text-muted disabled:opacity-30 active:scale-90 transition-transform"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={() => commit("super")}
          aria-label="Superlike"
          className="w-12 h-12 rounded-full bg-surface border-2 border-[#d99a2b]/45 flex items-center justify-center text-[#d99a2b] active:scale-90 transition-transform shadow-sm"
        >
          <Star className="w-5 h-5 fill-[#d99a2b]" />
        </button>
        <button
          onClick={() => commit("like")}
          aria-label="Lecker"
          className="w-16 h-16 rounded-full bg-[#4f9a58] flex items-center justify-center text-white active:scale-90 transition-transform shadow-lg"
          style={{ boxShadow: "0 8px 22px rgba(79,154,88,0.38)" }}
        >
          <Check className="w-8 h-8" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

// ── Platzhalter-Karte (vor dem Hydrieren und während die Liste lädt) ─
// Gleiche Maße wie Karte + Knopfreihe, damit beim Erscheinen nichts springt.
function DeckSkeleton() {
  return (
    <div className="flex flex-col h-full min-h-0" aria-hidden>
      <div className="relative flex-1 min-h-0">
        <div className="bg-surface rounded-[26px] shadow-[0_10px_30px_rgba(70,50,30,0.10)] border border-border p-3 sm:p-3.5 h-full flex flex-col">
          <div className="h-[24px] shrink-0" />
          <div className="relative w-full flex-1 min-h-0 rounded-2xl bg-surface-elevated animate-pulse" />
          <div className="px-1 pt-2.5 shrink-0">
            <div className="h-6 w-3/4 rounded-md bg-surface-elevated" />
            <div className="h-4 w-full rounded-md bg-surface-elevated mt-2" />
            <div className="h-4 w-2/3 rounded-md bg-surface-elevated mt-1.5" />
            <div className="h-6 w-1/2 rounded-full bg-surface-elevated mt-2.5" />
          </div>
        </div>
      </div>
      <div className="shrink-0 h-16 mt-5" />
    </div>
  );
}

// ── Ende des Stapels: für heute alles gesehen ─────────────────

function DayDone({
  todayCount, again, onShowToday, onAgain,
}: {
  todayCount: number; again: boolean; onShowToday: () => void; onAgain: () => void;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-7 text-center space-y-4 mt-2">
      <div className="text-5xl">🍽️</div>
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{again ? "Nochmal durch, fertig!" : "Für heute alles gesehen"}</h2>
        <p className="text-sm text-text-secondary mt-1.5 leading-relaxed">
          {todayCount > 0
            ? <>Heute gemerkt: <span className="text-[#3f6b43] font-semibold">{todayCount} {todayCount === 1 ? "Gericht" : "Gerichte"}</span>.</>
            : "Heute hast du noch nichts gemerkt."}
          <br />Morgen ab 4 Uhr ist der Stapel wieder voll.
        </p>
      </div>
      <div className="flex flex-col gap-2 max-w-xs mx-auto">
        <button
          onClick={onShowToday}
          className="w-full min-h-12 py-3 rounded-xl bg-accent text-white text-sm font-semibold active:scale-[0.98] transition-transform"
        >
          Heute gemerkt ansehen
        </button>
        <button
          onClick={onAgain}
          className="w-full min-h-11 py-2.5 rounded-xl bg-surface-elevated border border-border text-text-secondary text-sm font-medium active:scale-[0.98] transition-transform"
        >
          Nochmal alle ansehen
        </button>
      </div>
    </div>
  );
}

// ── Bento-Grid-Modus ──────────────────────────────────────────
// Rhythmisches Raster: jede 7er-Gruppe hat 1 grosse Hero-Kachel (2×2) + 6 kleine =
// bei 2 Spalten genau 5 volle Reihen. Vorher alle 6 → je Block ein Loch.
// grid-flow-dense füllt Reste (4 Spalten auf großen Bildschirmen).

function RecipeGrid({ recipes, onOpen, verdicts, counts }: { recipes: Recipe[]; onOpen: (r: Recipe) => void; verdicts?: Record<string, Verdict>; counts?: TrendCounts }) {
  const isHero = (i: number) => i % 7 === 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 grid-flow-dense auto-rows-[150px] sm:auto-rows-[180px] gap-3 pt-1">
      {recipes.map((r, i) => {
        const hero = isHero(i);
        const c = counts?.[r.slug];
        return (
          <motion.button
            key={r.slug}
            layout
            onClick={() => onOpen(r)}
            className={`group relative rounded-2xl overflow-hidden text-left bg-surface-elevated active:scale-[0.98] transition-transform ${
              hero ? "col-span-2 row-span-2" : ""
            }`}
          >
            <RecipeImage r={r} shape="tile" sizes={hero ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"} eager={i < 6} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
            {/* Trending-Badge: wie oft geliked/super-geliked (öffentlich, keine Namen) */}
            {c && c.likes > 0 && (
              <span className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-sm text-white text-[10px] font-semibold tabular-nums">
                <Heart className="w-2.5 h-2.5 fill-white" /> {c.likes}
                {c.supers > 0 && <><Star className="w-2.5 h-2.5 fill-[#ffcf5c] text-[#ffcf5c] ml-0.5" /> {c.supers}</>}
              </span>
            )}
            {verdicts?.[r.slug] === "super" && (
              <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#d99a2b] flex items-center justify-center shadow"><Star className="w-3.5 h-3.5 fill-white text-white" /></span>
            )}
            {verdicts?.[r.slug] === "like" && (
              <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#3f6b43] flex items-center justify-center shadow"><Heart className="w-3.5 h-3.5 fill-white text-white" /></span>
            )}
            <div className="absolute inset-x-0 bottom-0 p-2.5 sm:p-3">
              <p className={`text-white font-bold leading-tight line-clamp-2 drop-shadow ${hero ? "text-base" : "text-xs"}`}>
                {r.name}
              </p>
              {hero && (
                <p className="text-white/70 text-[11px] mt-1 line-clamp-2">{r.description}</p>
              )}
              <div className="flex items-center gap-2 mt-1.5 text-white/80 text-[10px]">
                {r.totalTime && <span className="flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{r.totalTime}</span>}
                {r.kcal != null && <span>{r.kcal} kcal</span>}
                {hero && r.protein != null && <span>{r.protein}g P</span>}
              </div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

// ── Bilder-Galerie im Detail (swipebar) ───────────────────────

function GalleryHeader({ r }: { r: Recipe }) {
  const imgs = (r.images && r.images.length > 0 ? r.images : (r.image ? [r.image] : []));
  const [active, setActive] = useState(0);

  if (imgs.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-surface-elevated">
        <span className="text-6xl opacity-40">{CATEGORY_EMOJI[r.category] ?? "🍽️"}</span>
      </div>
    );
  }

  // Fokus aus dem Frontmatter gilt nur fürs Kartenbild
  const focusOf = (img: string) => (img === r.image ? r.imageFocus : null);
  // KI-Bilder werden nur hier gekennzeichnet, nicht auf der Karte (dort wäre jedes Abzeichen Unruhe)
  const isAi = (img: string) => /_ki\.(jpe?g|png|webp)$/i.test(img);
  if (imgs.length === 1) {
    // Lupe braucht eine einzelne URL (Hintergrundbild) → WebP; Zuschnitt 16:10 = Kopfformat,
    // dadurch stimmt die Lupenposition jetzt auch (vorher schnitt object-cover unsichtbar ab).
    const src = imageSrc(imgs[0], "detail", 1080, "webp", focusOf(imgs[0]));
    return (
      <div className="relative w-full h-full">
        <Lens src={src} alt={r.name} zoom={2.2} lensSize={150} className="w-full h-full" />
        {isAi(imgs[0]) && (
          <span className="absolute top-3 left-3 z-20 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-sm text-white text-[10px] font-medium pointer-events-none">
            KI-Bild
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <div
        className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-none"
        style={{ scrollBehavior: "smooth" }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {imgs.map((img, i) => (
          <div key={img + i} className="w-full h-full shrink-0 snap-center bg-surface-elevated">
            <Pic image={img} shape="detail" sizes="(min-width: 640px) 512px, 100vw" focus={focusOf(img)}
              alt={`${r.name} ${i + 1}`} className="w-full h-full object-cover" eager={i === 0} />
          </div>
        ))}
      </div>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex gap-1.5 pointer-events-none">
        {imgs.map((_, i) => (
          <span key={i} className={`h-1.5 rounded-full transition-all ${i === active ? "w-5 bg-white" : "w-1.5 bg-white/50"}`} />
        ))}
      </div>
      <span className="absolute top-3 left-3 z-20 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-sm text-white text-[10px] font-medium tabular-nums pointer-events-none">
        {active + 1} / {imgs.length}{isAi(imgs[active] ?? "") ? " · KI-Bild" : ""}
      </span>
    </div>
  );
}

// ── Detail-Sheet ──────────────────────────────────────────────

// Sterne-Auswahl (1..5). Tippt man den aktuellen Wert erneut, wird er entfernt (null).
function StarRating({ value, onChange, size = 30 }: { value: number; onChange: (n: number | null) => void; size?: number }) {
  return (
    <div className="flex items-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(value === n ? null : n)}
          aria-label={`${n} von 5 Sternen`}
          className="w-11 h-11 flex items-center justify-center active:scale-90 transition-transform"
        >
          <Star
            className={n <= value ? "text-[#d99a2b]" : "text-text-faint"}
            style={{ width: size, height: size }}
            fill={n <= value ? "#d99a2b" : "none"}
          />
        </button>
      ))}
    </div>
  );
}

// Aufklappbarer Abschnitt mit weicher Höhen-Animation (iOS-artig)
function Collapsible({ title, icon: Icon, children, small = false, defaultOpen = false }: {
  title: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; small?: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const prefersReduced = useReducedMotion();
  return (
    <div className={small ? "" : "bg-surface"}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`w-full min-h-11 flex items-center gap-2 text-left active:opacity-60 transition-opacity ${small ? "py-1 text-[13px] text-text-muted" : "px-3.5 py-3 text-[15px] font-semibold text-text-primary"}`}
      >
        {Icon && <Icon className={small ? "w-3.5 h-3.5" : "w-4 h-4 text-accent"} />}
        <span className="flex-1">{title}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
          <ChevronDown className="w-4 h-4 text-text-muted" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={prefersReduced ? { duration: 0 } : { height: { type: "spring", stiffness: 380, damping: 36 }, opacity: { duration: 0.18 } }}
            className="overflow-hidden"
          >
            <div className={small ? "pb-1" : "px-3.5 pb-3.5"}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Rückfrage vor destruktiven Aktionen (statt window.confirm) ──
// Als Portal an <body>: in transformierten Sheets wäre `fixed` sonst am Sheet verankert.
type ConfirmOpts = { title: string; text?: string; confirmLabel: string };
type ConfirmState = ConfirmOpts & { resolve: (ok: boolean) => void };

function ConfirmDialog({ state, onClose }: { state: ConfirmState | null; onClose: (ok: boolean) => void }) {
  const prefersReduced = useReducedMotion();
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {state && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" role="alertdialog" aria-modal="true" aria-label={state.title}>
          <motion.div
            initial={{ opacity: prefersReduced ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50" onClick={() => onClose(false)}
          />
          <motion.div
            initial={{ y: prefersReduced ? 0 : 40, opacity: prefersReduced ? 1 : 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: prefersReduced ? 0 : 40, opacity: 0 }}
            transition={prefersReduced ? { duration: 0 } : { type: "spring", damping: 30, stiffness: 340 }}
            className="relative w-full sm:max-w-sm m-3 mb-[calc(env(safe-area-inset-bottom)+12px)] rounded-3xl bg-surface border border-border p-5 space-y-4"
          >
            <div>
              <h3 className="text-[17px] font-bold text-text-primary">{state.title}</h3>
              {state.text && <p className="text-[15px] text-text-secondary mt-1.5 leading-relaxed">{state.text}</p>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => onClose(false)} className="flex-1 min-h-12 rounded-xl bg-surface-elevated border border-border text-text-primary text-[15px] font-semibold active:scale-[0.98] transition-transform">
                Abbrechen
              </button>
              <button onClick={() => onClose(true)} className="flex-1 min-h-12 rounded-xl bg-[#bd5138] text-white text-[15px] font-semibold active:scale-[0.98] transition-transform">
                {state.confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const dialog = <ConfirmDialog state={state} onClose={(ok) => { state?.resolve(ok); setState(null); }} />;
  return [ask, dialog] as const;
}

/** Portionen lesbar: „2“ → „2 Portionen“, Freitext bleibt. */
function fmtPortions(p: string | null): string | null {
  if (!p) return null;
  const t = p.trim();
  if (/^\d+([,.]\d+)?$/.test(t)) return `${t} ${t === "1" ? "Portion" : "Portionen"}`;
  if (/^\d+\s*[–-]\s*\d+$/.test(t)) return `${t} Portionen`;
  return t;
}

function RecipeDetail({
  r, onClose, rating = 0, onRate, dislikeHitList = [],
  friends = [], cookEntries = [], onAddCook, onDeleteCook,
}: {
  r: Recipe; onClose: () => void;
  rating?: number; onRate?: (n: number | null) => void;
  dislikeHitList?: string[];
  friends?: Friend[];
  cookEntries?: CookEvent[];
  onAddCook?: (partnerGuest: string | null, cookedOn: string) => void;
  onDeleteCook?: (id: number) => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [cookPartner, setCookPartner] = useState("");
  const [cookDate, setCookDate] = useState(todayISO());
  const [ask, confirmDialog] = useConfirm();
  const prefersReduced = useReducedMotion();
  const [descOpen, setDescOpen] = useState(false);
  // Wie ein iOS-Sheet (21.10.2026): Steht der Inhalt ganz oben, schließt Nach-unten-Ziehen
  // von ÜBERALL im Fenster, nicht nur am Griff. Eigene Touch-Logik statt framer-drag, damit
  // normales Scrollen im Rezept nicht abgefangen wird.
  const scrollRef = useRef<HTMLDivElement>(null);
  const pullY = useMotionValue(0);
  const backdropOp = useTransform(pullY, [0, 320], [1, 0.35]);
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || prefersReduced) return;
    let startY = 0, startT = 0, pulling = false, tracking = false;
    const onStart = (e: TouchEvent) => {
      tracking = el.scrollTop <= 0;
      pulling = false;
      startY = e.touches[0].clientY;
      startT = performance.now();
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dy = e.touches[0].clientY - startY;
      if (!pulling && dy > 6 && el.scrollTop <= 0) pulling = true;
      if (!pulling) { if (dy < 0) tracking = false; return; }
      e.preventDefault();
      pullY.set(Math.max(0, dy * 0.9));
    };
    const onEnd = () => {
      if (!pulling) return;
      const dy = pullY.get();
      const v = dy / Math.max(1, performance.now() - startT);
      pulling = false;
      if (dy > 110 || v > 0.6) onClose();
      else animate(pullY, 0, { type: "spring", stiffness: 420, damping: 36 });
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [onClose, pullY, prefersReduced]);

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const totalIngredients = r.ingredients.reduce((s, g) => s + g.items.length, 0);
  const checkedCount = checked.size;
  const isInstagram = r.source ? /instagram\.com/i.test(r.source) : false;
  const portions = fmtPortions(r.portions);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <motion.div
        initial={{ opacity: prefersReduced ? 1 : 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        onClick={onClose}
      >
        <motion.div className="absolute inset-0 bg-black/70" style={{ opacity: backdropOp }} />
      </motion.div>
      <motion.div
        initial={{ y: prefersReduced ? 0 : "100%" }}
        animate={{ y: 0 }}
        exit={{ y: prefersReduced ? 0 : "100%" }}
        transition={prefersReduced ? { duration: 0 } : { type: "spring", damping: 34, stiffness: 300 }}
        className="relative w-full sm:max-w-lg"
      >
      <motion.div
        ref={scrollRef}
        style={{ y: pullY }}
        className="relative w-full h-[calc(100dvh-env(safe-area-inset-top)-10px)] sm:h-auto sm:max-h-[90dvh] overflow-y-auto overscroll-contain bg-surface sm:rounded-2xl rounded-t-[22px] border border-border"
      >
        {/* Griff als Hinweis: das ganze Fenster lässt sich nach unten wegziehen */}
        <div className="flex justify-center pt-2 pb-1" aria-hidden>
          <span className="w-10 h-[5px] rounded-full bg-text-faint/60" />
        </div>

        {/* Kopf (21.10.2026): Titel und Beschreibung oben, Bilder darunter in Daumenhöhe */}
        <div className="px-4 pt-1 flex items-start gap-3">
          <h2 className="flex-1 min-w-0 text-[22px] font-extrabold leading-[1.15] tracking-tight text-text-primary text-balance">{r.name}</h2>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="shrink-0 -mt-1 -mr-1.5 w-11 h-11 rounded-full bg-surface-elevated text-text-secondary flex items-center justify-center active:scale-95 transition-transform"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {r.description && (
          <button
            onClick={() => setDescOpen((o) => !o)}
            className={`block px-4 mt-1 text-left text-[14px] text-text-secondary leading-snug ${descOpen ? "" : "line-clamp-2"}`}
          >
            {r.description}
          </button>
        )}

        {/* Bilder: swipebar, ohne Verlauf darüber */}
        <div className="px-4 mt-3">
          <div className="relative aspect-[3/2] w-full overflow-hidden rounded-2xl bg-surface-elevated">
            <GalleryHeader r={r} />
          </div>
        </div>

        {/* Zutaten-Fortschritt als schwebende Insel */}
        <AnimatePresence>
          {checkedCount > 0 && (
            <motion.div
              initial={{ y: -20, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -20, opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", damping: 24, stiffness: 320 }}
              className="sticky top-2 z-30 mx-auto w-fit flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/80 text-white shadow-lg"
            >
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-semibold tabular-nums">
                <NumberFlow value={checkedCount} /> / {totalIngredients} Zutaten
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="p-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-3.5">
          {/* Nährwerte + Video-Link in einer Zeile */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0"><MacroChips r={r} animate /></div>
            {r.source && (
              <a
                href={r.source}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 inline-flex items-center gap-1.5 min-h-11 pl-3.5 pr-4 rounded-full text-sm font-semibold active:scale-95 transition-transform text-white"
                style={{ background: isInstagram ? "linear-gradient(120deg,#f09433,#e6683c 30%,#dc2743 60%,#cc2366 90%)" : "var(--text-secondary)" }}
              >
                {isInstagram ? <InstagramIcon className="w-4 h-4" /> : <ExternalLink className="w-4 h-4" />}
                {isInstagram ? "Video" : "Quelle"}
              </a>
            )}
          </div>
          {dislikeHitList.length > 0 && (
            <p className="text-[13px] text-[#bd5138] flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
              Enthält {dislikeHitList.join(", ")}, magst du laut deinem Account nicht.
            </p>
          )}

          {/* Zeit + Portionen: eine ruhige Zeile, keine Pills */}
          {(r.totalTime || portions) && (
            <p className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[15px] text-text-primary">
              {r.totalTime && <span className="inline-flex items-center gap-1.5"><Clock className="w-4 h-4 text-text-muted" />{r.totalTime}</span>}
              {portions && <span className="inline-flex items-center gap-1.5"><Users className="w-4 h-4 text-text-muted" />{portions}</span>}
            </p>
          )}

          {/* Zutaten mit Abhak-Funktion */}
          {r.ingredients.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Zutaten</h3>
              <div className="space-y-2">
                {r.ingredients.map((g, gi) => (
                  <div key={gi}>
                    {g.group && <p className="text-[13px] font-semibold text-text-secondary mt-2">{g.group}</p>}
                    <div>
                      {g.items.map((item, ii) => {
                        const key = `${gi}-${ii}`;
                        const isChecked = checked.has(key);
                        return (
                          <button
                            key={key}
                            onClick={() => toggle(key)}
                            className="w-full min-h-11 flex items-start gap-3 py-2.5 px-1 rounded-lg text-left active:bg-surface-elevated transition-colors"
                          >
                            <motion.span
                              animate={{ scale: isChecked ? [1, 1.25, 1] : 1 }}
                              transition={{ duration: 0.25 }}
                              className={`shrink-0 mt-0.5 w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center text-[11px] transition-colors ${isChecked ? "bg-accent border-accent text-white" : "border-text-faint text-transparent"}`}
                            >
                              ✓
                            </motion.span>
                            <span className={`text-base leading-snug transition-colors ${isChecked ? "text-text-muted line-through" : "text-text-primary"}`}>{item}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Zubereitung und Tipps zugeklappt (21.10.2026: Fenster soll auf einen Blick passen) */}
          {r.lite && (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Zubereitung lädt …
            </div>
          )}
          {(r.steps.length > 0 || r.tips.length > 0) && (
            <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
              {r.steps.length > 0 && (
                <Collapsible title={`Zubereitung · ${r.steps.length} Schritte`} icon={ChefHat}>
                  <ol className="space-y-3.5 pt-1">
                    {r.steps.map((st, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent text-[13px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                        <p className="text-base text-text-primary leading-relaxed">{st}</p>
                      </li>
                    ))}
                  </ol>
                </Collapsible>
              )}
              {r.tips.length > 0 && (
                <Collapsible title={`Tipps · ${r.tips.length}`} icon={Lightbulb}>
                  <ul className="space-y-1.5 pt-1">
                    {r.tips.map((t, i) => (
                      <li key={i} className="text-[15px] text-text-secondary leading-relaxed flex gap-2"><span className="text-accent">·</span>{t}</li>
                    ))}
                  </ul>
                </Collapsible>
              )}
            </div>
          )}

          {/* Ganz unten, eingeklappt: Bewerten und Koch-Verlauf (Teilen entfällt, 21.10.2026) */}
          {(onRate || onAddCook) && (
            <div className="rounded-xl border border-border overflow-hidden">
              <Collapsible
                title={[
                  rating ? `${rating} ★` : "Bewerten",
                  cookEntries.length ? `gekocht ${fmtDay(cookEntries[0].cookedOn)}` : "gekocht?",
                ].join(" · ")}
                icon={Star}
              >
                <div className="space-y-2">
                  {onRate && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] text-text-muted">Deine Bewertung</span>
                      <StarRating value={rating} onChange={onRate} size={26} />
                    </div>
                  )}
                  {onAddCook && (
                    <div className="space-y-2 pt-1">
                      {cookEntries.map((e) => (
                        <div key={e.id} className="flex items-center gap-2 text-sm">
                          <span className="text-text-secondary">{fmtDay(e.cookedOn)}{e.withName ? ` · mit ${e.withName}` : " · alleine"}</span>
                          {e.isAuthor && onDeleteCook && (
                            <button
                              onClick={async () => {
                                if (await ask({ title: "Eintrag löschen?", text: `Gekocht am ${fmtDay(e.cookedOn)}${e.withName ? ` mit ${e.withName}` : ""}.`, confirmLabel: "Löschen" })) onDeleteCook(e.id);
                              }}
                              aria-label="Eintrag entfernen"
                              className="ml-auto -mr-2 w-11 h-11 flex items-center justify-center text-text-muted active:scale-90 transition-transform"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="relative">
                          <select value={cookPartner} onChange={(e) => setCookPartner(e.target.value)} aria-label="Mit wem"
                            className="appearance-none w-full h-11 text-[15px] bg-surface border border-border rounded-xl pl-3 pr-8 text-text-primary">
                            <option value="">Alleine</option>
                            {friends.map((f) => <option key={f.guestId} value={f.guestId}>mit {f.name}</option>)}
                          </select>
                          <ChevronDown className="w-4 h-4 text-text-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                        <input type="date" value={cookDate} max={todayISO()} onChange={(e) => setCookDate(e.target.value)} aria-label="Datum"
                          className="w-full min-w-0 h-11 text-[15px] bg-surface border border-border rounded-xl px-3 text-text-primary" />
                        <button onClick={() => onAddCook(cookPartner || null, cookDate || todayISO())}
                          className="col-span-2 h-11 text-[15px] font-semibold text-white bg-accent rounded-xl active:scale-[0.98] transition-transform">
                          Eintragen
                        </button>
                      </div>
                    </div>

                  )}
                </div>
              </Collapsible>
            </div>
          )}
        </div>
      </motion.div>
      </motion.div>
      {confirmDialog}
    </div>
  );
}

// ── Rezept einreichen (Gäste) ─────────────────────────────────
// Volles Formular (Essentials + Bild). Geht an /api/recipes/submit (multipart) →
// fertige Template-.md + WebP im DATA_DIR + n8n-Webhook → landet via n8n in Obsidian.

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">{children}</label>;
}

// ── Sprach-Rekorder (MediaRecorder) ───────────────────────────
// Tap = Start, Tap = Stopp (robuster als Halten auf Mobil). Danach Wiedergabe + Neu.
function VoiceRecorder({ onAudioChange }: { onAudioChange: (blob: Blob | null) => void }) {
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStream = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  // Aktuelle Blob-URL im Ref, damit das Aufräumen beim Schließen die echte freigibt
  // (die Closure sah sonst nur den Startwert null).
  const audioUrlRef = useRef<string | null>(null);
  useEffect(() => { audioUrlRef.current = audioUrl; }, [audioUrl]);
  useEffect(() => () => { stopStream(); if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); }, []);

  const pickMime = () => {
    const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    return cands.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t)) || "";
  };

  const start = async () => {
    setError(null);
    if (audioUrl) { URL.revokeObjectURL(audioUrl); setAudioUrl(null); }
    onAudioChange(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        onAudioChange(blob);
        stopStream();
      };
      mr.start();
      mrRef.current = mr;
      setSeconds(0);
      setRecording(true);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("Mikrofon-Zugriff nicht möglich. Erlaube ihn in den Browser-Einstellungen.");
    }
  };

  const stop = () => {
    try { mrRef.current?.stop(); } catch { /* ignore */ }
    setRecording(false);
  };

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // Aufgenommen → Wiedergabe + Neu
  if (audioUrl && !recording) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#3f6b43]">
          <Check className="w-4 h-4" /> Aufnahme fertig
        </div>
        <audio src={audioUrl} controls className="w-full" />
        <button onClick={start} className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent">
          <RotateCcw className="w-3.5 h-3.5" /> Neu aufnehmen
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <motion.button
        onClick={recording ? stop : start}
        animate={recording ? { scale: [1, 1.05, 1] } : { scale: 1 }}
        transition={recording ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : { type: "spring", stiffness: 300, damping: 20 }}
        className={`relative w-20 h-20 rounded-full flex items-center justify-center text-white ${recording ? "bg-[#bd5138]" : "bg-accent"}`}
        aria-label={recording ? "Aufnahme stoppen" : "Aufnahme starten"}
      >
        {recording && [0, 0.9].map((delay, i) => (
          <motion.span
            key={i}
            className="absolute inset-0 rounded-full bg-[#bd5138]/30"
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: 2, opacity: 0 }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay }}
          />
        ))}
        <span className="relative z-10">{recording ? <Square className="w-7 h-7 fill-white" /> : <Mic className="w-8 h-8" />}</span>
      </motion.button>
      <div className="text-center">
        {recording ? (
          <>
            <p className="text-sm font-bold text-[#bd5138] tabular-nums">{mmss(seconds)}</p>
            <p className="text-[11px] text-text-muted">Läuft … tippen zum Stoppen</p>
          </>
        ) : (
          <p className="text-[11px] text-text-muted">Tippen und das Rezept einsprechen</p>
        )}
      </div>
      {error && <p className="text-xs text-[#bd5138] text-center">{error}</p>}
    </div>
  );
}

function SuggestSheet({ onClose, defaultName, guestId, onSubmitted }: { onClose: () => void; defaultName?: string; guestId?: string; onSubmitted?: () => void }) {
  const toast = useToast();
  const prefersReduced = useReducedMotion();
  const [submitter, setSubmitter] = useState(defaultName ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Hauptgericht");
  const [ingredients, setIngredients] = useState("");
  const [steps, setSteps] = useState("");
  const [tips, setTips] = useState("");
  const [source, setSource] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<"text" | "audio">("text");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [showImageReminder, setShowImageReminder] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);
  const previewRef = useRef<string | null>(null);
  useEffect(() => { previewRef.current = imagePreview; }, [imagePreview]);
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  const pickImage = (f: File | null) => {
    setImageFile(f);
    setImagePreview((prev) => { if (prev) URL.revokeObjectURL(prev); return f ? URL.createObjectURL(f) : null; });
  };

  const inputCls = "w-full px-3 py-2.5 rounded-xl bg-surface-elevated border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent";

  // Bei Sprachnachricht ohne Foto einmal freundlich erinnern (man kann trotzdem absenden).
  const handleSubmit = () => {
    if (mode === "audio" && !imageFile) { setShowImageReminder(true); return; }
    doSubmit();
  };

  const doSubmit = async () => {
    const fd = new FormData();
    fd.append("mode", mode);
    fd.append("submittedBy", submitter);
    if (guestId) fd.append("guestId", guestId);
    if (imageFile) fd.append("image", imageFile);

    if (mode === "audio") {
      if (!audioBlob) { toast.error("Fast!", "Nimm zuerst eine Sprachnachricht auf."); return; }
      fd.append("audio", audioBlob, "aufnahme.webm");
      if (name.trim()) fd.append("name", name);
    } else {
      // Nur ein Link: den liest die n8n-Automation aus, Name und Zutaten braucht es dann nicht.
      const linkOnly = /https?:\/\//i.test(source);
      if (!name.trim() && !linkOnly) { toast.error("Fast!", "Gib dem Rezept einen Namen."); return; }
      if (!linkOnly && !ingredients.trim() && !steps.trim()) { toast.error("Fast!", "Zutaten oder Zubereitung fehlen."); return; }
      fd.append("name", name);
      fd.append("description", description);
      fd.append("category", category);
      fd.append("ingredients", ingredients);
      fd.append("steps", steps);
      fd.append("tips", tips);
      fd.append("source", source);
    }

    setSending(true);
    try {
      const res = await fetch("/api/recipes/submit", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Danke!", d.mode === "link"
          ? "Dein Link wird automatisch ausgelesen — das Rezept landet gleich bei Christian 🔗🍽️"
          : mode === "audio"
          ? "Deine Sprachnachricht ist unterwegs — Christian macht ein Rezept draus 🍽️"
          : "Dein Rezept ist bei Christian gelandet 🍽️");
        onSubmitted?.();
        onClose();
      } else {
        toast.error("Hat nicht geklappt", (d.error as string) ?? "Versuch's gleich nochmal.");
      }
    } catch {
      toast.error("Keine Verbindung", "Versuch's gleich nochmal.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <motion.div
        initial={{ opacity: prefersReduced ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60" onClick={onClose}
      />
      <motion.div
        initial={{ y: prefersReduced ? 0 : "100%" }} animate={{ y: 0 }} exit={{ y: prefersReduced ? 0 : "100%" }}
        transition={prefersReduced ? { duration: 0 } : { type: "spring", damping: 34, stiffness: 300 }}
        className="relative w-full sm:max-w-md max-h-[92dvh] overflow-y-auto overscroll-contain bg-surface sm:rounded-2xl rounded-t-2xl border border-border p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4"
      >
        <div className="flex items-start justify-between sticky top-0 -mt-1 pt-1 bg-surface z-10">
          <div>
            <h2 className="text-lg font-extrabold text-text-primary tracking-tight">Rezept einreichen</h2>
            <p className="text-xs text-text-muted mt-0.5">Fülls aus — landet in Christians Kochbuch.</p>
          </div>
          <button onClick={onClose} aria-label="Schließen" className="p-1.5 rounded-lg text-text-muted hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3.5">
          {/* Umschalter: Tippen / Sprechen */}
          <div className="flex items-center rounded-full bg-surface-elevated p-1 border border-border">
            {([["text", Pencil, "Tippen"], ["audio", Mic, "Sprechen"]] as const).map(([m, Icon, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-1.5 rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${mode === m ? "bg-surface text-text-primary shadow-sm" : "text-text-muted"}`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          <AnimatedInput label="Dein Name" value={submitter} onChange={setSubmitter} />

          {mode === "audio" ? (
            <>
              <AnimatedInput label="Name des Gerichts (optional)" value={name} onChange={setName} />
              <div className="rounded-2xl border border-border bg-surface-elevated/40 p-4">
                <p className="text-xs text-text-secondary leading-relaxed mb-1 text-center">
                  Sprich das Rezept ein — <span className="font-semibold text-text-primary">Zutaten, Zubereitung</span> und ein paar Tipps. Christian macht daraus automatisch ein Rezept.
                </p>
                <VoiceRecorder onAudioChange={setAudioBlob} />
              </div>
            </>
          ) : (
            <>
              <AnimatedInput label="Name des Gerichts" value={name} onChange={setName} />
              <AnimatedInput label="Kurzbeschreibung" value={description} onChange={setDescription} />

              <div>
                <FieldLabel>Kategorie</FieldLabel>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                  {["Frühstück", "Hauptgericht", "Dessert"].map((c) => (
                    <option key={c} value={c}>{catLabel(c)}</option>
                  ))}
                </select>
              </div>

              <div>
                <FieldLabel>Zutaten — eine pro Zeile</FieldLabel>
                <textarea value={ingredients} onChange={(e) => setIngredients(e.target.value)} rows={4}
                  placeholder={"200 g Mehl\n2 Eier\n1 Prise Salz"} className={`${inputCls} resize-none leading-relaxed`} />
              </div>

              <div>
                <FieldLabel>Zubereitung — ein Schritt pro Zeile</FieldLabel>
                <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={4}
                  placeholder={"Ofen auf 180°C vorheizen\nAlles verrühren\n25 Min backen"} className={`${inputCls} resize-none leading-relaxed`} />
              </div>

              <div>
                <FieldLabel>Tipps (optional)</FieldLabel>
                <textarea value={tips} onChange={(e) => setTips(e.target.value)} rows={2}
                  placeholder="Schmeckt auch mit …" className={`${inputCls} resize-none leading-relaxed`} />
              </div>

              <div>
                <AnimatedInput label="Quelle / Link (optional)" value={source} onChange={setSource} inputMode="url" />
                <p className="text-[11px] text-text-muted mt-1 leading-snug">
                  🔗 Instagram-, Pinterest- oder Website-Link? Reicht — wir lesen das Rezept automatisch aus. Die anderen Felder kannst du dann leer lassen.
                </p>
              </div>
            </>
          )}

          <div>
            <FieldLabel>Foto (optional)</FieldLabel>
            {imagePreview ? (
              <div className="relative rounded-xl overflow-hidden border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="Vorschau" className="w-full max-h-52 object-cover" />
                <button onClick={() => pickImage(null)} aria-label="Foto entfernen"
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center active:scale-95">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 w-full py-6 rounded-xl border border-dashed border-border text-text-muted text-sm cursor-pointer active:scale-[0.99] transition-transform">
                <ImagePlus className="w-5 h-5" /> Foto auswählen
                <input type="file" accept="image/*" className="hidden"
                  onChange={(e) => pickImage(e.target.files?.[0] ?? null)} />
              </label>
            )}
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={sending || (mode === "audio" ? !audioBlob : (!name.trim() && !/https?:\/\//i.test(source)))}
          className="w-full py-3 rounded-xl bg-accent text-white text-sm font-semibold active:scale-[0.98] transition-transform disabled:bg-[#dea89b] flex items-center justify-center gap-2 sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {sending ? "Sende…" : mode === "audio" ? "Sprachnachricht absenden" : (/https?:\/\//i.test(source) && !name.trim() ? "Link auslesen lassen" : "Rezept absenden")}
        </button>

        {/* Foto-Erinnerung (nur Sprachnachricht ohne Bild) */}
        {showImageReminder && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="absolute inset-0 z-20 flex items-end justify-center bg-black/40 sm:rounded-2xl"
            onClick={() => setShowImageReminder(false)}
          >
            <motion.div
              initial={{ y: prefersReduced ? 0 : 30 }} animate={{ y: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-surface border-t border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-3 text-center"
            >
              <div className="text-3xl">📸</div>
              <div>
                <h3 className="text-base font-bold text-text-primary">Hast du ein Foto vom Gericht?</h3>
                <p className="text-xs text-text-muted mt-1 leading-relaxed">Ein Bild macht das Rezept viel schöner — kein Muss.</p>
              </div>
              <button
                onClick={() => setShowImageReminder(false)}
                className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-semibold active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              >
                <ImagePlus className="w-4 h-4" /> Foto hinzufügen
              </button>
              <button
                onClick={() => { setShowImageReminder(false); doSubmit(); }}
                className="w-full py-2.5 rounded-xl bg-surface-elevated border border-border text-text-secondary text-sm font-medium active:scale-[0.98] transition-transform"
              >
                Ohne Foto absenden
              </button>
            </motion.div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

// ── Auth-Gate (Login-Pflicht: Registrieren oder Einloggen) ────────────────────
// Ersetzt die alte Namensabfrage. Benutzername + Passwort (serverseitig gehasht).
// onDone bekommt Name, guestId und — falls vorhanden — die Server-Bewertungen,
// damit der Stand auf jedem Gerät hergestellt wird.

function AuthGate({ onDone }: { onDone: (name: string, id: string, verdicts?: Record<string, Verdict>) => void }) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";

  const submit = async () => {
    const u = username.trim();
    if (!u || !password) { setErr("Benutzername und Passwort eingeben."); return; }
    setBusy(true); setErr(null);
    try {
      let existingId = "";
      try { existingId = localStorage.getItem(ID_KEY) || ""; } catch { /* ignore */ }
      const body = isRegister ? { username: u, password, guestId: existingId } : { username: u, password };
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr((d.error as string) ?? "Hat nicht geklappt."); return; }
      try { localStorage.setItem(NAME_KEY, d.name); localStorage.setItem(ID_KEY, d.guestId); } catch { /* ignore */ }
      onDone(d.name, d.guestId, d.verdicts as Record<string, Verdict> | undefined);
    } catch {
      setErr("Keine Verbindung. Versuch's gleich nochmal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "var(--bg)", color: "var(--text-primary)" }}>
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 260 }}
        className="w-full max-w-sm text-center"
      >
        <div className="text-5xl mb-4">🍽️</div>
        <h1 className="text-[1.7rem] font-extrabold text-text-primary tracking-tight leading-tight">Wisch dich satt</h1>
        <p className="text-sm text-text-secondary mt-2 mb-5 leading-relaxed">
          {isRegister
            ? "Erstell dir einen Account — dann findest du deine Sachen auf jedem Gerät wieder."
            : "Willkommen zurück! Melde dich an."}
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="bg-surface border border-border rounded-3xl p-5 shadow-[0_10px_30px_rgba(70,50,30,0.10)] space-y-3"
        >
          <div className="flex items-center rounded-full bg-surface-elevated p-1 border border-border">
            {([["register", "Registrieren"], ["login", "Einloggen"]] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setErr(null); }}
                className={`flex-1 py-1.5 rounded-full text-xs font-semibold transition-colors ${mode === m ? "bg-surface text-text-primary shadow-sm" : "text-text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* autoComplete + echtes <form>: erst dann bietet das iPhone an, Name und Passwort im
              Schlüsselbund zu sichern, und füllt sie beim nächsten Mal per Face ID ein
              (Safari und Home-Bildschirm-App haben getrennten Speicher → zweites Login). */}
          <AnimatedInput label="Benutzername" name="username" autoComplete="username" value={username} onChange={setUsername} autoFocus />
          <AnimatedInput label="Passwort" name="password" autoComplete={isRegister ? "new-password" : "current-password"} value={password} onChange={setPassword} type="password" />

          {err && <p className="text-xs text-[#bd5138] text-left">{err}</p>}

          <button
            type="submit"
            disabled={busy || !username.trim() || !password}
            className="w-full py-3 rounded-xl bg-accent text-white text-sm font-semibold active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isRegister ? "Los geht's" : "Einloggen"}
            {!busy && <ChevronRight className="w-4 h-4" />}
          </button>
        </form>

        <p className="text-[11px] text-text-muted mt-4">
          {isRegister
            ? "Merk dir Benutzername + Passwort — damit kommst du überall wieder rein."
            : "Neu hier? Wechsle oben auf Registrieren."}
        </p>
      </motion.div>
    </div>
  );
}

// ── Match-Animation ("Es ist ein Match!") ─────────────────────────────────────
// Feuert, wenn man rechts/hoch auf ein Gericht swipt, das ein:e verbundene:r
// Freund:in schon mag. Vollbild-Overlay mit schwebenden Herzen.

function MatchCelebration({
  match, onClose,
}: {
  match: { recipe: Recipe; partners: MatchPing[] };
  onClose: () => void;
}) {
  const prefersReduced = useReducedMotion();
  const { recipe, partners } = match;
  const names = partners.map((p) => p.name);
  const nameStr = names.length <= 1
    ? (names[0] ?? "jemand")
    : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  const anySuper = partners.some((p) => p.bothSuper);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: "radial-gradient(125% 125% at 50% 12%, rgba(189,81,56,0.97), rgba(63,107,67,0.97))" }}
      />

      {/* Schwebende Küchen-Utensilien */}
      {!prefersReduced && [...Array(9)].map((_, i) => {
        const Icon = [CookingPot, UtensilsCrossed, ChefHat, Soup][i % 4];
        return (
          <motion.div
            key={i}
            className="absolute pointer-events-none text-white/75"
            style={{ left: `${6 + i * 10.5}%`, bottom: "-8%" }}
            initial={{ y: 0, opacity: 0, rotate: -12 }}
            animate={{ y: -820 - (i % 3) * 120, opacity: [0, 1, 1, 0], rotate: 12 }}
            transition={{ duration: 2.6 + (i % 4) * 0.4, delay: 0.12 * i, repeat: Infinity, ease: "easeOut" }}
          >
            <Icon className="w-7 h-7" />
          </motion.div>
        );
      })}

      <motion.div
        initial={{ scale: prefersReduced ? 1 : 0.7, opacity: 0, y: prefersReduced ? 0 : 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={prefersReduced ? { duration: 0 } : { type: "spring", damping: 18, stiffness: 240 }}
        className="relative z-10 w-full max-w-sm text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <motion.p
          initial={{ scale: prefersReduced ? 1 : 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={prefersReduced ? { duration: 0 } : { delay: 0.15, type: "spring", damping: 12, stiffness: 260 }}
          className="text-white text-[2.4rem] leading-none font-black tracking-tight drop-shadow-lg"
        >
          Es ist ein Match!
        </motion.p>
        <p className="text-white/90 text-sm mt-3 font-semibold">
          {anySuper ? "⭐ Doppel-Superlike" : "🍽️ Ihr mögt beide"}
        </p>

        <div className="mt-6 mx-auto w-44 h-44 rounded-[28px] overflow-hidden shadow-2xl ring-4 ring-white/30 bg-black/20">
          <RecipeImage r={recipe} shape="square" sizes="176px" eager className="w-full h-full object-cover" />
        </div>

        <h3 className="text-white text-xl font-extrabold mt-4 leading-tight">{recipe.name}</h3>
        <p className="text-white/85 text-sm mt-1">
          Du und <span className="font-bold">{nameStr}</span> — das könnte was werden 🍽️
        </p>

        <button
          onClick={onClose}
          className="mt-7 w-full py-3 rounded-xl bg-white text-[#bd5138] text-sm font-bold active:scale-[0.98] transition-transform"
        >
          Weiter swipen
        </button>
      </motion.div>
    </div>
  );
}

// ── Account-Seite (Freundescode, Matches, Favoriten, Vorschlag) ───────────────

interface Connection { guestId: string; name: string; friendCode: string }
interface MatchRecipeUI { slug: string; recipeName: string; category: string; mine: Verdict; theirs: Verdict; bothSuper: boolean }
interface MatchGroupUI { partner: Connection; recipes: MatchRecipeUI[] }
// Gruppen (v3.1)
interface GroupMatchUI { slug: string; recipeName: string; category: string; count: number; supers: number; memberCount: number; unanimous: boolean }
interface GroupViewUI { id: string; name: string; code: string; members: { guestId: string; name: string }[]; memberCount: number; matches: GroupMatchUI[]; evening: { plan: GroupMatchUI[]; myPicks: number } }

// ── Meine Einreichungen (Profil) ──────────────────────────────
// Eigene Einreichungen mit Status. Solange eine ausgelesen wird, alle 15 s nachfragen.
interface Submission {
  slug: string;
  status: "veroeffentlicht" | "eingereicht" | "abgelehnt";
  phase: "auslesen" | "fertig" | "fehlgeschlagen";
  grund: string | null;
  erstelltAm: string;
  recipe: Recipe | null;
}

function submissionLabel(s: Submission): { text: string; cls: string } {
  if (s.status === "veroeffentlicht") return { text: "Im Kochbuch", cls: "bg-[#5a8a4f]/12 text-[#4b7a41]" };
  if (s.status === "abgelehnt") return { text: "Nicht übernommen", cls: "bg-[#bd5138]/10 text-[#bd5138]" };
  if (s.phase === "auslesen") return { text: "Wird ausgelesen …", cls: "bg-accent/10 text-accent" };
  if (s.phase === "fehlgeschlagen") return { text: "Auslesen hat nicht geklappt", cls: "bg-[#bd5138]/10 text-[#bd5138]" };
  return { text: "Wartet auf Freigabe", cls: "bg-[#d99a2b]/12 text-[#a8741a]" };
}

function MySubmissions({ guestId, tick, onOpen }: { guestId: string; tick: number; onOpen: (r: Recipe) => void }) {
  const [items, setItems] = useState<Submission[]>([]);
  useEffect(() => {
    if (!guestId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      fetch("/api/einreichungen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guestId }) })
        .then((r) => r.json())
        .then((d) => {
          if (stop || !Array.isArray(d.einreichungen)) return;
          setItems(d.einreichungen);
          if ((d.einreichungen as Submission[]).some((s) => s.status === "eingereicht" && s.phase === "auslesen")) timer = setTimeout(load, 15_000);
        })
        .catch(() => { /* offline egal */ });
    };
    load();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [guestId, tick]);

  if (items.length === 0) return null;
  return (
    <div className="order-7 rounded-2xl border border-border bg-surface p-4">
      <h3 className="text-sm font-bold text-text-primary mb-2.5">Meine Einreichungen</h3>
      <ul className="space-y-2">
        {items.map((s) => {
          const l = submissionLabel(s);
          const r = s.recipe;
          const canOpen = !!r && s.phase !== "auslesen";
          return (
            <li key={s.slug}>
              <button
                onClick={() => canOpen && r && onOpen(r)}
                disabled={!canOpen}
                className="w-full min-h-11 flex items-center gap-3 text-left rounded-xl active:scale-[0.99] transition-transform disabled:active:scale-100"
              >
                <div className="w-11 h-11 shrink-0 rounded-lg overflow-hidden bg-surface-elevated">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r?.image && <img src={imageSrc(r.image, "square", 160, "webp", r.imageFocus)} alt="" className="w-full h-full object-cover" loading="lazy" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary truncate">{r?.name ?? "Rezept"}</p>
                  <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${l.cls}`}>{l.text}</span>
                  {s.grund && <p className="text-[11px] text-text-muted mt-0.5 line-clamp-2">{s.grund}</p>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

// ── „Heute gemerkt“-Kacheln mit Wackel-Modus (21.10.2026) ─────
// Gedrückt halten (0,45 s) → alle Kacheln wackeln wie auf dem iPhone-Homescreen, jede hat ein ✕.
// Antippen des ✕ entfernt das Gericht aus „Heute gemerkt“; „Fertig“ oder Tipp daneben beendet.
function TodayGrid({ picks, onOpen, onRemove }: {
  picks: { r: Recipe; v: Verdict; at: string }[];
  onOpen: (r: Recipe) => void;
  onRemove: (slug: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const startPress = () => {
    longPressed.current = false;
    timer.current = setTimeout(() => {
      longPressed.current = true;
      setEditing(true);
      try { navigator.vibrate?.(12); } catch { /* iOS kann das nicht */ }
    }, 450);
  };
  const endPress = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  // Letztes Gericht entfernt → Modus endet von selbst
  const isEditing = editing && picks.length > 0;

  return (
    <div>
      {isEditing && (
        <div className="flex items-center justify-between mb-2">
          <p className="text-[13px] text-text-muted">Tippe auf ✕, um ein Gericht zu entfernen.</p>
          <button onClick={() => setEditing(false)} className="min-h-9 px-3.5 rounded-full bg-accent text-white text-[13px] font-semibold active:scale-95 transition-transform">
            Fertig
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <AnimatePresence initial={false}>
          {picks.map(({ r, v, at }, i) => (
            <motion.div
              key={r.slug}
              layout
              exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.18 } }}
              className={`relative ${isEditing ? "wiggle" : ""}`}
              style={isEditing ? { animationDelay: `${(i % 4) * -0.07}s` } : undefined}
            >
              <button
                onClick={() => { if (longPressed.current) { longPressed.current = false; return; } if (!isEditing) onOpen(r); }}
                onPointerDown={startPress}
                onPointerUp={endPress}
                onPointerLeave={endPress}
                onPointerCancel={endPress}
                onContextMenu={(e) => e.preventDefault()}
                className="relative block w-full rounded-xl overflow-hidden aspect-[4/3] bg-surface-elevated text-left active:scale-[0.98] transition-transform select-none [-webkit-touch-callout:none]"
              >
                <RecipeImage r={r} shape="wide" sizes="(min-width: 640px) 33vw, 50vw" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black/85 to-transparent" />
                {v === "super" && (
                  <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-[#d99a2b] flex items-center justify-center"><Star className="w-3.5 h-3.5 fill-white text-white" /></span>
                )}
                <div className="absolute inset-x-0 bottom-0 p-2">
                  <p className="text-white text-[13px] font-semibold leading-tight line-clamp-2 drop-shadow">{r.name}</p>
                  <p className="text-white/85 text-[12px] mt-0.5 flex items-center gap-1">
                    {r.totalTime && <><Clock className="w-3 h-3" />{r.totalTime}</>}
                    {r.totalTime && fmtTime(at) && <span className="opacity-60">·</span>}
                    {fmtTime(at) && <span>{fmtTime(at)} Uhr</span>}
                  </p>
                </div>
              </button>
              {isEditing && (
                <button
                  onClick={() => onRemove(r.slug)}
                  aria-label={`${r.name} aus Heute gemerkt entfernen`}
                  className="absolute -top-2 -left-2 z-10 w-11 h-11 flex items-center justify-center"
                >
                  <span className="w-7 h-7 rounded-full bg-text-primary/85 text-surface flex items-center justify-center shadow-md">
                    <X className="w-4 h-4" strokeWidth={3} />
                  </span>
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Ein Eintrag in „Heute gemerkt“ / „Gestern“
interface DayPick { slug: string; v: Verdict; at: string }

function AccountView({
  guestId, guestName, recipes, verdicts, ratings, dislikes, cookEvents, onOpen, onSuggest, onLogout, onPlanEvening, onSaveDislikes, onConnections,
  todayPicks, yesterdayPicks, yesterdayVisible, likeCounts, onGoSwipe, submitTick, onRemoveToday,
}: {
  submitTick: number;
  onRemoveToday: (slug: string) => void;
  todayPicks: DayPick[];
  yesterdayPicks: DayPick[];
  yesterdayVisible: boolean;
  likeCounts: Record<string, number>;
  onGoSwipe: () => void;
  guestId: string;
  guestName: string;
  recipes: Recipe[];
  verdicts: Record<string, Verdict>;
  ratings: Record<string, number>;
  dislikes: string[];
  cookEvents: CookEvent[];
  onOpen: (r: Recipe) => void;
  onSuggest: () => void;
  onLogout: () => void;
  onPlanEvening: (id: string, name: string) => void;
  onSaveDislikes: (list: string[]) => void;
  onConnections: (list: Friend[]) => void; // hält das „mit wem“-Dropdown im Detail aktuell
}) {
  const toast = useToast();
  const [friendCode, setFriendCode] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [matches, setMatches] = useState<MatchGroupUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [groups, setGroups] = useState<GroupViewUI[]>([]);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);

  const bySlug = useMemo(() => {
    const m = new Map<string, Recipe>();
    for (const r of recipes) m.set(r.slug, r);
    return m;
  }, [recipes]);

  const [ask, confirmDialog] = useConfirm();
  const [yesterdayOpen, setYesterdayOpen] = useState(true);

  // „Insgesamt oft gemocht“: an wie vielen Tagen gemocht (absteigend). Wer einen Dauer-Favoriten
  // ohne Tageseintrag hat (z. B. vor der Synchronisierung), zählt als 1×.
  const favs = useMemo(() => {
    const n = new Map<string, number>();
    for (const [slug, c] of Object.entries(likeCounts)) if (c > 0) n.set(slug, c);
    for (const [slug, v] of Object.entries(verdicts)) if (isLike(v) && !n.has(slug)) n.set(slug, 1);
    return [...n.entries()]
      .map(([slug, count]) => ({ r: bySlug.get(slug), v: verdicts[slug], count }))
      .filter((x): x is { r: Recipe; v: Verdict; count: number } => !!x.r)
      .sort((a, b) => b.count - a.count || Number(b.v === "super") - Number(a.v === "super") || a.r.name.localeCompare(b.r.name, "de"));
  }, [likeCounts, verdicts, bySlug]);

  const pickRecipes = (list: DayPick[]) =>
    list.map((p) => ({ ...p, r: bySlug.get(p.slug) })).filter((x): x is DayPick & { r: Recipe } => !!x.r);
  const today = pickRecipes(todayPicks);
  const yesterday = pickRecipes(yesterdayPicks);
  // „Schon gekocht" — Gerichte mit Sterne-Bewertung ODER Koch-Verlauf, je Gericht
  // ein Eintrag: Sterne + zuletzt gekocht (Datum) + mit wem.
  const cooked = useMemo(() => {
    const bySlugMap = new Map<string, { r: Recipe; stars: number; lastCookedOn: string | null; withNames: string[] }>();
    const ensure = (slug: string) => {
      let e = bySlugMap.get(slug);
      if (!e) {
        const r = bySlug.get(slug);
        if (!r) return null;
        e = { r, stars: 0, lastCookedOn: null, withNames: [] };
        bySlugMap.set(slug, e);
      }
      return e;
    };
    for (const [slug, stars] of Object.entries(ratings)) {
      const e = ensure(slug);
      if (e) e.stars = stars;
    }
    for (const ce of cookEvents) {
      const e = ensure(ce.slug);
      if (!e) continue;
      if (!e.lastCookedOn || ce.cookedOn > e.lastCookedOn) e.lastCookedOn = ce.cookedOn;
      if (ce.withName && !e.withNames.includes(ce.withName)) e.withNames.push(ce.withName);
    }
    return [...bySlugMap.values()].sort(
      (a, b) => (b.lastCookedOn ?? "").localeCompare(a.lastCookedOn ?? "") || b.stars - a.stars || a.r.name.localeCompare(b.r.name),
    );
  }, [ratings, cookEvents, bySlug]);

  // „Was ich nicht mag" — lokaler Editier-Zustand (Chips + Eingabe).
  const [dislikeInput, setDislikeInput] = useState("");
  const [favsExpanded, setFavsExpanded] = useState(false);
  const addDislike = (raw: string) => {
    const v = raw.trim().toLowerCase().replace(/,+$/, "");
    if (v.length < 2) return;
    if (!dislikes.includes(v)) onSaveDislikes([...dislikes, v]);
    setDislikeInput("");
  };
  const removeDislike = (d: string) => onSaveDislikes(dislikes.filter((x) => x !== d));

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/friends/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, name: guestName }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setFriendCode(d.friendCode ?? "");
        setConnections(d.connections ?? []);
        onConnections((d.connections ?? []).map((c: Connection) => ({ guestId: c.guestId, name: c.name })));
        setMatches(d.matches ?? []);
      }
    } catch { /* offline egal */ } finally {
      setLoading(false);
    }
  }, [guestId, guestName, onConnections]);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "overview", guestId, name: guestName }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setGroups(d.groups ?? []);
    } catch { /* offline egal */ }
  }, [guestId, guestName]);

  // Laden beim Öffnen (setState passiert erst nach dem fetch, nicht synchron)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); loadGroups(); }, [load, loadGroups]);

  const groupAction = useCallback(async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    setGroupBusy(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, name: guestName, ...body }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error("Klappt nicht", (d.error as string) ?? "Versuch's nochmal."); return null; }
      await loadGroups();
      return d;
    } catch {
      toast.error("Keine Verbindung", "Versuch's gleich nochmal."); return null;
    } finally {
      setGroupBusy(false);
    }
  }, [guestId, guestName, loadGroups, toast]);

  const createGroup = async () => {
    const n = groupName.trim();
    if (!n) return;
    const d = await groupAction({ action: "create", groupName: n });
    if (d) { setGroupName(""); toast.success("Gruppe erstellt 🎉", "Teile den Code, damit andere beitreten."); }
  };
  const joinGroup = async () => {
    const c = joinCode.trim();
    if (!c) return;
    const d = await groupAction({ action: "join", code: c });
    if (d) { setJoinCode(""); toast.success("Beigetreten! 🎉", "Ab jetzt seht ihr eure Gruppen-Favoriten."); }
  };
  const leaveGroup = async (groupId: string, name: string, members: number) => {
    const ok = await ask({
      title: `Gruppe „${name}“ verlassen?`,
      text: members <= 1
        ? "Du bist das letzte Mitglied, die Gruppe wird damit gelöscht."
        : "Deine Auswahl für heute Abend in dieser Gruppe wird gelöscht. Zurück kommst du nur mit dem Gruppencode.",
      confirmLabel: "Verlassen",
    });
    if (ok) await groupAction({ action: "leave", groupId });
  };
  const copyGroupCode = async (c: string) => {
    try { await navigator.clipboard.writeText(c); toast.success("Kopiert", "Gruppencode in der Zwischenablage."); } catch { /* ignore */ }
  };
  // Einladungslink: wer ihn öffnet, muss sich einen Account machen und ist dann
  // automatisch in der Gruppe (Auto-Beitritt über `?gruppe=CODE` beim App-Start).
  const inviteToGroup = async (code: string, name: string) => {
    const url = (typeof window !== "undefined" ? window.location.origin : "") + `/?gruppe=${encodeURIComponent(code)}`;
    const text = `Lass uns gemeinsam Essen planen 🍽️\nTritt meiner Gruppe „${name}" bei:`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title: "Essen planen gemeinsam", text, url }); return; } catch (e) { if ((e as Error)?.name === "AbortError") return; /* sonst Fallback */ }
    }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); toast.success("Link kopiert", "Füg ihn z.B. in WhatsApp ein."); } catch { /* ignore */ }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(friendCode);
      toast.success("Kopiert", "Dein Freundescode ist in der Zwischenablage.");
    } catch { /* ignore */ }
  };

  const inviteText = () => {
    const url = typeof window !== "undefined" ? window.location.origin : "";
    return `Lass uns matchen, welches Gericht es geben soll 🍽️\nMein Freundescode: ${friendCode}\n${url}`;
  };
  const invite = async () => {
    const text = inviteText();
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title: "Rezepte-Match", text }); return; } catch (e) { if ((e as Error)?.name === "AbortError") return; /* sonst Fallback */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Einladung kopiert", "Füg sie z.B. in WhatsApp ein.");
    } catch { /* ignore */ }
  };

  const connect = async () => {
    const c = code.trim();
    if (!c) return;
    setConnecting(true);
    try {
      const res = await fetch("/api/friends/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, name: guestName, code: c }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(d.already ? "Schon verbunden" : "Verbunden! 🎉", `Du und ${d.partner?.name ?? "…"} seid jetzt verknüpft.`);
        setCode("");
        load();
      } else {
        toast.error("Klappt nicht", d.error ?? "Versuch's nochmal.");
      }
    } catch {
      toast.error("Keine Verbindung", "Versuch's gleich nochmal.");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-4">
      {/* Begrüßung */}
      <div className="order-1">
        <h2 className="text-xl font-extrabold text-text-primary tracking-tight">Hey {guestName} 👋</h2>
      </div>

      {/* Heute gemerkt: alles, was heute nach rechts oder hoch ging (Superlikes zuerst) */}
      <div className="order-2">
        <h3 className="text-[15px] font-bold text-text-primary flex items-center gap-1.5 mb-2">
          <Heart className="w-4 h-4 text-[#3f6b43] fill-[#3f6b43]" /> Heute gemerkt
          {today.length > 0 && <span className="text-[13px] font-normal text-text-muted tabular-nums">({today.length})</span>}
        </h3>
        {today.length === 0 ? (
          <div className="bg-surface border border-border rounded-2xl p-4">
            <p className="text-[15px] text-text-secondary leading-relaxed">Heute noch nichts gemerkt. Wisch nach rechts, worauf du heute Lust hast.</p>
            <button onClick={onGoSwipe} className="mt-3 w-full min-h-11 rounded-xl bg-accent text-white text-[15px] font-semibold active:scale-[0.98] transition-transform">
              Zum Stapel
            </button>
          </div>
        ) : (
          <TodayGrid picks={today} onOpen={onOpen} onRemove={onRemoveToday} />
        )}
      </div>

      {/* Gestern: bis 12 Uhr sichtbar, einklappbar */}
      {yesterdayVisible && yesterday.length > 0 && (
        <div className="order-3">
          <button
            onClick={() => setYesterdayOpen((o) => !o)}
            aria-expanded={yesterdayOpen}
            className="w-full min-h-11 flex items-center gap-1.5 text-left"
          >
            <span className="text-[15px] font-bold text-text-primary">Gestern gemerkt</span>
            <span className="text-[13px] text-text-muted tabular-nums">({yesterday.length})</span>
            <ChevronDown className={`w-4 h-4 text-text-muted ml-auto transition-transform ${yesterdayOpen ? "rotate-180" : ""}`} />
          </button>
          {yesterdayOpen && (
            <div className="space-y-1">
              {yesterday.map(({ r, v }) => (
                <button
                  key={r.slug}
                  onClick={() => onOpen(r)}
                  className="w-full min-h-14 flex items-center gap-3 p-1.5 rounded-xl text-left active:bg-surface-elevated transition-colors"
                >
                  <div className="w-11 h-11 shrink-0 rounded-lg overflow-hidden bg-surface-elevated">
                    <RecipeImage r={r} shape="square" sizes="48px" className="w-full h-full object-cover" />
                  </div>
                  <span className="flex-1 min-w-0 text-[15px] font-medium text-text-primary truncate">{r.name}</span>
                  {v === "super" && <Star className="w-4 h-4 shrink-0 fill-[#d99a2b] text-[#d99a2b]" />}
                  {r.totalTime && <span className="shrink-0 text-[13px] text-text-muted">{r.totalTime}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Freundescode */}
      <div className="order-10 rounded-2xl border border-border bg-surface p-4">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Dein Freundescode</p>
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1 text-2xl font-extrabold tracking-[0.12em] text-accent tabular-nums select-all">
            {loading ? "…" : friendCode || "—"}
          </div>
          <button
            onClick={copyCode}
            disabled={!friendCode}
            aria-label="Code kopieren"
            className="w-10 h-10 rounded-xl bg-surface-elevated border border-border flex items-center justify-center text-text-secondary active:scale-95 transition-transform disabled:opacity-40"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[12px] text-text-muted mt-2 leading-relaxed">
          Teile ihn mit Freund:innen — sobald ihr euch verbindet, seht ihr eure gemeinsamen Lieblingsgerichte.
        </p>
        <button
          onClick={invite}
          disabled={!friendCode}
          className="mt-3 w-full py-2.5 rounded-xl bg-accent text-white text-sm font-semibold active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
        >
          <Sparkles className="w-4 h-4" /> Einladen
        </button>
      </div>

      {/* Verbinden */}
      <div className="order-11 rounded-2xl border border-border bg-surface p-4">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide flex items-center gap-1.5">
          <UserPlus className="w-3.5 h-3.5" /> Mit jemandem verbinden
        </p>
        <div className="flex items-center gap-2 mt-2.5">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") connect(); }}
            placeholder="Code, z.B. MELI-4K2"
            inputMode="text"
            autoCapitalize="characters"
            className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-surface-elevated border border-border text-sm text-text-primary tracking-wider uppercase placeholder:normal-case placeholder:tracking-normal placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          <button
            onClick={connect}
            disabled={connecting || !code.trim()}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-40 flex items-center gap-1.5"
          >
            {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Verbinden
          </button>
        </div>
      </div>

      {/* Matches */}
      <div className="order-5">
        <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5 mb-2">
          <Heart className="w-4 h-4 text-accent fill-accent" /> Eure Matches
        </h3>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 text-text-muted animate-spin" /></div>
        ) : connections.length === 0 ? (
          <p className="text-sm text-text-muted bg-surface border border-border rounded-2xl p-4">
            Noch niemand verbunden. Teile deinen Freundescode oder gib unten einen ein.
          </p>
        ) : (
          <div className="space-y-4">
            {matches.map((g) => (
              <div key={g.partner.guestId} className="rounded-2xl border border-border bg-surface p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-text-primary">Mit {g.partner.name}</p>
                  <span className="text-[11px] text-text-muted tabular-nums">{g.recipes.length} Treffer</span>
                </div>
                {g.recipes.length === 0 ? (
                  <p className="text-xs text-text-muted">Noch keine gemeinsamen Favoriten — wischt beide weiter!</p>
                ) : (
                  <div className="space-y-1.5">
                    {g.recipes.map((m) => {
                      const r = bySlug.get(m.slug);
                      return (
                        <button
                          key={m.slug}
                          onClick={() => { if (r) onOpen(r); }}
                          className="w-full flex items-center gap-3 p-1.5 rounded-xl text-left active:bg-surface-elevated transition-colors"
                        >
                          <div className="w-11 h-11 shrink-0 rounded-lg overflow-hidden bg-surface-elevated">
                            {r ? <RecipeImage r={r} shape="square" sizes="48px" className="w-full h-full object-cover" /> : null}
                          </div>
                          <span className="flex-1 min-w-0 text-sm font-medium text-text-primary truncate">{m.recipeName || r?.name || m.slug}</span>
                          {m.bothSuper && (
                            <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-[#d99a2b]">
                              <Star className="w-3.5 h-3.5 fill-[#d99a2b]" /> beide
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Gruppen */}
      <div className="order-9">
        <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5 mb-2">
          <Users className="w-4 h-4 text-accent" /> Gruppen
          {groups.length > 0 && <span className="text-[11px] font-normal text-text-muted tabular-nums">({groups.length})</span>}
        </h3>

        {/* Erstellen / Beitreten */}
        <div className="rounded-2xl border border-border bg-surface p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createGroup(); }}
              placeholder="Neue Gruppe (Name)…"
              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-surface-elevated border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            <button onClick={createGroup} disabled={groupBusy || !groupName.trim()} className="shrink-0 px-3.5 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-40">
              Erstellen
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") joinGroup(); }}
              placeholder="Gruppencode, z.B. FAMI-3K2"
              autoCapitalize="characters"
              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-surface-elevated border border-border text-sm text-text-primary uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            <button onClick={joinGroup} disabled={groupBusy || !joinCode.trim()} className="shrink-0 px-3.5 py-2.5 rounded-xl bg-surface-elevated border border-border text-text-secondary text-sm font-semibold active:scale-95 transition-transform disabled:opacity-40">
              Beitreten
            </button>
          </div>
        </div>

        {/* Gruppenliste mit Ranking */}
        {groups.length > 0 && (
          <div className="mt-3 space-y-3">
            {groups.map((g) => (
              <div key={g.id} className="rounded-2xl border border-border bg-surface p-3.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-text-primary flex-1 min-w-0 truncate">{g.name}</p>
                  <button onClick={() => copyGroupCode(g.code)} className="shrink-0 text-[11px] font-mono font-semibold text-accent bg-accent/10 border border-accent/15 rounded-md px-1.5 py-0.5 active:scale-95 transition-transform">
                    {g.code}
                  </button>
                  <button onClick={() => leaveGroup(g.id, g.name, g.memberCount)} disabled={groupBusy} aria-label="Gruppe verlassen" className="shrink-0 -mr-2 w-11 h-11 flex items-center justify-center rounded-xl text-text-muted active:text-[#bd5138] active:bg-surface-elevated transition-colors">
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[11px] text-text-muted mt-1 mb-2 truncate">
                  {g.members.map((m) => m.name).join(", ")} · {g.memberCount} {g.memberCount === 1 ? "Mitglied" : "Mitglieder"}
                </p>
                <button
                  onClick={() => inviteToGroup(g.code, g.name)}
                  className="w-full mb-3 py-2 rounded-xl bg-accent/10 text-accent text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                >
                  <Share2 className="w-3.5 h-3.5" /> Einladungslink verschicken
                </button>

                {/* Für heute Abend planen */}
                <button
                  onClick={() => onPlanEvening(g.id, g.name)}
                  className="w-full mb-2.5 py-2.5 rounded-xl bg-accent text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                >
                  🍳 Für heute Abend planen
                </button>

                {/* Essensplan heute (getrennte Runde) */}
                {g.evening.plan.length > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1.5">🍳 Essensplan heute</p>
                    <div className="space-y-1.5">
                      {g.evening.plan.slice(0, 8).map((m) => {
                        const r = bySlug.get(m.slug);
                        return (
                          <button
                            key={m.slug}
                            onClick={() => { if (r) onOpen(r); }}
                            className="w-full flex items-center gap-3 p-1.5 rounded-xl text-left active:bg-surface-elevated transition-colors"
                          >
                            <div className="w-10 h-10 shrink-0 rounded-lg overflow-hidden bg-surface-elevated">
                              {r ? <RecipeImage r={r} shape="square" sizes="48px" className="w-full h-full object-cover" /> : null}
                            </div>
                            <span className="flex-1 min-w-0 text-sm font-medium text-text-primary truncate">{m.recipeName || r?.name || m.slug}</span>
                            <span className={`shrink-0 flex items-center gap-1 text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full ${m.unanimous ? "bg-[#3f6b43]/15 text-[#3f6b43]" : "bg-surface-elevated text-text-muted"}`}>
                              {m.count}/{m.memberCount}
                              {m.unanimous && <Check className="w-3 h-3" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Beliebt in der Gruppe (dauerhaft, aus allen Favoriten) */}
                <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1.5">Beliebt in der Gruppe</p>
                {g.matches.length === 0 ? (
                  <p className="text-xs text-text-muted">Noch keine Favoriten in der Gruppe — wischt los!</p>
                ) : (
                  <div className="space-y-1.5">
                    {g.matches.slice(0, 12).map((m) => {
                      const r = bySlug.get(m.slug);
                      return (
                        <button
                          key={m.slug}
                          onClick={() => { if (r) onOpen(r); }}
                          className="w-full flex items-center gap-3 p-1.5 rounded-xl text-left active:bg-surface-elevated transition-colors"
                        >
                          <div className="w-11 h-11 shrink-0 rounded-lg overflow-hidden bg-surface-elevated">
                            {r ? <RecipeImage r={r} shape="square" sizes="48px" className="w-full h-full object-cover" /> : null}
                          </div>
                          <span className="flex-1 min-w-0 text-sm font-medium text-text-primary truncate">{m.recipeName || r?.name || m.slug}</span>
                          <span className={`shrink-0 flex items-center gap-1 text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full ${m.unanimous ? "bg-[#3f6b43]/15 text-[#3f6b43]" : "bg-surface-elevated text-text-muted"}`}>
                            {m.count}/{m.memberCount}
                            {m.unanimous && <Check className="w-3 h-3" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Insgesamt oft gemocht (ersetzt „Meine Favoriten“): an wie vielen Tagen gemocht */}
      <div className="order-4">
        <h3 className="text-[15px] font-bold text-text-primary flex items-center gap-1.5 mb-2">
          <Star className="w-4 h-4 text-[#d99a2b] fill-[#d99a2b]" /> Insgesamt oft gemocht
          {favs.length > 0 && <span className="text-[13px] font-normal text-text-muted tabular-nums">({favs.length})</span>}
        </h3>
        {favs.length === 0 ? (
          <p className="text-[15px] text-text-secondary bg-surface border border-border rounded-2xl p-4">
            Noch nichts gemocht. Was du an mehreren Tagen nach rechts wischst, landet hier ganz oben.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {(favsExpanded ? favs : favs.slice(0, 10)).map(({ r, v, count }) => (
                <button
                  key={r.slug}
                  onClick={() => onOpen(r)}
                  className="relative rounded-xl overflow-hidden aspect-[4/3] bg-surface-elevated text-left active:scale-[0.98] transition-transform"
                >
                  <RecipeImage r={r} shape="wide" sizes="(min-width: 640px) 33vw, 50vw" className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 to-transparent" />
                  {v === "super" && (
                    <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-[#d99a2b] flex items-center justify-center"><Star className="w-3.5 h-3.5 fill-white text-white" /></span>
                  )}
                  <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-black/50 backdrop-blur-sm text-white text-[12px] font-semibold tabular-nums flex items-center gap-1">
                    <Heart className="w-3 h-3 fill-white" /> {count}×
                  </span>
                  <p className="absolute inset-x-0 bottom-0 p-2 text-white text-[13px] font-semibold leading-tight line-clamp-2 drop-shadow">{r.name}</p>
                </button>
              ))}
            </div>
            {favs.length > 10 && (
              <button
                onClick={() => setFavsExpanded((v) => !v)}
                className="mt-2.5 w-full py-2.5 rounded-xl bg-surface-elevated border border-border text-text-secondary text-xs font-semibold active:scale-[0.98] transition-transform"
              >
                {favsExpanded ? "Weniger anzeigen" : `Alle ${favs.length} anzeigen`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Schon gekocht (Sterne + Koch-Verlauf) */}
      <div className="order-6">
        <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5 mb-2">
          <CookingPot className="w-4 h-4 text-accent" /> Schon gekocht
          {cooked.length > 0 && <span className="text-[11px] font-normal text-text-muted tabular-nums">({cooked.length})</span>}
        </h3>
        {cooked.length === 0 ? (
          <p className="text-sm text-text-muted bg-surface border border-border rounded-2xl p-4">
            Noch nichts eingetragen. Öffne ein Gericht → Sterne vergeben oder „bereits gekocht“ festhalten (auch mit wem).
          </p>
        ) : (
          <div className="space-y-2">
            {cooked.map(({ r, stars, lastCookedOn, withNames }) => (
              <button
                key={r.slug}
                onClick={() => onOpen(r)}
                className="w-full flex items-center gap-3 bg-surface border border-border rounded-xl p-2 text-left active:scale-[0.99] transition-transform"
              >
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-surface-elevated shrink-0">
                  <RecipeImage r={r} shape="square" sizes="48px" className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary truncate">{r.name}</p>
                  {stars > 0 && (
                    <div className="flex items-center gap-0.5 mt-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={`w-3.5 h-3.5 ${n <= stars ? "text-[#d99a2b]" : "text-text-faint"}`} fill={n <= stars ? "#d99a2b" : "none"} />
                      ))}
                    </div>
                  )}
                  {lastCookedOn && (
                    <p className="text-[11px] text-text-muted mt-0.5 truncate">
                      Zuletzt {fmtDay(lastCookedOn)}{withNames.length > 0 ? ` · mit ${withNames.join(", ")}` : ""}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Was ich nicht mag (schlank) */}
      <div className="order-12">
        <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5 mb-1">
          <X className="w-4 h-4 text-[#bd5138]" /> Was ich nicht mag
        </h3>
        <p className="text-[11px] text-text-muted mb-2">Zutaten oder Unverträglichkeiten — solche Gerichte zeigen wir dir seltener.</p>
        <div className="bg-surface border border-border rounded-2xl p-3">
          {dislikes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {dislikes.map((d) => (
                <span key={d} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-[#bd5138]/10 text-[#bd5138] text-xs font-medium">
                  {d}
                  <button onClick={() => removeDislike(d)} aria-label={`${d} entfernen`} className="-my-1 w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition-transform">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={dislikeInput}
              onChange={(e) => setDislikeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addDislike(dislikeInput); } }}
              placeholder="z.B. Tomaten, Pilze …"
              className="flex-1 min-w-0 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none py-1"
            />
            {dislikeInput.trim() && (
              <button onClick={() => addDislike(dislikeInput)} className="shrink-0 text-xs font-semibold text-accent px-2 py-1 rounded-lg active:scale-95 transition-transform">
                Hinzufügen
              </button>
            )}
          </div>
        </div>
      </div>

      <MySubmissions guestId={guestId} tick={submitTick} onOpen={onOpen} />

      {/* Vorschlag */}
      <button
        onClick={onSuggest}
        className="order-7 w-full py-3 rounded-xl bg-accent/10 border border-accent/25 text-accent text-sm font-semibold active:scale-[0.98] transition-transform"
      >
        + Rezept einreichen
      </button>

      {/* Abmelden */}
      <button
        onClick={async () => {
          if (await ask({ title: "Abmelden?", text: "Mit Benutzername und Passwort kommst du jederzeit wieder rein, auch auf einem anderen Gerät.", confirmLabel: "Abmelden" })) onLogout();
        }}
        className="order-13 w-full min-h-11 py-2.5 rounded-xl text-text-muted text-sm font-medium flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
      >
        <LogOut className="w-4 h-4" /> Abmelden
      </button>
      {confirmDialog}
    </div>
  );
}

// ── Seite ─────────────────────────────────────────────────────

/** Schlanke Rezeptliste für die erste Ansicht (ohne Zubereitung/Tipps). */
const RECIPES_LITE_URL = "/api/recipes?lite=1";

export default function RezeptePage() {
  // Liste schon mit dem HTML anfordern (<link rel="preload">), parallel zum JavaScript.
  // Vorher startete die Anfrage erst nach dem Hydrieren — eine volle Runde später.
  preload(RECIPES_LITE_URL, { as: "fetch", crossOrigin: "anonymous" });
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"swipe" | "grid" | "account">("swipe");
  const [activeCat, setActiveCat] = useState("Alle");
  const [index, setIndex] = useState(0);
  const [detail, setDetail] = useState<Recipe | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [dislikes, setDislikes] = useState<string[]>([]);
  const [cookEvents, setCookEvents] = useState<CookEvent[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  // Je Swipe der Slug und das Urteil davor — Undo stellt das vorherige wieder her
  // (nach „Nochmal von vorn“ sind schon bewertete Karten im Stapel).
  // Neu (Heute gemerkt): auch Tag und Tageseintrag davor.
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [deckList, setDeckList] = useState<Recipe[]>([]);
  // Aus welcher Liste der Stapel zuletzt gebaut wurde. Weicht sie von `filtered` ab, ist
  // der Stapel noch nicht fertig (ein Render lang nach dem Laden) → Platzhalter statt
  // kurz „Alles durchgeswiped!“ und Layout-Sprung.
  const [deckSource, setDeckSource] = useState<Recipe[] | null>(null);
  const [deckMode, setDeckMode] = useState<"new" | "all">("new"); // new = heute noch nicht bewertet, all = „Nochmal alle ansehen“
  // „Heute gemerkt“: Tageseinträge (lokal + Server) und der aktuelle Tag (4:00 Berlin)
  const [dayStore, setDayStore] = useState<DayStore>(EMPTY_DAYS);
  const dayStoreRef = useRef<DayStore>(EMPTY_DAYS);
  const [dayInfo, setDayInfo] = useState<{ today: string; yesterdayVisible: boolean }>({ today: "", yesterdayVisible: false });
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [guestName, setGuestName] = useState<string | null>(null);
  const [guestId, setGuestId] = useState<string>("");
  // Zählt Einreichungen hoch, damit „Meine Einreichungen“ im Profil neu lädt
  const [submitTick, setSubmitTick] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [counts, setCounts] = useState<TrendCounts>({});
  const [search, setSearch] = useState("");
  const [searchDimmed, setSearchDimmed] = useState(false);
  const [match, setMatch] = useState<{ recipe: Recipe; partners: MatchPing[] } | null>(null);
  const [eveningGroup, setEveningGroup] = useState<{ id: string; name: string } | null>(null);
  const dimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fullRecipes, setFullRecipes] = useState<Record<string, Recipe>>({});
  const pendingGroupDone = useRef(false);
  const filteredRef = useRef<Recipe[]>([]);
  const savedDeckPos = useRef<{ index: number; history: HistoryItem[] } | null>(null); // Stapel-Position während Abend-Modus
  const touchedRef = useRef(new Set<string>()); // in dieser Sitzung bewertete Slugs (für den /api/me-Merge)
  const startedRef = useRef(false); // true, sobald in dieser Deck-Runde geswipt wurde
  const profileRef = useRef<Record<string, number>>({});
  const dislikesRef = useRef<string[]>([]);
  const countsRef = useRef<TrendCounts>({});
  const toast = useToast();

  // Deck-Reihenfolge: nach Geschmacksprofil (Lieblingszutaten zuerst), dann
  // Beliebtheit, dann Datum. Liest aktuelle Werte aus Refs → stabile Funktion.
  const orderDeck = useCallback((list: Recipe[]) => {
    const prof = profileRef.current, dis = dislikesRef.current, cnt = countsRef.current;
    return [...list].sort((a, b) =>
      recipeScore(b, prof, dis) - recipeScore(a, prof, dis) ||
      trendScore(cnt[b.slug]) - trendScore(cnt[a.slug]) ||
      b.created.localeCompare(a.created),
    );
  }, []);

  // localStorage gibt es erst im Browser → bewusst einmalig nach dem Mounten lesen.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setVerdicts(loadVerdicts());
    setRatings(loadRatings());
    setDislikes(loadDislikes());
    const ds = loadDayStore();
    dayStoreRef.current = ds;
    setDayStore(ds);
    const now = new Date();
    setDayInfo({ today: dayKey(now), yesterdayVisible: showYesterday(now) });
    try {
      const n = localStorage.getItem(NAME_KEY);
      const id = localStorage.getItem(ID_KEY);
      if (n) setGuestName(n);
      if (id) setGuestId(id);
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Nach Login / beim Öffnen: Server-Bewertungen holen, damit der Stand auf jedem
  // Gerät stimmt (der Account kann anderswo geswipt haben).
  useEffect(() => {
    if (!hydrated || !guestId) return;
    flushPending(guestId)
      .then(() => fetch("/api/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, name: guestName }),
      }))
      .then((r) => r.json())
      .then((d) => {
        if (d.ratings) { setRatings(d.ratings); replaceRatings(d.ratings); }
        if (Array.isArray(d.dislikes)) { setDislikes(d.dislikes); replaceDislikes(d.dislikes); }
        if (Array.isArray(d.cooked)) setCookEvents(d.cooked);
        if (Array.isArray(d.connections)) setFriends(d.connections);
        if (!d.verdicts) return;
        // Swipes, die während der Anfrage passiert sind, bleiben stehen (die Antwort
        // ist älter als sie), ebenso alles, was noch nicht beim Server ist.
        const merged: Record<string, Verdict> = { ...d.verdicts };
        const keep = new Set([...touchedRef.current, ...pendingSlugs()]);
        const local = loadVerdicts();
        for (const slug of keep) { if (local[slug]) merged[slug] = local[slug]; else delete merged[slug]; }
        setVerdicts(merged);
        replaceVerdicts(merged);
        // Tageseinträge: im Fenster gilt der Server, außer für eigene, noch nicht bestätigte Swipes.
        let ds = dayStoreRef.current;
        const sd = d.swipeDays as { from: string; to: string; days: Record<string, Record<string, DayEntry>>; likeCountsBefore: Record<string, number> } | undefined;
        if (sd?.from && sd.to) {
          const localDays = loadDayStore().days;
          const days: DayStore["days"] = {};
          for (const [day, map] of Object.entries(localDays)) if (day >= sd.from) days[day] = map; // älteres steckt in before
          for (let day = sd.from; day <= sd.to; day = shiftDay(day, 1)) {
            const m: Record<string, DayEntry> = { ...(sd.days?.[day] ?? {}) };
            for (const slug of keep) { const e = localDays[day]?.[slug]; if (e) m[slug] = e; else delete m[slug]; }
            days[day] = m;
          }
          ds = { from: sd.from, days, before: sd.likeCountsBefore ?? {} };
          dayStoreRef.current = ds;
          setDayStore(ds);
          saveDayStore(ds);
        }
        // Deck einmalig mit dem Server-Stand neu bauen — solange der User
        // in dieser Runde noch nicht selbst geswipt hat (sonst nicht anfassen).
        if (!startedRef.current) {
          const todayMap = ds.days[dayKey(new Date())] ?? {};
          setDeckList(orderDeck(filteredRef.current.filter((r) => !todayMap[r.slug])));
          setDeckMode("new");
          setIndex(0);
          setHistory([]);
        }
      })
      .catch(() => { /* offline egal */ });
    // dayInfo.today: beim Tageswechsel (App offen) den Stand neu holen
  }, [hydrated, guestId, guestName, orderDeck, dayInfo.today]);

  // Tageswechsel um 4:00 bei offener App: beim Zurückkommen und jede Minute prüfen.
  useEffect(() => {
    if (!hydrated) return;
    const check = () => {
      const now = new Date();
      const today = dayKey(now), yesterdayVisible = showYesterday(now);
      setDayInfo((prev) => (prev.today === today && prev.yesterdayVisible === yesterdayVisible ? prev : { today, yesterdayVisible }));
    };
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", check);
    const iv = setInterval(check, 60_000);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", check); clearInterval(iv); };
  }, [hydrated]);

  // Gruppen-Einladungslink `/?gruppe=CODE`: nach Login automatisch der Gruppe beitreten.
  useEffect(() => {
    if (pendingGroupDone.current || !hydrated || !guestId || !guestName) return;
    let code = "";
    try { code = new URLSearchParams(window.location.search).get("gruppe") || ""; } catch { /* ignore */ }
    if (!code) { pendingGroupDone.current = true; return; }
    pendingGroupDone.current = true;
    fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join", guestId, name: guestName, code }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          toast.success(d.already ? "Schon in der Gruppe" : "Gruppe beigetreten! 🎉", `Ihr plant jetzt gemeinsam in „${d.group?.name ?? "der Gruppe"}".`);
          setMode("account");
        } else if (d.error) {
          toast.error("Beitritt fehlgeschlagen", d.error);
        }
      })
      .catch(() => { /* offline egal */ })
      .finally(() => { try { window.history.replaceState(null, "", window.location.pathname); } catch { /* ignore */ } });
  }, [hydrated, guestId, guestName, toast]);

  // Abmelden: lokale Identität + Cache löschen → Auth-Gate erscheint wieder.
  const logout = useCallback(() => {
    try { localStorage.removeItem(NAME_KEY); localStorage.removeItem(ID_KEY); localStorage.removeItem(FAV_KEY); localStorage.removeItem(RATE_KEY); localStorage.removeItem(DISLIKE_KEY); localStorage.removeItem(DAYS_KEY); } catch { /* ignore */ }
    dayStoreRef.current = EMPTY_DAYS; setDayStore(EMPTY_DAYS);
    startedRef.current = false; touchedRef.current.clear(); savedDeckPos.current = null; setDeckList([]);
    setEveningGroup(null); setDetail(null); setMatch(null);
    setGuestName(null); setGuestId(""); setVerdicts({}); setRatings({}); setDislikes([]); setCookEvents([]); setFriends([]); setHistory([]); setIndex(0); setMode("swipe");
  }, []);

  // Tageseintrag setzen/entfernen (State, Ref und localStorage gleichzeitig)
  const putDayEntry = useCallback((day: string, slug: string, e: DayEntry | null) => {
    const next = withDayEntry(dayStoreRef.current, day, slug, e);
    dayStoreRef.current = next;
    setDayStore(next);
    saveDayStore(next);
  }, []);

  // Swipe: Tageseintrag für heute + Dauerstand. Ein „Nö“ gilt nur für heute und
  // überschreibt keinen früheren Favoriten (Matches, Gruppen, Trending bleiben).
  const handleVerdict = useCallback((r: Recipe, v: Verdict) => {
    startedRef.current = true;
    touchedRef.current.add(r.slug);
    const now = new Date();
    const day = dayKey(now), at = now.toISOString();
    const before = verdicts[r.slug] ?? null;
    const prevDay = dayStoreRef.current.days[day]?.[r.slug]?.v ?? null;
    const next: Verdict = v === "nope" && isLike(before) ? (before as Verdict) : v;
    saveVerdict(r.slug, next);
    setVerdicts((prev) => ({ ...prev, [r.slug]: next }));
    putDayEntry(day, r.slug, { v, at });
    setHistory((prev) => [...prev, { slug: r.slug, prev: before, day, prevDay }]);
    if (guestId && guestName) {
      postVerdict({ guestId, name: guestName, slug: r.slug, recipeName: r.name, category: r.category, verdict: v, day, swipedAt: at })
        .then((res) => {
          // Rechts/Hoch auf ein Gericht, das ein:e Freund:in schon mag → Match-Animation
          if ((v === "like" || v === "super") && res?.matches?.length) {
            setMatch({ recipe: r, partners: res.matches });
          }
        });
    }
  }, [guestId, guestName, verdicts, putDayEntry]);

  // Aus „Heute gemerkt“ entfernen (21.10.2026, Wackel-Modus im Profil): heute zählt es als Nö.
  // Das dauerhafte Like bleibt nur, wenn das Gericht schon an einem anderen Tag gemocht wurde.
  const removeTodayPick = useCallback((slug: string) => {
    const day = dayKey(new Date());
    const otherLikeDays = Object.entries(dayStoreRef.current.days)
      .filter(([d, m]) => d !== day && isLike(m[slug]?.v)).length + (dayStoreRef.current.before[slug] ?? 0);
    const keep: Verdict | null = otherLikeDays > 0 ? (verdicts[slug] ?? null) : null;
    touchedRef.current.add(slug);
    saveVerdict(slug, keep);
    setVerdicts((prev) => { const n = { ...prev }; if (keep) n[slug] = keep; else delete n[slug]; return n; });
    putDayEntry(day, slug, { v: "nope", at: new Date().toISOString() });
    if (guestId && guestName) postVerdict({ guestId, name: guestName, slug, verdict: keep, undo: true, day, dayVerdict: "nope" });
  }, [verdicts, guestId, guestName, putDayEntry]);

  // Seiteneffekte bewusst außerhalb des setHistory-Updaters (der läuft im StrictMode doppelt).
  const handleUndo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory(history.slice(0, -1));
    touchedRef.current.add(last.slug);
    saveVerdict(last.slug, last.prev);
    setVerdicts((v) => { const n = { ...v }; if (last.prev) n[last.slug] = last.prev; else delete n[last.slug]; return n; });
    if (last.day) putDayEntry(last.day, last.slug, last.prevDay ? { v: last.prevDay, at: new Date().toISOString() } : null);
    setIndex((i) => Math.max(0, i - 1));
    if (guestId && guestName) {
      postVerdict({ guestId, name: guestName, slug: last.slug, verdict: last.prev, undo: true, day: last.day, dayVerdict: last.prevDay ?? null });
    }
  }, [history, guestId, guestName, putDayEntry]);

  // „Heute gemerkt“ (Superlikes zuerst, dann neueste), „Gestern“ und die Tageszähler
  const todayMap = useMemo(() => dayStore.days[dayInfo.today] ?? {}, [dayStore, dayInfo.today]);
  const picksOf = useCallback((map: Record<string, DayEntry>): DayPick[] =>
    Object.entries(map)
      .filter(([, e]) => isLike(e.v))
      .map(([slug, e]) => ({ slug, v: e.v, at: e.at }))
      .sort((a, b) => Number(b.v === "super") - Number(a.v === "super") || b.at.localeCompare(a.at)), []);
  const todayPicks = useMemo(() => picksOf(todayMap), [picksOf, todayMap]);
  const yesterdayPicks = useMemo(
    () => (dayInfo.today ? picksOf(dayStore.days[shiftDay(dayInfo.today, -1)] ?? {}) : []),
    [picksOf, dayStore, dayInfo.today],
  );
  const likeCounts = useMemo(() => computeLikeCounts(dayStore), [dayStore]);


  // Sterne-Bewertung (nach dem Kochen). stars null = entfernen.
  const handleRating = useCallback((r: Recipe, stars: number | null) => {
    saveRatingLocal(r.slug, stars);
    setRatings((prev) => { const n = { ...prev }; if (stars) n[r.slug] = stars; else delete n[r.slug]; return n; });
    if (guestId && guestName) {
      fetch("/api/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, name: guestName, slug: r.slug, recipeName: r.name, category: r.category, stars }),
      }).catch(() => { /* offline egal */ });
    }
  }, [guestId, guestName]);

  // Koch-Verlauf: „bereits gekocht" eintragen / entfernen (Server ist die Quelle).
  const addCook = useCallback((r: Recipe, partnerGuest: string | null, cookedOn: string) => {
    if (!guestId || !guestName) return;
    fetch("/api/cooked", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestId, name: guestName, action: "add", slug: r.slug, recipeName: r.name, category: r.category, partnerGuest: partnerGuest || null, cookedOn }),
    }).then((res) => res.json()).then((d) => { if (Array.isArray(d.cooked)) setCookEvents(d.cooked); }).catch(() => {});
  }, [guestId, guestName]);

  const deleteCook = useCallback((id: number) => {
    if (!guestId || !guestName) return;
    fetch("/api/cooked", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestId, name: guestName, action: "remove", id }),
    }).then((res) => res.json()).then((d) => { if (Array.isArray(d.cooked)) setCookEvents(d.cooked); }).catch(() => {});
  }, [guestId, guestName]);

  // „Was ich nicht mag" speichern (lokal + Server).
  const saveDislikes = useCallback((list: string[]) => {
    const clean = Array.from(new Set(list.map((d) => d.trim().toLowerCase()).filter((d) => d.length >= 2))).slice(0, 30);
    setDislikes(clean);
    replaceDislikes(clean);
    if (guestId) {
      fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, name: guestName, dislikes: clean }),
      }).catch(() => { /* offline egal */ });
    }
  }, [guestId, guestName]);

  // Geschmacksprofil: Tag-Gewichte aus Likes/Superlikes/Sternen (Nö = leichter Malus).
  const profile = useMemo(() => {
    const p: Record<string, number> = {};
    const add = (tags: string[], w: number) => { for (const t of tags) p[t] = (p[t] ?? 0) + w; };
    for (const r of recipes) {
      const v = verdicts[r.slug];
      if (v === "like") add(r.tags, 1);
      else if (v === "super") add(r.tags, 2);
      else if (v === "nope") add(r.tags, -1);
      const st = ratings[r.slug] ?? 0;
      if (st >= 4) add(r.tags, st === 5 ? 2 : 1);
      else if (st > 0 && st <= 2) add(r.tags, -1);
    }
    return p;
  }, [recipes, verdicts, ratings]);

  // Refs für den Deck-Aufbau (Snapshot liest aktuelle Werte ohne Neu-Rendern).
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { dislikesRef.current = dislikes; }, [dislikes]);
  useEffect(() => { countsRef.current = counts; }, [counts]);

  useEffect(() => {
    // Schlanke Liste (ohne Zubereitung/Tipps, ~60 % kleiner) — das volle Rezept
    // holt das Detail-Sheet beim Öffnen nach.
    // Kein `cache: "no-store"`: sonst nutzt der Browser die vorgeladene Antwort nicht.
    // Aktuell bleibt es trotzdem (Server: no-cache + ETag → 304 beim erneuten Öffnen).
    fetch(RECIPES_LITE_URL)
      .then((r) => r.json())
      .then((d) => {
        const list: Recipe[] = (d.recipes ?? []).map((r: Recipe) => ({ ...r, steps: r.steps ?? [], tips: r.tips ?? [] }));
        setRecipes(list);
        setCategories(d.categories ?? []);
        setDiag(d.diagnostics ?? null);
        if (d.error) setError(d.error);
        // Geteilter Link `/?rezept=slug` → Detail direkt öffnen
        try {
          const slug = new URLSearchParams(window.location.search).get("rezept");
          if (slug) {
            const r = list.find((x) => x.slug.toLowerCase() === slug.toLowerCase());
            if (r) setDetail(r);
            window.history.replaceState(null, "", window.location.pathname);
          }
        } catch { /* ignore */ }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Netzwerkfehler"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (activeCat === "Alle") return recipes;
    return recipes.filter((r) => catGroup(r.category) === activeCat);
  }, [recipes, activeCat]);

  // filtered immer aktuell im Ref halten (für den Deck-Aufbau nach
  // asynchroner Hydration, ohne Re-Render-Schleife)
  useEffect(() => { filteredRef.current = filtered; }, [filtered]);

  // ── Swipe-Stapel (Snapshot) ────────────────────────────────────────
  // „Heute gemerkt“ (seit 17.10.2026): der Stapel zeigt ALLE Rezepte außer denen, die
  // heute schon bewertet wurden (rechts, links oder hoch). „Nö“ gilt nur für heute —
  // ab 4:00 Uhr am nächsten Tag ist alles wieder drin (dayInfo.today wechselt).
  // Snapshot = stabile Reihenfolge beim Wischen.
  useEffect(() => {
    if (!dayInfo.today) return;
    const todayMap = dayStoreRef.current.days[dayInfo.today] ?? {};
    setDeckList(orderDeck(filtered.filter((r) => !todayMap[r.slug])));
    setDeckSource(filtered);
    setDeckMode("new");
    setIndex(0);
    setHistory([]);
    startedRef.current = false;
  }, [filtered, orderDeck, dayInfo.today]);

  // „Nochmal alle ansehen“: alles, auch heute schon bewertete (Karte trägt dann „Heute gemerkt“).
  // Rechts ändert nichts, links nimmt das Gericht aus „Heute gemerkt“ heraus.
  const resetDeck = useCallback(() => {
    setDeckList(orderDeck(filtered));
    setDeckMode("all");
    setIndex(0);
    setHistory([]);
    startedRef.current = false;
  }, [filtered, orderDeck]);

  // Trending-Zähler: einmal beim Start (für Raster-Badges + Abend-Reihenfolge) …
  useEffect(() => {
    fetch("/api/recipes/trending", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCounts(d.counts ?? {}))
      .catch(() => { /* egal */ });
  }, []);
  // … und frisch, wenn das Raster geöffnet wird.
  useEffect(() => {
    if (mode !== "grid") return;
    fetch("/api/recipes/trending", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCounts(d.counts ?? {}))
      .catch(() => { /* egal — dann eben ohne Badges */ });
  }, [mode]);

  // Volles Rezept (Zubereitung + Tipps) fürs Detail nachladen, einmal pro Gericht.
  const detailSlug = detail?.slug ?? null;
  useEffect(() => {
    if (!detailSlug || fullRecipes[detailSlug]) return;
    let cancelled = false;
    fetch(`/api/recipes?slug=${encodeURIComponent(detailSlug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.recipe) setFullRecipes((prev) => ({ ...prev, [detailSlug]: d.recipe })); })
      .catch(() => { /* offline: Detail zeigt dann eben nur Zutaten */ });
    return () => { cancelled = true; };
  }, [detailSlug, fullRecipes]);
  const detailRecipe = detail ? (fullRecipes[detail.slug] ?? detail) : null;

  // Raster-Liste: Kategorie-Filter + Suche + Sortierung nach Beliebtheit.
  // Gerichte mit „nicht gemocht"-Zutaten sinken ans Ende.
  const gridRecipes = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = filtered;
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      const da = dislikeHits(a, dislikes).length ? 1 : 0;
      const db = dislikeHits(b, dislikes).length ? 1 : 0;
      if (da !== db) return da - db;
      return trendScore(counts[b.slug]) - trendScore(counts[a.slug]) || b.created.localeCompare(a.created);
    });
  }, [filtered, search, counts, dislikes]);

  // „Für dich": beste noch nicht geswipte Gerichte nach Geschmacksprofil.
  // Kaltstart (kein Profil) → leer, damit keine sinnlose Reihe erscheint.
  const forYou = useMemo(() => {
    if (Object.keys(profile).length === 0) return [];
    return recipes
      .filter((r) => !verdicts[r.slug])
      .map((r) => ({ r, s: recipeScore(r, profile, dislikes) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || trendScore(counts[b.r.slug]) - trendScore(counts[a.r.slug]))
      .slice(0, 12)
      .map((x) => x.r);
  }, [recipes, verdicts, profile, dislikes, counts]);

  // Suchfeld beim Scrollen dezent ausblenden, kurz nach Stillstand wieder einblenden.
  const onGridScroll = useCallback(() => {
    setSearchDimmed(true);
    if (dimTimer.current) clearTimeout(dimTimer.current);
    dimTimer.current = setTimeout(() => setSearchDimmed(false), 550);
  }, []);

  // ── "Essensplan für heute Abend" ────────────────────────────────
  // Frischer Stapel nach Beliebtheit (mehr Likes zuerst), getrennt von den Favoriten.
  const eveningRecipes = useMemo(
    () => [...recipes].sort((a, b) => trendScore(counts[b.slug]) - trendScore(counts[a.slug]) || b.created.localeCompare(a.created)),
    [recipes, counts],
  );

  const postEvening = useCallback((body: Record<string, unknown>) => {
    return fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestId, name: guestName, ...body }),
    }).catch(() => { /* offline egal */ });
  }, [guestId, guestName]);

  const handleEveningVerdict = useCallback((r: Recipe, v: Verdict) => {
    if (!eveningGroup) return;
    setHistory((prev) => [...prev, { slug: r.slug, prev: null }]);
    postEvening({ action: "evening-pick", groupId: eveningGroup.id, slug: r.slug, recipeName: r.name, category: r.category, verdict: v });
  }, [eveningGroup, postEvening]);

  const handleEveningUndo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory(history.slice(0, -1));
    setIndex((i) => Math.max(0, i - 1));
    if (eveningGroup) postEvening({ action: "evening-pick", groupId: eveningGroup.id, slug: last.slug, verdict: null });
  }, [history, eveningGroup, postEvening]);

  // Abend-Modus teilt sich index/history mit dem Entdecken-Stapel. Beim Betreten
  // die Position merken und beim Verlassen zurückholen — sonst begann der normale
  // Stapel wieder bei Karte 1 mit schon bewerteten Gerichten.
  const startEvening = useCallback((id: string, name: string) => {
    if (!eveningGroup) savedDeckPos.current = { index, history };
    setEveningGroup({ id, name }); setIndex(0); setHistory([]); setMode("swipe");
  }, [eveningGroup, index, history]);
  const exitEvening = useCallback(() => {
    const saved = savedDeckPos.current;
    savedDeckPos.current = null;
    setEveningGroup(null); setIndex(saved?.index ?? 0); setHistory(saved?.history ?? []);
  }, []);
  const resetEveningRound = useCallback(() => {
    if (!eveningGroup) return;
    postEvening({ action: "evening-reset", groupId: eveningGroup.id })
      ?.then(() => { setIndex(0); setHistory([]); toast.success("Neuer Abend", "Deine Runde ist zurückgesetzt."); });
  }, [eveningGroup, postEvening, toast]);

  // Vorausladen der nächsten Karten-Bilder passiert jetzt im SwipeDeck selbst (unsichtbare
  // <picture> mit denselben srcset/sizes wie die Karte, sonst lud der Browser zweimal).

  const showDeck = !loading && mode === "swipe" && (eveningGroup
    ? (eveningRecipes.length > 0 && index < eveningRecipes.length)
    : (deckList.length > 0 && index < deckList.length));

  // iOS-26-Fehler der Home-Bildschirm-App: beim Start ist der Viewport zu kurz, erst ein Scroll
  // korrigiert ihn (Christian: „sobald ich hochziehe“). Die Seite scrollt hier nie selbst, also
  // einmal künstlich 1 px scrollen und zurück.
  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    if (!nav.standalone) return;
    const html = document.documentElement;
    const prev = html.style.height;
    html.style.height = "calc(100% + 1px)";
    window.scrollTo(0, 1);
    const t = setTimeout(() => { window.scrollTo(0, 0); html.style.height = prev; }, 60);
    return () => clearTimeout(t);
  }, []);

  // Raster und Profil teilen sich den Scroll-Container → beim Bereichswechsel oben anfangen
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [mode]);


  // Vor allem anderen: Name abfragen (nach dem Lesen aus localStorage, um Flackern zu vermeiden)
  // Vor dem Hydrieren (Server-HTML) schon das Grundgerüst zeigen statt einer leeren Seite:
  // Titel + Platzhalter-Karte erscheinen mit dem HTML, nicht erst nach dem JavaScript.
  if (!hydrated) return (
    <div className="app-h relative mx-auto w-full max-w-3xl flex flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+14px+64px+14px)]">
      <div className="shrink-0 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <div className="flex items-end justify-between gap-3 pt-1 pb-1">
          <h1 className="text-[26px] font-extrabold tracking-tight leading-[1.1] text-text-primary">Entdecken</h1>
        </div>
        <div className="h-[34px] mt-3" />
      </div>
      <div className="flex-1 min-h-0 flex flex-col mt-4"><DeckSkeleton /></div>
    </div>
  );
  if (!guestName) return (
    <AuthGate onDone={(n, id, v) => {
      setGuestName(n); setGuestId(id);
      if (v) { setVerdicts(v); replaceVerdicts(v); }
    }} />
  );

  // Raster und Profil scrollen über die volle Höhe: oben läuft der Inhalt hinter die
  // Navigation und blendet aus, unten blendet er vor der Kante aus (statt harter Schnitt).
  // Der Stapel (Entdecken) bleibt im festen Layout.
  // Beim Laden im Entdecken-Tab schon das Stapel-Layout (Platzhalter-Karte), sonst sprang
  // der Inhalt beim Umschalten vom Scroll- ins Stapel-Layout (CLS 0,13).
  const deckPending = !loading && mode === "swipe" && !eveningGroup && deckSource !== filtered;
  const deckLayout = showDeck || (mode === "swipe" && (loading || deckPending));
  const scrollMode = !deckLayout;

  // Kopf: großer Titel (+ „Heute N ♥“ im Stapel) und Kategorien. Im Stapel fest oben,
  // in Raster/Profil scrollt er mit dem Inhalt weg (vorher schwebte er mit einem hohen
  // Verlauf über dem Inhalt, der in Titel und Chips hineinragte). Oben bleibt nur ein
  // schmaler Ausblender, der schon in der Statusleiste ausläuft (bis 4 px darunter).
  const header = (
    <div className={scrollMode ? "pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3" : "shrink-0 pt-[calc(env(safe-area-inset-top)+0.75rem)]"}>
      {/* Großer Titel wie in Outfits; die Bereiche wechselt die Glas-Leiste unten */}
      <div className="flex items-end justify-between gap-3 pt-1 pb-1">
        <h1 className="text-[26px] font-extrabold tracking-tight leading-[1.1] text-text-primary">
          {mode === "swipe" ? (eveningGroup ? "Heute Abend" : "Entdecken") : mode === "grid" ? "Alle Gerichte" : "Profil"}
        </h1>
        {mode === "swipe" && !eveningGroup && (
          <button
            onClick={() => setMode("account")}
            aria-label={`Heute ${todayPicks.length} gemerkt, ansehen`}
            className="shrink-0 -my-1.5 min-h-11 px-3.5 rounded-full bg-surface border border-border text-[15px] font-semibold text-text-primary flex items-center gap-1.5 tabular-nums active:scale-95 transition-transform"
          >
            Heute <NumberFlow value={todayPicks.length} /> <Heart className="w-4 h-4 text-[#3f6b43] fill-[#3f6b43]" />
          </button>
        )}
      </div>

      {/* Kategorie-Filter — dezent, eine Reihe (nicht im Account, nicht im Abend-Modus) */}
      {mode !== "account" && !eveningGroup && (categories.length > 0 || loading) && (
        <div className="grid grid-cols-4 gap-1 shrink-0 mt-3 p-1 rounded-full bg-surface/70 border border-border">
          {/* Kein „Alle“ mehr (21.10.2026): aktive Gruppe nochmal antippen = Filter aus */}
          {CAT_GROUPS.map((cat) => {
            const active = activeCat === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCat(active ? "Alle" : cat)}
                aria-pressed={active}
                className={`relative min-h-9 px-1 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors active:scale-95 ${
                  active ? "text-white" : "text-text-secondary"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="cat-pill"
                    className="absolute inset-0 rounded-full bg-accent/85"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative z-10">{cat}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  // Höhe: .app-h (globals.css) = 100dvh, in der Home-Bildschirm-App die feste Bildschirmhöhe.
  // Leiste, Suche und Ausblender sind `absolute` in diesem Rahmen statt `fixed` — so hängen
  // sie nicht an der Viewport-Höhe, die iOS 26 beim Start der App zu kurz meldet.
  return (
    <div className={`app-h relative mx-auto w-full max-w-3xl flex flex-col px-4 ${scrollMode ? "" : "pb-[calc(env(safe-area-inset-bottom)+14px+64px+14px)]"}`}>
      {!scrollMode && header}

      {/* Oben kein Verlauf mehr (21.10.2026, Christian: Blur oben stört): nur eine glatte Fläche
          genau so hoch wie die Statusleiste, damit Inhalt nicht unter der Uhr durchläuft. */}
      {scrollMode && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-bg" />
      )}

      {/* Inhalt */}
      <div
        ref={contentRef}
        onScroll={mode === "grid" ? onGridScroll : undefined}
        className={deckLayout ? "flex-1 min-h-0 flex flex-col mt-4" : "flex-1 min-h-0 overflow-y-auto overflow-x-hidden -mx-4 px-4 pb-[calc(env(safe-area-inset-bottom)+14px+64px+2rem)]"}
      >
        {scrollMode && header}
        {loading || deckPending ? (
          mode === "swipe" ? <DeckSkeleton /> : (
            <div className="flex justify-center py-20">
              <Loader2 className="w-5 h-5 text-text-muted animate-spin" />
            </div>
          )
        ) : recipes.length === 0 ? (
          <div className="bg-surface border border-amber-500/30 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="text-sm font-semibold">Keine Rezepte gefunden</p>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            {diag && (
              <div className="text-[11px] text-text-muted font-mono space-y-0.5">
                <p>Rezepte: {diag.recipesDir} {diag.recipesDirExists ? "✓" : "✗ nicht erreichbar"}</p>
                <p>Bilder: {diag.imagesDir} {diag.imagesDirExists ? "✓" : "✗ nicht erreichbar"}</p>
              </div>
            )}
            <p className="text-xs text-text-secondary">
              Prüfe, ob der Rezept-Ordner gemountet ist (Env <code className="bg-surface-elevated px-1 rounded">OBSIDIAN_RECIPES_PATH</code>).
            </p>
          </div>
        ) : mode === "account" ? (
          <AccountView
            guestId={guestId}
            guestName={guestName ?? ""}
            recipes={recipes}
            verdicts={verdicts}
            ratings={ratings}
            dislikes={dislikes}
            cookEvents={cookEvents}
            onOpen={setDetail}
            onSuggest={() => setSuggestOpen(true)}
            onLogout={logout}
            onPlanEvening={startEvening}
            onSaveDislikes={saveDislikes}
            onConnections={setFriends}
            todayPicks={todayPicks}
            yesterdayPicks={yesterdayPicks}
            yesterdayVisible={dayInfo.yesterdayVisible}
            likeCounts={likeCounts}
            submitTick={submitTick}
            onRemoveToday={removeTodayPick}
            onGoSwipe={() => setMode("swipe")}
          />
        ) : mode === "swipe" ? (
          eveningGroup ? (
            <>
              {/* Abend-Banner */}
              <div className="shrink-0 flex items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-accent/10 border border-accent/20">
                <ChefHat className="w-4 h-4 text-accent shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-accent truncate">Heute Abend · {eveningGroup.name}</p>
                  <p className="text-[10px] text-text-muted">Swipe, worauf du heute Lust hast — zählt nur für heute</p>
                </div>
                <button onClick={resetEveningRound} className="shrink-0 text-[11px] font-semibold text-text-muted px-2 py-1 rounded-lg active:scale-95 transition-transform">Neuer Abend</button>
                <button onClick={exitEvening} className="shrink-0 text-[11px] font-semibold text-accent px-2 py-1 rounded-lg active:scale-95 transition-transform">Fertig</button>
              </div>
              {eveningRecipes.length > 0 && index < eveningRecipes.length ? (
                <div className="flex-1 min-h-0">
                  <SwipeDeck
                    recipes={eveningRecipes}
                    index={index}
                    setIndex={setIndex}
                    onOpen={setDetail}
                    onVerdict={handleEveningVerdict}
                    onUndo={handleEveningUndo}
                    canUndo={history.length > 0}
                  />
                </div>
              ) : (
                <div className="bg-surface border border-border rounded-2xl p-8 text-center space-y-4 mt-2">
                  <div className="text-5xl">🍳</div>
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">Runde fertig!</h2>
                    <p className="text-sm text-text-muted mt-1">Schaut in der Gruppe, worauf ihr euch einigt.</p>
                  </div>
                  <div className="flex flex-col gap-2 max-w-xs mx-auto">
                    <button onClick={() => setMode("account")} className="w-full py-3 rounded-xl bg-accent text-white text-sm font-semibold active:scale-[0.98] transition-transform">Essensplan ansehen</button>
                    <button onClick={resetEveningRound} className="w-full py-2.5 rounded-xl bg-surface-elevated border border-border text-text-secondary text-sm font-medium active:scale-[0.98] transition-transform">Nochmal swipen</button>
                    <button onClick={exitEvening} className="w-full py-2.5 rounded-xl text-text-muted text-sm font-medium">Beenden</button>
                  </div>
                </div>
              )}
            </>
          ) : deckList.length > 0 && index < deckList.length ? (
            <SwipeDeck
              recipes={deckList}
              index={index}
              setIndex={setIndex}
              onOpen={setDetail}
              onVerdict={handleVerdict}
              onUndo={handleUndo}
              canUndo={history.length > 0}
              likeCounts={likeCounts}
              todayMap={deckMode === "all" ? todayMap : undefined}
            />
          ) : filtered.length > 0 ? (
            // Für heute alles bewertet (oder „Nochmal alle ansehen“ durch)
            <DayDone
              todayCount={todayPicks.length}
              again={deckMode === "all"}
              onShowToday={() => setMode("account")}
              onAgain={resetDeck}
            />
          ) : (
            <p className="text-center text-sm text-text-muted py-12">
              Keine Rezepte in dieser Kategorie
            </p>
          )
        ) : gridRecipes.length > 0 ? (
          <>
            {/* „Für dich" — personalisierte Empfehlungen (nur ohne Suche/Filter) */}
            {forYou.length > 0 && !search.trim() && activeCat === "Alle" && (
              <div className="mb-5">
                <div className="flex items-baseline gap-1.5 mb-2">
                  <Sparkles className="w-4 h-4 text-accent self-center" />
                  <h2 className="text-sm font-bold text-text-primary">Für dich</h2>
                  <span className="text-[11px] text-text-muted">nach deinem Geschmack</span>
                </div>
                <div className="flex gap-3 overflow-x-auto scrollbar-none -mx-4 px-4 pb-1">
                  {forYou.map((r) => (
                    <button key={r.slug} onClick={() => setDetail(r)} className="shrink-0 w-36 text-left active:scale-[0.98] transition-transform">
                      <div className="relative w-36 h-24 rounded-xl overflow-hidden bg-surface-elevated border border-border">
                        <RecipeImage r={r} shape="wide" sizes="144px" className="w-full h-full object-cover" />
                      </div>
                      <p className="text-xs font-semibold text-text-primary mt-1.5 leading-snug line-clamp-2">{r.name}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <RecipeGrid recipes={gridRecipes} onOpen={setDetail} verdicts={verdicts} counts={counts} />
            <div className="h-24 shrink-0" />
          </>
        ) : (
          <p className="text-center text-sm text-text-muted py-12">
            {search.trim() ? `Nichts gefunden für „${search.trim()}"` : "Keine Rezepte in dieser Kategorie"}
          </p>
        )}
      </div>

      {/* Glas-Leiste unten wie in Outfits (Liquid Glass, elastische Markierung) */}
      <nav aria-label="Bereiche" className="absolute z-50 left-4 right-4 mx-auto max-w-md bottom-[calc(env(safe-area-inset-bottom)+14px)] h-16 rounded-full select-none">
        <div aria-hidden className="glas-flaeche absolute inset-0 rounded-full" />
        <div role="radiogroup" className="relative flex h-full p-1.5">
          {([
            ["swipe", Sparkles, "Entdecken"],
            ["grid", BookOpen, "Gerichte"],
            ["account", User, "Profil"],
          ] as const).map(([m, Icon, label]) => {
            const active = mode === m;
            return (
              <motion.button
                key={m}
                role="radio"
                aria-checked={active}
                aria-label={label}
                whileTap={{ scale: 0.9 }}
                transition={{ type: "spring", stiffness: 600, damping: 30 }}
                onClick={() => setMode(m)}
                className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 rounded-full transition-colors duration-200 ${active ? "text-accent" : "text-text-muted"}`}
              >
                {active && (
                  <motion.span
                    layoutId="tab-linse"
                    className="glas-linse absolute inset-0 rounded-full"
                    transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.8 }}
                  />
                )}
                <Icon className="relative w-[22px] h-[22px]" />
                <span className={`relative text-[10.5px] leading-none ${active ? "font-semibold" : "font-medium"}`}>{label}</span>
              </motion.button>
            );
          })}
        </div>
      </nav>

      {/* Weicher Ausblender an der Unterkante (Raster, Profil) */}
      {scrollMode && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[calc(env(safe-area-inset-bottom)+7rem)]"
          style={{ background: "linear-gradient(to top, var(--bg) 0%, var(--bg) 25%, color-mix(in srgb, var(--bg) 0%, transparent) 100%)" }}
        />
      )}

      {/* Schwebende Suche — nur im Raster, fadet beim Scrollen */}
      {mode === "grid" && recipes.length > 0 && (
        <div className={`absolute left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom)+14px+64px+10px)] z-40 w-[min(92%,28rem)] transition-opacity duration-300 ${searchDimmed ? "opacity-40" : "opacity-100"}`}>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-surface/90 backdrop-blur-md border border-border shadow-lg">
            <Search className="w-4 h-4 text-text-muted shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rezept suchen…"
              className="flex-1 min-w-0 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch("")} aria-label="Suche leeren" className="shrink-0 text-text-muted active:scale-90 transition-transform">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Detail-Sheet */}
      <AnimatePresence>
        {detail && detailRecipe && (
          <RecipeDetail
            key={detail.slug}
            r={detailRecipe}
            onClose={() => setDetail(null)}
            rating={ratings[detail.slug] ?? 0}
            onRate={(n) => handleRating(detail, n)}
            dislikeHitList={dislikeHits(detail, dislikes)}
            friends={friends}
            cookEntries={cookEvents.filter((e) => e.slug === detail.slug)}
            onAddCook={(partnerGuest, cookedOn) => addCook(detail, partnerGuest, cookedOn)}
            onDeleteCook={deleteCook}
          />
        )}
      </AnimatePresence>

      {/* Vorschlag einreichen */}
      <AnimatePresence>
        {suggestOpen && <SuggestSheet onClose={() => setSuggestOpen(false)} defaultName={guestName ?? ""} guestId={guestId} onSubmitted={() => setSubmitTick((t) => t + 1)} />}
      </AnimatePresence>

      {/* Match-Animation */}
      <AnimatePresence>
        {match && <MatchCelebration match={match} onClose={() => setMatch(null)} />}
      </AnimatePresence>
    </div>
  );
}
