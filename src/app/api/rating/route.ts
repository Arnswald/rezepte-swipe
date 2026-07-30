/**
 * POST /api/rating
 * Sterne-Bewertung eines Gasts NACH dem Kochen (getrennt vom Swipe-Verdict).
 *
 * Body: { guestId, name, slug, recipeName?, category?, stars }
 *   stars = 1..5  → upsert
 *   stars = null  → löschen
 */

import { NextResponse } from "next/server";
import { upsertRating, deleteRating, ensureGuest } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as {
      guestId?: string; name?: string; slug?: string;
      recipeName?: string; category?: string; stars?: number | null;
    };

    const guestId = (b.guestId ?? "").trim().slice(0, 64);
    const name = (b.name ?? "").trim().slice(0, 80);
    const slug = (b.slug ?? "").trim().slice(0, 200);
    if (!guestId || !name || !slug) {
      return NextResponse.json({ error: "guestId, name und slug sind Pflicht" }, { status: 400 });
    }

    ensureGuest(guestId, name, new Date().toISOString());

    if (b.stars === null || b.stars === undefined) {
      deleteRating(guestId, slug);
      return NextResponse.json({ ok: true, deleted: true });
    }

    const stars = Number(b.stars);
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
      return NextResponse.json({ error: "stars muss 1..5 sein" }, { status: 400 });
    }

    upsertRating({
      guestId,
      name,
      slug,
      recipeName: (b.recipeName ?? "").slice(0, 200),
      category: (b.category ?? "").slice(0, 60),
      stars,
      now: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
