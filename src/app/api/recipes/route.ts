/**
 * GET /api/recipes            → alle Rezepte (inkl. Diagnose)
 * GET /api/recipes?lite=1     → alle Rezepte OHNE Zubereitung/Tipps (Swipe-Liste)
 * GET /api/recipes?slug=x     → ein Rezept komplett (Detail-Sheet lädt nach)
 * GET /api/recipes?diag=1     → nur Diagnose (Pfad-Check, schnell)
 * GET /api/recipes?quelle=db|obsidian  (x-admin-pin / x-server-key) → Liste aus genau dieser
 *     Quelle, ungemerkt — für den Parallelvergleich beim Umschalten (tools/vergleich-live.mjs)
 *
 * Warum lite: Zubereitung + Tipps sind ~60 % der Liste (465 KB bei 188 Rezepten),
 * werden aber erst im Detail gebraucht. Zutaten bleiben drin (Empfehlungen +
 * „Was ich nicht mag“ rechnen damit).
 */

import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { scanRecipes, scanObsidian, publicRecipe, recipesDiagnostics, getRecipeBySlug } from "@/lib/recipes";
import { recipeStore } from "@/lib/recipeStore";
import { checkAdminOrServer } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const diag = recipesDiagnostics();

  if (searchParams.get("diag") === "1") {
    return NextResponse.json({ diagnostics: diag });
  }

  const slug = searchParams.get("slug");
  if (slug) {
    const recipe = getRecipeBySlug(slug);
    if (!recipe) return NextResponse.json({ error: "Rezept nicht gefunden" }, { status: 404 });
    return NextResponse.json({ recipe });
  }

  const quelle = searchParams.get("quelle");
  if (quelle === "db" || quelle === "obsidian") {
    const bad = checkAdminOrServer(req);
    if (bad) return bad;
  }

  try {
    const all = quelle === "db" ? recipeStore().list().map(publicRecipe)
      : quelle === "obsidian" ? scanObsidian()
      : scanRecipes();
    const lite = searchParams.get("lite") === "1";
    const recipes = lite ? all.map(({ steps: _s, tips: _t, ...rest }) => ({ ...rest, lite: true })) : all;
    const categories = [...new Set(all.map((r) => r.category))].sort();
    // ETag: beim erneuten Öffnen (Home-Bildschirm-App) antwortet der Server mit 304
    // statt ~180 KB (~50 KB komprimiert). „no-cache“ = immer nachfragen, nie veraltet.
    const body = JSON.stringify({ recipes, categories, diagnostics: diag });
    const etag = `"${createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;
    const headers = { "Cache-Control": "no-cache", ETag: etag };
    // Cloudflare schwächt das ETag beim Komprimieren ab (W/"…") → Präfix ignorieren
    const inm = (req.headers.get("if-none-match") ?? "").split(",").map((t) => t.trim().replace(/^W\//, ""));
    if (inm.includes(etag)) return new Response(null, { status: 304, headers });
    return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), diagnostics: diag },
      { status: 500 },
    );
  }
}
