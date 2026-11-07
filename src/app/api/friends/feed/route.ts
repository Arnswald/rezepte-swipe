/**
 * POST /api/friends/feed
 * Was die verbundenen Freund:innen zuletzt gemocht haben (Like + Superlike), neueste zuerst.
 *
 * Body: { guestId?, limit? }
 *   → { friends:[{name,friendCode}], items:[FriendFeedItem] }
 *
 * Nur verbundene Gäste (getConnections), nie fremde. Keine guestIds anderer in der Antwort.
 * POST (nicht GET), damit der guestId nicht in der URL/Logs landet.
 */

import { resolveGuestId, denyForeignGuest } from "@/lib/session";
import { NextResponse } from "next/server";
import { getConnections, getFriendsFeed } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { guestId?: string; limit?: number };
    const denied = denyForeignGuest(req, b.guestId);
    if (denied) return denied;
    const guestId = resolveGuestId(req, b.guestId);
    if (!guestId) {
      return NextResponse.json({ error: "guestId ist Pflicht" }, { status: 400 });
    }
    const limit = typeof b.limit === "number" ? Math.max(1, Math.min(100, Math.floor(b.limit))) : 50;
    const friends = getConnections(guestId).map((g) => ({ name: g.name, friendCode: g.friend_code }));
    const items = getFriendsFeed(guestId, limit);
    return NextResponse.json({ friends, items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
