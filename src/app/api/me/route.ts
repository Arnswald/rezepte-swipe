/**
 * POST /api/me
 * Liefert den serverseitigen Stand einer Identität (Bewertungen, Freundescode),
 * damit die App beim Öffnen — auch nach Login auf einem neuen Gerät — den
 * kompletten Stand herstellen kann.
 *
 * Body: { guestId, name? }  → { verdicts, ratings, dislikes, cooked, connections, friendCode,
 *   swipeDays: { from, to, days: { day: { slug: {v, at} } }, likeCountsBefore: { slug: n } } }
 * swipeDays = „Heute gemerkt“: die Tage vorgestern…morgen einzeln, davor nur die Zahl der Tage mit like/super.
 */

import { NextResponse } from "next/server";
import { ensureGuest, getVerdictsForGuest, getRatingsForGuest, getDislikes, getCookEventsForGuest, getConnections, getSwipeDaysForGuest, swipeWindow } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { guestId?: string; name?: string };
    const guestId = (b.guestId ?? "").trim().slice(0, 64);
    const name = (b.name ?? "").trim().slice(0, 80);
    if (!guestId) return NextResponse.json({ error: "guestId fehlt" }, { status: 400 });
    const guest = ensureGuest(guestId, name || "Gast", new Date().toISOString());
    const win = swipeWindow();
    return NextResponse.json({
      verdicts: getVerdictsForGuest(guestId),
      ratings: getRatingsForGuest(guestId),
      dislikes: getDislikes(guestId),
      cooked: getCookEventsForGuest(guestId),
      connections: getConnections(guestId).map((g) => ({ guestId: g.guest_id, name: g.name })),
      friendCode: guest.friend_code,
      swipeDays: { from: win.from, to: win.to, ...getSwipeDaysForGuest(guestId, win.from, win.to) },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
