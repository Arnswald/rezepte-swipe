/**
 * POST /api/me
 * Liefert den serverseitigen Stand einer Identität (Bewertungen, Freundescode),
 * damit die App beim Öffnen — auch nach Login auf einem neuen Gerät — den
 * kompletten Stand herstellen kann.
 *
 * Body: { guestId, name? }  → { verdicts, ratings, dislikes, friendCode }
 */

import { NextResponse } from "next/server";
import { ensureGuest, getVerdictsForGuest, getRatingsForGuest, getDislikes } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { guestId?: string; name?: string };
    const guestId = (b.guestId ?? "").trim().slice(0, 64);
    const name = (b.name ?? "").trim().slice(0, 80);
    if (!guestId) return NextResponse.json({ error: "guestId fehlt" }, { status: 400 });
    const guest = ensureGuest(guestId, name || "Gast", new Date().toISOString());
    return NextResponse.json({
      verdicts: getVerdictsForGuest(guestId),
      ratings: getRatingsForGuest(guestId),
      dislikes: getDislikes(guestId),
      friendCode: guest.friend_code,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
