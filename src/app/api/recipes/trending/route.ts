/**
 * GET /api/recipes/trending
 * Öffentliche, aggregierte Beliebtheits-Zähler pro Gericht — OHNE Namen.
 *   → { counts: { [slug]: { likes, supers } } }
 *
 * likes = Anzahl like+super, supers = Anzahl super. Basis für die Trending-Badges
 * und die Sortierung im Raster.
 */

import { NextResponse } from "next/server";
import { getTrendingCounts } from "@/lib/db";
import { RECIPE_SOURCE } from "@/lib/recipes";
import { recipeStore } from "@/lib/recipeStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const counts = getTrendingCounts();
    // Eigene Rezepte der Nutzer sind privat: auch ihr Slug taucht hier nicht auf.
    if (RECIPE_SOURCE === "db") {
      const privat = recipeStore().db.prepare(`SELECT slug FROM recipes WHERE privat = 1`).all() as { slug: string }[];
      for (const p of privat) delete counts[p.slug];
    }
    return NextResponse.json({ counts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), counts: {} },
      { status: 500 },
    );
  }
}
