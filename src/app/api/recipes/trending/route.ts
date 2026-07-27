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

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ counts: getTrendingCounts() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), counts: {} },
      { status: 500 },
    );
  }
}
