/**
 * POST /api/verdict
 * Speichert die Bewertung eines Gasts zu einem Gericht.
 *
 * Body: { guestId, name, slug, recipeName?, category?, verdict }
 *   verdict = "like" | "nope" | "super"  → upsert
 *   verdict = null                        → Undo (löscht die Zeile)
 */

import { NextResponse } from "next/server";
import { upsertVerdict, deleteVerdict, type Verdict } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID: Verdict[] = ["like", "nope", "super"];

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as {
      guestId?: string; name?: string; slug?: string;
      recipeName?: string; category?: string; verdict?: string | null;
    };

    const guestId = (b.guestId ?? "").trim().slice(0, 64);
    const name = (b.name ?? "").trim().slice(0, 80);
    const slug = (b.slug ?? "").trim().slice(0, 200);
    if (!guestId || !name || !slug) {
      return NextResponse.json({ error: "guestId, name und slug sind Pflicht" }, { status: 400 });
    }

    // Undo → löschen
    if (b.verdict === null || b.verdict === undefined || b.verdict === "") {
      deleteVerdict(guestId, slug);
      return NextResponse.json({ ok: true, deleted: true });
    }

    if (!VALID.includes(b.verdict as Verdict)) {
      return NextResponse.json({ error: "Ungültiges Verdict" }, { status: 400 });
    }

    upsertVerdict({
      guestId,
      name,
      slug,
      recipeName: (b.recipeName ?? "").slice(0, 200),
      category: (b.category ?? "").slice(0, 60),
      verdict: b.verdict as Verdict,
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
