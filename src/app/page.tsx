"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion, useMotionValue, useTransform, animate } from "framer-motion";
import {
  Loader2, ChevronRight, Clock, Users, Flame,
  X, ExternalLink, AlertCircle, Check,
  Heart, Star, RotateCcw, User, Search, Copy, UserPlus, Sparkles, LogOut,
  CookingPot, UtensilsCrossed, ChefHat, Soup, Share2, ImagePlus, Mic, Square, Pencil, BookOpen,
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
import { ShareButton } from "@/components/ShareButton";

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
  image: string | null;
  imageExists: boolean;
  images: string[];
  created: string;
  source: string | null;
  totalTime: string | null;
  portions: string | null;
  difficulty: string | null;
  ingredients: IngredientGroup[];
  steps: string[];
  tips: string[];
  tags: string[];
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

// Verdict ans Backend schicken. Gibt die Antwort zurück (u.a. frische Matches);
// bleibt aber unkritisch — die UI hängt nicht davon ab.
async function postVerdict(body: {
  guestId: string; name: string; slug: string;
  recipeName?: string; category?: string; verdict: Verdict | null;
}): Promise<{ ok?: boolean; matches?: MatchPing[] } | null> {
  try {
    const res = await fetch("/api/verdict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    return await res.json();
  } catch {
    return null; // offline egal — localStorage bleibt Quelle der Wahrheit für die UI
  }
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
const CATEGORY_ORDER = ["Frühstück", "Hauptgericht", "Dessert"];
function orderCategories(cats: string[]): string[] {
  return [...cats].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a); const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
}

function imageUrl(image: string | null, w: 400 | 800 | 1200): string | null {
  if (!image) return null;
  return `/api/recipes/image/${encodeURIComponent(image)}?w=${w}`;
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

function RecipeImage({ r, w, className }: { r: Recipe; w: 400 | 800 | 1200; className?: string }) {
  const [failed, setFailed] = useState(false);
  const url = r.imageExists ? imageUrl(r.image, w) : null;

  if (!url || failed) {
    return (
      <div className={`flex items-center justify-center bg-surface-elevated ${className}`}>
        <span className="text-5xl opacity-40">{CATEGORY_EMOJI[r.category] ?? "🍽️"}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={r.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

// ── Karten-Inhalt (wird pro Stapel-Karte gerendert) ───────────

// Grüne Info-Pill im Swipe-for-Dinner-Stil
function InfoPill({ icon: Icon, children }: { icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#3f6b43]/10 text-[#3f6b43] dark:bg-[#8bbf90]/15 dark:text-[#9ecaa1] border border-[#3f6b43]/15">
      {Icon && <Icon className="w-3 h-3" />}
      {children}
    </span>
  );
}

function RecipeCardFace({
  r, index, total, onOpen,
}: {
  r: Recipe; index: number; total: number; onOpen: () => void; animateMacros?: boolean;
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
        <RecipeImage r={r} w={800} className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
        <span className="absolute bottom-2 right-2 px-2 py-1 rounded-full bg-black/45 backdrop-blur-sm text-white text-[10px] font-semibold flex items-center gap-0.5 pointer-events-none">
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
  recipes, index, setIndex, onOpen, onVerdict, onUndo, canUndo,
}: {
  recipes: Recipe[];
  index: number;
  setIndex: (i: number) => void;
  onOpen: (r: Recipe) => void;
  onVerdict: (r: Recipe, v: Verdict) => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const prefersReduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-14, 14]);
  const likeOp = useTransform(x, [30, 120], [0, 1]);
  const nopeOp = useTransform(x, [-120, -30], [1, 0]);
  const superOp = useTransform(y, [-120, -30], [1, 0]);

  const current = recipes[index];

  const commit = useCallback((v: Verdict) => {
    if (!current) return;
    const tx = v === "like" ? 560 : v === "nope" ? -560 : 0;
    const ty = v === "super" ? -720 : 60;
    const finish = () => {
      onVerdict(current, v);
      x.set(0); y.set(0);
      setIndex(index + 1);
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
      if (e.key === "ArrowLeft") commit("nope");
      if (e.key === "ArrowRight") commit("like");
      if (e.key === "ArrowUp") commit("super");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit]);

  if (!current) return null;

  const back = [1, 2].map((offset) => recipes[index + offset]).filter(Boolean) as Recipe[];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="relative flex-1 min-h-0" style={{ touchAction: "pan-y" }}>
        {/* Hintere Karten */}
        {back.reverse().map((recipe, i) => {
          const offset = back.length - i; // 2 dann 1
          return (
            <motion.div
              key={recipe.slug}
              className="absolute inset-0"
              initial={false}
              animate={{ scale: 1 - offset * 0.05, y: offset * 12, opacity: 1 - offset * 0.12 }}
              transition={prefersReduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
              style={{ zIndex: 10 - offset, transformOrigin: "top center" }}
            >
              {/* schlichte Tiefe-Karte im gleichen weißen Look */}
              <div className="bg-surface rounded-[26px] shadow-[0_10px_30px_rgba(70,50,30,0.10)] border border-border p-3 h-full flex flex-col">
                <div className="h-4 shrink-0" />
                <div className="relative w-full flex-1 min-h-0 rounded-2xl overflow-hidden bg-surface-elevated">
                  <RecipeImage r={recipe} w={400} className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/5" />
                </div>
                <div className="h-24 shrink-0" />
              </div>
            </motion.div>
          );
        })}

        {/* Vorderste Karte — beide Achsen draggable */}
        <motion.div
          key={current.slug}
          className="relative w-full h-full select-none"
          style={{ x, y, rotate, zIndex: 20, transformOrigin: "top center" }}
          drag={prefersReduced ? false : true}
          dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
          dragElastic={0.55}
          whileDrag={{ cursor: "grabbing" }}
          onDragEnd={(_, info) => {
            const up = info.offset.y < -110 && Math.abs(info.offset.y) > Math.abs(info.offset.x);
            if (up || info.velocity.y < -700) { commit("super"); return; }
            if (info.offset.x > 100 || info.velocity.x > 500) { commit("like"); return; }
            if (info.offset.x < -100 || info.velocity.x < -500) { commit("nope"); return; }
            springBack();
          }}
        >
          {/* Verdict-Stamps — mittig, damit sie beim Wischen nicht aus dem Bild wandern */}
          <motion.div style={{ opacity: likeOp }} className="absolute top-24 left-1/2 -translate-x-1/2 z-30 rotate-[8deg] px-4 py-1.5 rounded-2xl border-[4px] border-[#57a75f] text-[#57a75f] text-[2.1rem] font-black uppercase tracking-wide pointer-events-none bg-white/25 backdrop-blur-[2px]">
            Lecker
          </motion.div>
          <motion.div style={{ opacity: nopeOp }} className="absolute top-24 left-1/2 -translate-x-1/2 z-30 -rotate-[8deg] px-4 py-1.5 rounded-2xl border-[4px] border-[#bd5138] text-[#bd5138] text-[2.1rem] font-black uppercase tracking-wide pointer-events-none bg-white/25 backdrop-blur-[2px]">
            Nö
          </motion.div>
          <motion.div style={{ opacity: superOp }} className="absolute left-1/2 -translate-x-1/2 top-1/3 z-30 -rotate-[6deg] px-3 py-1.5 rounded-xl border-[3px] border-[#d99a2b] text-[#d99a2b] text-xl font-black uppercase tracking-wide pointer-events-none flex items-center gap-1.5">
            <Star className="w-5 h-5 fill-[#d99a2b]" /> Superlike
          </motion.div>

          <RecipeCardFace
            r={current}
            index={index}
            total={recipes.length}
            onOpen={() => onOpen(current)}
            animateMacros={!prefersReduced}
          />
        </motion.div>
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
          onClick={onUndo}
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

// ── Ende des Stapels ──────────────────────────────────────────

function DeckDone({
  likeCount, superCount, onRestart, onShowFavs,
}: {
  likeCount: number; superCount: number; onRestart: () => void; onShowFavs: () => void;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-8 text-center space-y-4 mt-2">
      <div className="text-5xl">🍽️</div>
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Durch den Stapel!</h2>
        <p className="text-sm text-text-muted mt-1">
          <span className="text-[#3f6b43] font-semibold">{likeCount}× lecker</span>
          {" · "}
          <span className="text-[#d99a2b] font-semibold">{superCount}× superlike</span>
        </p>
      </div>
      <div className="flex flex-col gap-2 max-w-xs mx-auto">
        <button
          onClick={onShowFavs}
          className="w-full py-3 rounded-xl bg-accent text-white text-sm font-semibold active:scale-[0.98] transition-transform"
        >
          Meine Favoriten ansehen
        </button>
        <button
          onClick={onRestart}
          className="w-full py-2.5 rounded-xl bg-surface-elevated border border-border text-text-secondary text-sm font-medium active:scale-[0.98] transition-transform"
        >
          Nochmal von vorn
        </button>
      </div>
    </div>
  );
}

// ── Bento-Grid-Modus ──────────────────────────────────────────
// Rhythmisches Raster: jede 6er-Gruppe hat 1 grosse Hero-Kachel (2×2).

function RecipeGrid({ recipes, onOpen, verdicts, counts }: { recipes: Recipe[]; onOpen: (r: Recipe) => void; verdicts?: Record<string, Verdict>; counts?: TrendCounts }) {
  const isHero = (i: number) => i % 6 === 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 auto-rows-[150px] sm:auto-rows-[180px] gap-3 pt-1">
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
            <RecipeImage r={r} w={hero ? 800 : 400} className="absolute inset-0 w-full h-full object-cover" />
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

  if (imgs.length === 1) {
    const src = imageUrl(imgs[0], 1200);
    return src ? <Lens src={src} alt={r.name} zoom={2.2} lensSize={150} className="w-full h-full" /> : null;
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
        {imgs.map((img, i) => {
          const src = imageUrl(img, 1200);
          return (
            <div key={img + i} className="w-full h-full shrink-0 snap-center bg-surface-elevated">
              {src && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={`${r.name} ${i + 1}`} className="w-full h-full object-cover" draggable={false} loading={i === 0 ? "eager" : "lazy"} />
              )}
            </div>
          );
        })}
      </div>
      <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 flex gap-1.5 pointer-events-none">
        {imgs.map((_, i) => (
          <span key={i} className={`h-1.5 rounded-full transition-all ${i === active ? "w-5 bg-white" : "w-1.5 bg-white/50"}`} />
        ))}
      </div>
      <span className="absolute top-3 left-3 z-20 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-sm text-white text-[10px] font-medium tabular-nums pointer-events-none">
        {active + 1} / {imgs.length}
      </span>
    </div>
  );
}

// ── Detail-Sheet ──────────────────────────────────────────────

// Sterne-Auswahl (1..5). Tippt man den aktuellen Wert erneut, wird er entfernt (null).
function StarRating({ value, onChange, size = 30 }: { value: number; onChange: (n: number | null) => void; size?: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(value === n ? null : n)}
          aria-label={`${n} von 5 Sternen`}
          className="p-0.5 active:scale-90 transition-transform"
        >
          <Star
            className={n <= value ? "text-[#d99a2b]" : "text-text-muted/50"}
            style={{ width: size, height: size }}
            fill={n <= value ? "#d99a2b" : "none"}
          />
        </button>
      ))}
    </div>
  );
}

function RecipeDetail({
  r, onClose, verdict, onVerdict, rating = 0, onRate, dislikeHitList = [],
  friends = [], cookEntries = [], onAddCook, onDeleteCook,
}: {
  r: Recipe; onClose: () => void;
  verdict?: Verdict; onVerdict?: (v: Verdict) => void;
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
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

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

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <motion.div
        initial={{ opacity: prefersReduced ? 1 : 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: prefersReduced ? 0 : "100%" }}
        animate={{ y: 0 }}
        exit={{ y: prefersReduced ? 0 : "100%" }}
        transition={prefersReduced ? { duration: 0 } : { type: "spring", damping: 34, stiffness: 300 }}
        className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-surface sm:rounded-2xl rounded-t-2xl border border-border"
      >
        {/* Header — swipebare Bilder-Galerie */}
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-surface-elevated">
          <GalleryHeader r={r} />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent pointer-events-none" />
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full bg-black/60 backdrop-blur-sm text-white flex items-center justify-center active:scale-95 transition-transform"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="absolute inset-x-0 bottom-0 p-4 pointer-events-none">
            <h2 className="text-white text-xl font-bold leading-tight drop-shadow">{r.name}</h2>
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
              className="sticky top-2 z-30 mx-auto w-fit flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/80 backdrop-blur-md text-white shadow-lg"
            >
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-semibold tabular-nums">
                <NumberFlow value={checkedCount} /> / {totalIngredients} Zutaten
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="p-4 space-y-5">
          <p className="text-sm text-text-secondary leading-relaxed">{r.description}</p>

          {/* Bewerten + zum Account (funktioniert auch aus „Alle Gerichte") */}
          {onVerdict && (
            <div className="rounded-xl border border-border bg-surface-elevated p-3.5 space-y-3.5">
              <div>
                <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Zu deinem Account</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {([["nope", X, "Nö"], ["like", Heart, "Lecker"], ["super", Star, "Superlike"]] as const).map(([v, Icon, label]) => {
                    const active = verdict === v;
                    const color = v === "nope" ? "#bd5138" : v === "like" ? "#4f9a58" : "#d99a2b";
                    return (
                      <button
                        key={v}
                        onClick={() => onVerdict(v)}
                        className={`flex flex-col items-center gap-1 py-2.5 rounded-lg text-xs font-semibold border transition-colors ${
                          active ? "text-white border-transparent" : "text-text-secondary border-border bg-surface"
                        }`}
                        style={active ? { background: color } : undefined}
                      >
                        <Icon className="w-4 h-4" /> {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {onRate && (
                <div>
                  <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">
                    Schon gekocht? Bewerte es
                  </p>
                  <StarRating value={rating} onChange={onRate} />
                </div>
              )}
              {onAddCook && (
                <div className="pt-1 border-t border-border/70">
                  <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2 mt-3">
                    Bereits gekocht — festhalten
                  </p>
                  {cookEntries.length > 0 && (
                    <div className="space-y-1.5 mb-2.5">
                      {cookEntries.map((e) => (
                        <div key={e.id} className="flex items-center gap-2 text-xs">
                          <CookingPot className="w-3.5 h-3.5 text-accent shrink-0" />
                          <span className="text-text-secondary">
                            {fmtDay(e.cookedOn)}{e.withName ? ` · mit ${e.withName}` : " · alleine"}
                          </span>
                          {e.isAuthor && onDeleteCook && (
                            <button onClick={() => onDeleteCook(e.id)} aria-label="Eintrag entfernen"
                              className="ml-auto text-text-muted active:scale-90 transition-transform">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <select
                      value={cookPartner}
                      onChange={(e) => setCookPartner(e.target.value)}
                      className="flex-1 min-w-0 text-xs bg-surface border border-border rounded-lg px-2 py-1.5 text-text-secondary"
                    >
                      <option value="">Alleine</option>
                      {friends.map((f) => (
                        <option key={f.guestId} value={f.guestId}>mit {f.name}</option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={cookDate}
                      max={todayISO()}
                      onChange={(e) => setCookDate(e.target.value)}
                      className="text-xs bg-surface border border-border rounded-lg px-2 py-1.5 text-text-secondary"
                    />
                    <button
                      onClick={() => onAddCook(cookPartner || null, cookDate || todayISO())}
                      className="shrink-0 text-xs font-semibold text-white bg-accent px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
                    >
                      Eintragen
                    </button>
                  </div>
                </div>
              )}
              {dislikeHitList.length > 0 && (
                <p className="text-[11px] text-[#bd5138] flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  Enthält {dislikeHitList.join(", ")} — magst du laut deinem Account nicht.
                </p>
              )}
            </div>
          )}

          {/* Überblick */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: Clock, label: "Zeit", value: r.totalTime },
              { icon: Users, label: "Portionen", value: r.portions },
              { icon: Flame, label: "Level", value: r.difficulty },
            ].filter((x) => x.value).map((x) => (
              <div key={x.label} className="bg-surface-elevated border border-border rounded-xl px-2.5 py-2">
                <div className="flex items-center gap-1 text-[10px] text-text-muted uppercase tracking-wide">
                  <x.icon className="w-3 h-3" /> {x.label}
                </div>
                <p className="text-sm font-semibold text-text-primary mt-0.5">{x.value}</p>
              </div>
            ))}
          </div>

          {/* Makros */}
          <div>
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Nährwerte</h3>
            <MacroChips r={r} animate />
          </div>

          {/* Zutaten mit Abhak-Funktion */}
          {r.ingredients.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                🛒 Zutaten
              </h3>
              <div className="space-y-3">
                {r.ingredients.map((g, gi) => (
                  <div key={gi}>
                    {g.group && (
                      <p className="text-[11px] font-semibold text-text-secondary mb-1">{g.group}</p>
                    )}
                    <div className="space-y-1">
                      {g.items.map((item, ii) => {
                        const key = `${gi}-${ii}`;
                        const isChecked = checked.has(key);
                        return (
                          <button
                            key={key}
                            onClick={() => toggle(key)}
                            className="w-full flex items-start gap-2.5 py-2 px-2 rounded-lg text-left active:bg-surface-elevated transition-colors"
                          >
                            <span
                              className={`shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                                isChecked
                                  ? "bg-accent border-accent text-white"
                                  : "border-border text-transparent"
                              }`}
                            >
                              ✓
                            </span>
                            <span className={`text-sm ${isChecked ? "text-text-muted line-through" : "text-text-secondary"}`}>
                              {item}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Zubereitung */}
          {r.steps.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                👨‍🍳 Zubereitung
              </h3>
              <ol className="space-y-2.5">
                {r.steps.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <p className="text-sm text-text-secondary leading-relaxed">{s}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Tipps */}
          {r.tips.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                💡 Tipps
              </h3>
              <ul className="space-y-1.5">
                {r.tips.map((t, i) => (
                  <li key={i} className="text-xs text-text-muted leading-relaxed flex gap-2">
                    <span className="text-accent">·</span>{t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {r.source && (
            isInstagram ? (
              <a
                href={r.source}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-white text-sm font-semibold active:scale-[0.98] transition-transform"
                style={{ background: "linear-gradient(120deg,#f09433,#e6683c 30%,#dc2743 60%,#cc2366 90%)" }}
              >
                <InstagramIcon className="w-4 h-4" /> Auf Instagram ansehen
              </a>
            ) : (
              <a
                href={r.source}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-border text-text-muted text-xs active:scale-[0.98] transition-transform"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Original-Quelle
              </a>
            )
          )}

          <ShareButton slug={r.slug} name={r.name} />

          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-surface-elevated border border-border text-text-secondary text-sm font-medium"
          >
            Schließen
          </button>
        </div>
      </motion.div>
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
  useEffect(() => () => { stopStream(); if (audioUrl) URL.revokeObjectURL(audioUrl); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const reset = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null); setSeconds(0); onAudioChange(null);
  };

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // Aufgenommen → Wiedergabe + Neu
  if (audioUrl && !recording) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#3f6b43]">
          <Check className="w-4 h-4" /> Aufnahme fertig
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
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

function SuggestSheet({ onClose, defaultName }: { onClose: () => void; defaultName?: string }) {
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
    if (imageFile) fd.append("image", imageFile);

    if (mode === "audio") {
      if (!audioBlob) { toast.error("Fast!", "Nimm zuerst eine Sprachnachricht auf."); return; }
      fd.append("audio", audioBlob, "aufnahme.webm");
      if (name.trim()) fd.append("name", name);
    } else {
      if (!name.trim()) { toast.error("Fast!", "Gib dem Rezept einen Namen."); return; }
      if (!ingredients.trim() && !steps.trim()) { toast.error("Fast!", "Zutaten oder Zubereitung fehlen."); return; }
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
        toast.success("Danke!", mode === "audio"
          ? "Deine Sprachnachricht ist unterwegs — Christian macht ein Rezept draus 🍽️"
          : "Dein Rezept ist bei Christian gelandet 🍽️");
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
        className="relative w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-surface sm:rounded-2xl rounded-t-2xl border border-border p-5 space-y-4"
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

              <AnimatedInput label="Quelle / Link (optional)" value={source} onChange={setSource} inputMode="url" />
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
          disabled={sending || (mode === "audio" ? !audioBlob : !name.trim())}
          className="w-full py-3 rounded-xl bg-accent text-white text-sm font-semibold active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2 sticky bottom-0"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {sending ? "Sende…" : mode === "audio" ? "Sprachnachricht absenden" : "Rezept absenden"}
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

        <div className="bg-surface border border-border rounded-3xl p-5 shadow-[0_10px_30px_rgba(70,50,30,0.10)] space-y-3">
          <div className="flex items-center rounded-full bg-surface-elevated p-1 border border-border">
            {([["register", "Registrieren"], ["login", "Einloggen"]] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => { setMode(m); setErr(null); }}
                className={`flex-1 py-1.5 rounded-full text-xs font-semibold transition-colors ${mode === m ? "bg-surface text-text-primary shadow-sm" : "text-text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <AnimatedInput label="Benutzername" value={username} onChange={setUsername} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          <AnimatedInput label="Passwort" value={password} onChange={setPassword} type="password"
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />

          {err && <p className="text-xs text-[#bd5138] text-left">{err}</p>}

          <button
            onClick={submit}
            disabled={busy || !username.trim() || !password}
            className="w-full py-3 rounded-xl bg-accent text-white text-sm font-semibold active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isRegister ? "Los geht's" : "Einloggen"}
            {!busy && <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

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
          <RecipeImage r={recipe} w={800} className="w-full h-full object-cover" />
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

function AccountView({
  guestId, guestName, recipes, verdicts, ratings, dislikes, cookEvents, onOpen, onSuggest, onLogout, onPlanEvening, onSaveDislikes,
}: {
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

  const favs = useMemo(
    () =>
      Object.entries(verdicts)
        .filter(([, v]) => v === "like" || v === "super")
        .map(([slug, v]) => ({ r: bySlug.get(slug), v }))
        .filter((x): x is { r: Recipe; v: Verdict } => !!x.r),
    [verdicts, bySlug],
  );

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
        setMatches(d.matches ?? []);
      }
    } catch { /* offline egal */ } finally {
      setLoading(false);
    }
  }, [guestId, guestName]);

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
  const leaveGroup = async (groupId: string) => {
    await groupAction({ action: "leave", groupId });
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
      try { await navigator.share({ title: "Essen planen gemeinsam", text, url }); return; } catch { /* fallthrough */ }
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
      try { await navigator.share({ title: "Rezepte-Match", text }); return; } catch { /* fallthrough */ }
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
        <p className="text-sm text-text-muted mt-0.5">Dein Account, deine Matches und Favoriten.</p>
      </div>

      {/* Freundescode */}
      <div className="order-7 rounded-2xl border border-border bg-surface p-4">
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
      <div className="order-8 rounded-2xl border border-border bg-surface p-4">
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
      <div className="order-2">
        <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5 mb-2">
          <Heart className="w-4 h-4 text-accent fill-accent" /> Eure Matches
        </h3>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 text-text-muted animate-spin" /></div>
        ) : connections.length === 0 ? (
          <p className="text-sm text-text-muted bg-surface border border-border rounded-2xl p-4">
            Noch niemand verbunden. Teile deinen Code oder gib oben einen ein.
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
                            {r ? <RecipeImage r={r} w={400} className="w-full h-full object-cover" /> : null}
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
      <div className="order-6">
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
                  <button onClick={() => leaveGroup(g.id)} disabled={groupBusy} aria-label="Gruppe verlassen" className="shrink-0 text-text-muted hover:text-[#bd5138] p-1">
                    <LogOut className="w-3.5 h-3.5" />
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
                              {r ? <RecipeImage r={r} w={400} className="w-full h-full object-cover" /> : null}
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
                            {r ? <RecipeImage r={r} w={400} className="w-full h-full object-cover" /> : null}
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

      {/* Meine Favoriten */}
      <div className="order-3">
        <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5 mb-2">
          <Star className="w-4 h-4 text-[#d99a2b] fill-[#d99a2b]" /> Meine Favoriten
          {favs.length > 0 && <span className="text-[11px] font-normal text-text-muted tabular-nums">({favs.length})</span>}
        </h3>
        {favs.length === 0 ? (
          <p className="text-sm text-text-muted bg-surface border border-border rounded-2xl p-4">
            Noch nichts gemerkt. Wisch im Swipe-Tab nach rechts, was dir schmeckt.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {(favsExpanded ? favs : favs.slice(0, 10)).map(({ r, v }) => (
                <button
                  key={r.slug}
                  onClick={() => onOpen(r)}
                  className="relative rounded-xl overflow-hidden aspect-[4/3] bg-surface-elevated text-left active:scale-[0.98] transition-transform"
                >
                  <RecipeImage r={r} w={400} className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 to-transparent" />
                  {v === "super" && (
                    <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#d99a2b] flex items-center justify-center"><Star className="w-3 h-3 fill-white text-white" /></span>
                  )}
                  <p className="absolute inset-x-0 bottom-0 p-2 text-white text-[11px] font-semibold leading-tight line-clamp-2 drop-shadow">{r.name}</p>
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
      <div className="order-4">
        <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5 mb-2">
          <CookingPot className="w-4 h-4 text-accent" /> Schon gekocht
          {cooked.length > 0 && <span className="text-[11px] font-normal text-text-muted tabular-nums">({cooked.length})</span>}
        </h3>
        {cooked.length === 0 ? (
          <p className="text-sm text-text-muted bg-surface border border-border rounded-2xl p-4">
            Noch nichts eingetragen. Öffne ein Gericht → Sterne vergeben oder „bereits gekocht" festhalten (auch mit wem).
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
                  <RecipeImage r={r} w={400} className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary truncate">{r.name}</p>
                  {stars > 0 && (
                    <div className="flex items-center gap-0.5 mt-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={`w-3.5 h-3.5 ${n <= stars ? "text-[#d99a2b]" : "text-text-muted/40"}`} fill={n <= stars ? "#d99a2b" : "none"} />
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
      <div className="order-9">
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
                  <button onClick={() => removeDislike(d)} aria-label={`${d} entfernen`} className="w-4 h-4 rounded-full flex items-center justify-center active:scale-90 transition-transform">
                    <X className="w-3 h-3" />
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
              className="flex-1 min-w-0 bg-transparent text-sm text-text-primary placeholder:text-text-muted/60 outline-none py-1"
            />
            {dislikeInput.trim() && (
              <button onClick={() => addDislike(dislikeInput)} className="shrink-0 text-xs font-semibold text-accent px-2 py-1 rounded-lg active:scale-95 transition-transform">
                Hinzufügen
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Vorschlag */}
      <button
        onClick={onSuggest}
        className="order-5 w-full py-3 rounded-xl bg-accent/10 border border-accent/25 text-accent text-sm font-semibold active:scale-[0.98] transition-transform"
      >
        + Rezept einreichen
      </button>

      {/* Abmelden */}
      <button
        onClick={onLogout}
        className="order-10 w-full py-2.5 rounded-xl text-text-muted text-xs font-medium flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
      >
        <LogOut className="w-3.5 h-3.5" /> Abmelden
      </button>
    </div>
  );
}

// ── Seite ─────────────────────────────────────────────────────

export default function RezeptePage() {
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
  const [history, setHistory] = useState<string[]>([]);
  const [deckList, setDeckList] = useState<Recipe[]>([]);
  const [deckMode, setDeckMode] = useState<"new" | "all">("new"); // new = nur ungeswipte, all = alles außer „nö"
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [guestName, setGuestName] = useState<string | null>(null);
  const [guestId, setGuestId] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);
  const [counts, setCounts] = useState<TrendCounts>({});
  const [search, setSearch] = useState("");
  const [searchDimmed, setSearchDimmed] = useState(false);
  const [match, setMatch] = useState<{ recipe: Recipe; partners: MatchPing[] } | null>(null);
  const [eveningGroup, setEveningGroup] = useState<{ id: string; name: string } | null>(null);
  const dimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deepLinkDone = useRef(false);
  const pendingGroupDone = useRef(false);
  const verdictsRef = useRef<Record<string, Verdict>>({});
  const filteredRef = useRef<Recipe[]>([]);
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

  useEffect(() => {
    setVerdicts(loadVerdicts());
    setRatings(loadRatings());
    setDislikes(loadDislikes());
    try {
      const n = localStorage.getItem(NAME_KEY);
      const id = localStorage.getItem(ID_KEY);
      if (n) setGuestName(n);
      if (id) setGuestId(id);
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  // Nach Login / beim Öffnen: Server-Bewertungen holen, damit der Stand auf jedem
  // Gerät stimmt (der Account kann anderswo geswipt haben).
  useEffect(() => {
    if (!hydrated || !guestId) return;
    fetch("/api/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestId, name: guestName }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ratings) { setRatings(d.ratings); replaceRatings(d.ratings); }
        if (Array.isArray(d.dislikes)) { setDislikes(d.dislikes); replaceDislikes(d.dislikes); }
        if (Array.isArray(d.cooked)) setCookEvents(d.cooked);
        if (Array.isArray(d.connections)) setFriends(d.connections);
        if (!d.verdicts) return;
        setVerdicts(d.verdicts);
        replaceVerdicts(d.verdicts);
        // Deck einmalig mit den Server-Bewertungen neu bauen — solange der User
        // in dieser Runde noch nicht selbst geswipt hat (sonst nicht anfassen).
        if (!startedRef.current) {
          setDeckList(orderDeck(filteredRef.current.filter((r) => !d.verdicts[r.slug])));
          setDeckMode("new");
          setIndex(0);
          setHistory([]);
        }
      })
      .catch(() => { /* offline egal */ });
  }, [hydrated, guestId, guestName, orderDeck]);

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
    try { localStorage.removeItem(NAME_KEY); localStorage.removeItem(ID_KEY); localStorage.removeItem(FAV_KEY); localStorage.removeItem(RATE_KEY); localStorage.removeItem(DISLIKE_KEY); } catch { /* ignore */ }
    startedRef.current = false; setDeckList([]);
    setGuestName(null); setGuestId(""); setVerdicts({}); setRatings({}); setDislikes([]); setCookEvents([]); setFriends([]); setHistory([]); setIndex(0); setMode("swipe");
  }, []);

  const handleVerdict = useCallback((r: Recipe, v: Verdict) => {
    startedRef.current = true;
    saveVerdict(r.slug, v);
    setVerdicts((prev) => ({ ...prev, [r.slug]: v }));
    setHistory((prev) => [...prev, r.slug]);
    if (guestId && guestName) {
      postVerdict({ guestId, name: guestName, slug: r.slug, recipeName: r.name, category: r.category, verdict: v })
        .then((res) => {
          // Rechts/Hoch auf ein Gericht, das ein:e Freund:in schon mag → Match-Animation
          if ((v === "like" || v === "super") && res?.matches?.length) {
            setMatch({ recipe: r, partners: res.matches });
          }
        });
    }
  }, [guestId, guestName]);

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      saveVerdict(last, null);
      setVerdicts((v) => { const n = { ...v }; delete n[last]; return n; });
      setIndex((i) => Math.max(0, i - 1));
      if (guestId && guestName) postVerdict({ guestId, name: guestName, slug: last, verdict: null });
      return prev.slice(0, -1);
    });
  }, [guestId, guestName]);

  const likeCount = Object.values(verdicts).filter((v) => v === "like").length;
  const superCount = Object.values(verdicts).filter((v) => v === "super").length;

  // Verdict aus dem Detail-Sheet setzen (z.B. aus „Alle Gerichte") — ohne den
  // Swipe-Index anzufassen. Gleicher Button nochmal = entfernen.
  const setDetailVerdict = useCallback((r: Recipe, v: Verdict) => {
    const next = verdicts[r.slug] === v ? null : v;
    saveVerdict(r.slug, next);
    setVerdicts((prev) => { const n = { ...prev }; if (next) n[r.slug] = next; else delete n[r.slug]; return n; });
    if (guestId && guestName) {
      postVerdict({ guestId, name: guestName, slug: r.slug, recipeName: r.name, category: r.category, verdict: next })
        .then((res) => {
          if ((next === "like" || next === "super") && res?.matches?.length) setMatch({ recipe: r, partners: res.matches });
        });
    }
  }, [verdicts, guestId, guestName]);

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
    fetch("/api/recipes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setRecipes(d.recipes ?? []);
        setCategories(d.categories ?? []);
        setDiag(d.diagnostics ?? null);
        if (d.error) setError(d.error);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Netzwerkfehler"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (activeCat === "Alle") return recipes;
    return recipes.filter((r) => r.category === activeCat);
  }, [recipes, activeCat]);

  // verdicts + filtered immer aktuell im Ref halten (für den Deck-Aufbau nach
  // asynchroner Hydration, ohne Re-Render-Schleife)
  useEffect(() => { verdictsRef.current = verdicts; }, [verdicts]);
  useEffect(() => { filteredRef.current = filtered; }, [filtered]);

  // ── Swipe-Stapel (Snapshot) ────────────────────────────────────────
  // Der Deck zeigt nur Rezepte, die man NOCH NICHT geswipt hat. Einmal geswipt
  // (egal ob lecker/nö/super) → raus aus dem Stapel. „Nö" bleibt dauerhaft weg,
  // auch nach „Nochmal von vorn". Snapshot = stabile Reihenfolge beim Wischen.
  useEffect(() => {
    const v = verdictsRef.current;
    setDeckList(orderDeck(filtered.filter((r) => !v[r.slug])));
    setDeckMode("new");
    setIndex(0);
    setHistory([]);
    startedRef.current = false;
  }, [filtered, orderDeck]);

  // „Nochmal von vorn": zeigt wieder alles AUSSER den abgelehnten Gerichten.
  const resetDeck = useCallback(() => {
    const v = verdictsRef.current;
    setDeckList(orderDeck(filtered.filter((r) => v[r.slug] !== "nope")));
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

  // Geteilter Link `/?rezept=slug` → Detail direkt öffnen (einmalig, sobald Rezepte da sind).
  useEffect(() => {
    if (deepLinkDone.current || recipes.length === 0) return;
    deepLinkDone.current = true;
    try {
      const slug = new URLSearchParams(window.location.search).get("rezept");
      if (slug) {
        const r = recipes.find((x) => x.slug.toLowerCase() === slug.toLowerCase());
        if (r) setDetail(r);
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch { /* ignore */ }
  }, [recipes]);

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
    setHistory((prev) => [...prev, r.slug]);
    postEvening({ action: "evening-pick", groupId: eveningGroup.id, slug: r.slug, recipeName: r.name, category: r.category, verdict: v });
  }, [eveningGroup, postEvening]);

  const handleEveningUndo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setIndex((i) => Math.max(0, i - 1));
      if (eveningGroup) postEvening({ action: "evening-pick", groupId: eveningGroup.id, slug: last, verdict: null });
      return prev.slice(0, -1);
    });
  }, [eveningGroup, postEvening]);

  const startEvening = useCallback((id: string, name: string) => {
    setEveningGroup({ id, name }); setIndex(0); setHistory([]); setMode("swipe");
  }, []);
  const exitEvening = useCallback(() => {
    setEveningGroup(null); setIndex(0); setHistory([]);
  }, []);
  const resetEveningRound = useCallback(() => {
    if (!eveningGroup) return;
    postEvening({ action: "evening-reset", groupId: eveningGroup.id })
      ?.then(() => { setIndex(0); setHistory([]); toast.success("Neuer Abend", "Deine Runde ist zurückgesetzt."); });
  }, [eveningGroup, postEvening, toast]);

  // Vorausladen: die nächsten Karten-Bilder schon holen, damit Wischen instant wirkt.
  useEffect(() => {
    if (mode !== "swipe") return;
    const deck = eveningGroup ? eveningRecipes : deckList;
    if (deck.length === 0) return;
    const AHEAD = 5;
    for (let i = index; i < Math.min(index + AHEAD, deck.length); i++) {
      const r = deck[i];
      if (!r?.imageExists || !r.image) continue;
      const pre = new window.Image();
      pre.decoding = "async";
      pre.src = imageUrl(r.image, 800)!;
    }
  }, [deckList, eveningRecipes, eveningGroup, index, mode]);

  const showDeck = !loading && mode === "swipe" && (eveningGroup
    ? (eveningRecipes.length > 0 && index < eveningRecipes.length)
    : (deckList.length > 0 && index < deckList.length));

  // Vor allem anderen: Name abfragen (nach dem Lesen aus localStorage, um Flackern zu vermeiden)
  if (!hydrated) return <div className="h-[100dvh]" />;
  if (!guestName) return (
    <AuthGate onDone={(n, id, v) => {
      setGuestName(n); setGuestId(id);
      if (v) { setVerdicts(v); replaceVerdicts(v); }
    }} />
  );

  return (
    <div className="mx-auto w-full max-w-3xl h-[100dvh] flex flex-col px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-[max(env(safe-area-inset-bottom),1.75rem)]">
      {/* Header — zentrierter 3-Tab-Switcher (aktiver Tab zeigt Label). Logo dient nur als Favicon. */}
      <div className="flex justify-center shrink-0">
        <div className="flex items-center rounded-full bg-surface-elevated p-1 gap-0.5 border border-border">
          {([
            ["swipe", Sparkles, "Entdecken"],
            ["grid", BookOpen, "Alle Gerichte"],
            ["account", User, "Profil"],
          ] as const).map(([m, Icon, label]) => {
            const active = mode === m;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-label={label}
                className={`flex items-center gap-2 py-2 rounded-full transition-all ${
                  active ? "bg-surface text-text-primary shadow-sm px-4" : "text-text-muted px-3.5"
                }`}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                {active && <span className="text-sm font-semibold leading-none">{label}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Kategorie-Filter — dezent, eine Reihe (nicht im Account, nicht im Abend-Modus) */}
      {mode !== "account" && !eveningGroup && categories.length > 0 && (
        <div className="flex flex-nowrap items-center gap-1.5 shrink-0 mt-4 overflow-x-auto scrollbar-none -mx-4 px-4">
          {["Alle", ...orderCategories(categories)].map((cat) => {
            const active = activeCat === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCat(cat)}
                className={`relative shrink-0 whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  active ? "text-white border-transparent" : "bg-transparent border-border/50 text-text-muted/70 hover:text-text-secondary"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="cat-pill"
                    className="absolute inset-0 rounded-full bg-accent/85"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative z-10">
                  {cat === "Alle" ? "Alle" : `${CATEGORY_EMOJI[cat] ?? ""} ${catLabel(cat)}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Inhalt */}
      <div
        onScroll={mode === "grid" ? onGridScroll : undefined}
        className={showDeck ? "flex-1 min-h-0 flex flex-col mt-4" : "flex-1 min-h-0 overflow-y-auto overflow-x-hidden mt-4"}
      >
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-5 h-5 text-text-muted animate-spin" />
          </div>
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
          ) : deckList.length > 0 ? (
            index < deckList.length ? (
              <SwipeDeck
                recipes={deckList}
                index={index}
                setIndex={setIndex}
                onOpen={setDetail}
                onVerdict={handleVerdict}
                onUndo={handleUndo}
                canUndo={history.length > 0}
              />
            ) : (
              <DeckDone
                likeCount={likeCount}
                superCount={superCount}
                onRestart={resetDeck}
                onShowFavs={() => setMode("account")}
              />
            )
          ) : filtered.length > 0 ? (
            // Alle Rezepte dieser Kategorie schon geswipt.
            <div className="bg-surface border border-border rounded-2xl p-8 text-center space-y-4 mt-2">
              <div className="text-5xl">🍽️</div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">
                  {deckMode === "all" ? "Alles bewertet!" : "Alles durchgeswiped!"}
                </h2>
                <p className="text-sm text-text-muted mt-1">
                  {deckMode === "all"
                    ? "Du hast jedes Gericht hier bewertet. Deine Favoriten liegen im Account."
                    : "Deine Favoriten liegen im Account. Nochmal ansehen? Abgelehnte bleiben ausgeblendet."}
                </p>
              </div>
              <div className="flex flex-col gap-2 max-w-xs mx-auto">
                {deckMode !== "all" && (
                  <button onClick={resetDeck} className="w-full py-3 rounded-xl bg-accent text-white text-sm font-semibold active:scale-[0.98] transition-transform">
                    Nochmal von vorn
                  </button>
                )}
                <button onClick={() => setMode("account")} className="w-full py-2.5 rounded-xl bg-surface-elevated border border-border text-text-secondary text-sm font-medium active:scale-[0.98] transition-transform">
                  Zu deinen Favoriten
                </button>
              </div>
            </div>
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
                        <RecipeImage r={r} w={400} className="w-full h-full object-cover" />
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

      {/* Schwebende Suche — nur im Raster, fadet beim Scrollen */}
      {mode === "grid" && recipes.length > 0 && (
        <div className={`fixed left-1/2 -translate-x-1/2 bottom-[max(env(safe-area-inset-bottom),1rem)] z-40 w-[min(92%,28rem)] transition-opacity duration-300 ${searchDimmed ? "opacity-40" : "opacity-100"}`}>
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
        {detail && (
          <RecipeDetail
            r={detail}
            onClose={() => setDetail(null)}
            verdict={verdicts[detail.slug]}
            onVerdict={(v) => setDetailVerdict(detail, v)}
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
        {suggestOpen && <SuggestSheet onClose={() => setSuggestOpen(false)} defaultName={guestName ?? ""} />}
      </AnimatePresence>

      {/* Match-Animation */}
      <AnimatePresence>
        {match && <MatchCelebration match={match} onClose={() => setMatch(null)} />}
      </AnimatePresence>
    </div>
  );
}
