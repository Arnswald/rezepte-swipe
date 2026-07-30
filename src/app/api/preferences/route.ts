/**
 * POST /api/preferences
 * Speichert die schlanken Vorlieben eines Gasts ("Was ich nicht mag").
 *
 * Body: { guestId, name?, dislikes: string[] }  → { ok, dislikes }
 */

import { NextResponse } from "next/server";
import { ensureGuest, setDislikes, getDislikes } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as {
      guestId?: string; name?: string; dislikes?: unknown;
    };
    const guestId = (b.guestId ?? "").trim().slice(0, 64);
    const name = (b.name ?? "").trim().slice(0, 80);
    if (!guestId) return NextResponse.json({ error: "guestId fehlt" }, { status: 400 });

    const dislikes = Array.isArray(b.dislikes)
      ? b.dislikes.filter((d): d is string => typeof d === "string")
      : [];

    ensureGuest(guestId, name || "Gast", new Date().toISOString());
    setDislikes(guestId, dislikes, new Date().toISOString());
    return NextResponse.json({ ok: true, dislikes: getDislikes(guestId) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
