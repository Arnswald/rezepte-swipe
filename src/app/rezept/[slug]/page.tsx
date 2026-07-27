/**
 * /rezept/[slug] — teilbare, server-gerenderte Rezept-Seite.
 *
 * Zweck: Wenn jemand ein Gericht per WhatsApp teilt, landet der/die Empfänger:in
 * hier — mit schöner Link-Vorschau (OG-Tags: Titel, Beschreibung, Bild). Von hier
 * führt ein CTA in die Swipe-App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * Server-Component (Datei-Mount ist nur serverseitig lesbar) → force-dynamic,
 * kein Static-Build (der Vault ist beim `next build` nicht vorhanden).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Users, Flame, ChevronRight, ArrowLeft, ExternalLink } from "lucide-react";
import { getRecipeBySlug, type Recipe } from "@/lib/recipes";
import { ShareButton } from "@/components/ShareButton";

export const dynamic = "force-dynamic";

function img(file: string | null, w: number): string | null {
  if (!file) return null;
  return `/api/recipes/image/${encodeURIComponent(file)}?w=${w}`;
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const r = getRecipeBySlug(slug);
  if (!r) return { title: "Rezept nicht gefunden — Rezepte" };

  const desc = r.description || "Ein Lieblingsrezept zum Nachkochen.";
  const ogImg = r.imageExists ? img(r.image, 1200) : null;

  return {
    title: `${r.name} — Rezepte`,
    description: desc,
    openGraph: {
      title: r.name,
      description: desc,
      type: "article",
      ...(ogImg ? { images: [{ url: ogImg, width: 1200, height: 750, alt: r.name }] } : {}),
    },
    twitter: {
      card: ogImg ? "summary_large_image" : "summary",
      title: r.name,
      description: desc,
      ...(ogImg ? { images: [ogImg] } : {}),
    },
  };
}

function NotFound() {
  return (
    <main className="min-h-[100dvh] flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-4">🤔</div>
        <h1 className="text-xl font-extrabold text-text-primary">Rezept nicht gefunden</h1>
        <p className="text-sm text-text-secondary mt-2">
          Vielleicht wurde es umbenannt. Schau in der App vorbei:
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-1 px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold"
        >
          Zur Rezepte-App <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </main>
  );
}

export default async function RezeptPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r: Recipe | null = getRecipeBySlug(slug);
  if (!r) return <NotFound />;

  const hero = r.imageExists ? img(r.image, 1200) : null;
  const macros = [
    { label: "kcal", value: r.kcal, suffix: "" },
    { label: "Protein", value: r.protein, suffix: " g" },
    { label: "Kohlenhydrate", value: r.carbs, suffix: " g" },
    { label: "Fett", value: r.fat, suffix: " g" },
  ].filter((m): m is typeof m & { value: number } => m.value != null);

  const overview = [
    { icon: Clock, label: "Zeit", value: r.totalTime },
    { icon: Users, label: "Portionen", value: r.portions },
    { icon: Flame, label: "Level", value: r.difficulty },
  ].filter((x) => x.value);

  const isInstagram = r.source ? /instagram\.com/i.test(r.source) : false;

  return (
    <main className="min-h-[100dvh] pb-16" style={{ background: "var(--bg)" }}>
      <div className="mx-auto w-full max-w-2xl">
        {/* Hero */}
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-surface-elevated">
          {hero ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero} alt={r.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl opacity-40">🍽️</div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />
          <Link
            href="/"
            className="absolute top-3 left-3 z-10 inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-sm text-white text-xs font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> App
          </Link>
          <div className="absolute inset-x-0 bottom-0 p-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/80">
              {r.category}
            </span>
            <h1 className="text-white text-2xl font-extrabold leading-tight drop-shadow mt-0.5">{r.name}</h1>
          </div>
        </div>

        <div className="px-4 sm:px-6 pt-5 space-y-6">
          {r.description && (
            <p className="text-sm text-text-secondary leading-relaxed">{r.description}</p>
          )}

          {/* CTA + Teilen */}
          <div className="flex gap-2.5">
            <Link
              href={`/?rezept=${encodeURIComponent(r.slug)}`}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-accent text-white text-sm font-semibold active:scale-[0.98] transition-transform"
            >
              In der App öffnen <ChevronRight className="w-4 h-4" />
            </Link>
            <ShareButton
              slug={r.slug}
              name={r.name}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-surface-elevated border border-border text-text-secondary text-sm font-semibold active:scale-[0.98] transition-transform"
            />
          </div>

          {overview.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {overview.map((x) => (
                <div key={x.label} className="bg-surface-elevated border border-border rounded-xl px-2.5 py-2">
                  <div className="flex items-center gap-1 text-[10px] text-text-muted uppercase tracking-wide">
                    <x.icon className="w-3 h-3" /> {x.label}
                  </div>
                  <p className="text-sm font-semibold text-text-primary mt-0.5">{x.value}</p>
                </div>
              ))}
            </div>
          )}

          {macros.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Nährwerte</h2>
              <div className="flex flex-wrap gap-1.5">
                {macros.map((m) => (
                  <span key={m.label} className="px-2 py-1 rounded-md text-xs font-semibold bg-surface-elevated border border-border text-text-secondary">
                    {m.value}{m.suffix} <span className="opacity-60 font-normal">{m.label}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {r.ingredients.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">🛒 Zutaten</h2>
              <div className="space-y-3">
                {r.ingredients.map((g, gi) => (
                  <div key={gi}>
                    {g.group && <p className="text-[11px] font-semibold text-text-secondary mb-1">{g.group}</p>}
                    <ul className="space-y-1">
                      {g.items.map((item, ii) => (
                        <li key={ii} className="text-sm text-text-secondary flex gap-2">
                          <span className="text-accent mt-1.5 w-1 h-1 rounded-full bg-accent shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {r.steps.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">👨‍🍳 Zubereitung</h2>
              <ol className="space-y-2.5">
                {r.steps.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center">{i + 1}</span>
                    <p className="text-sm text-text-secondary leading-relaxed">{s}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {r.tips.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">💡 Tipps</h2>
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
            <a
              href={r.source}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-border text-text-muted text-xs"
            >
              <ExternalLink className="w-3.5 h-3.5" /> {isInstagram ? "Auf Instagram ansehen" : "Original-Quelle"}
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
