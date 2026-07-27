/**
 * POST /api/friends/matches
 * Gibt Verbindungen + Matches ("Gerichte, die ihr beide mögt") für einen Gast.
 *
 * Body: { guestId, name? }
 *   → { friendCode, connections:[{guestId,name,friendCode}], matches:[MatchGroup] }
 *
 * POST (nicht GET), damit der guestId nicht in der URL/Logs landet.
 */

import { NextResponse } from "next/server";
import { ensureGuest, getConnections, getMatches } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { guestId?: string; name?: string };
    const guestId = (b.guestId ?? "").trim().slice(0, 64);
    const name = (b.name ?? "").trim().slice(0, 80);
    if (!guestId) {
      return NextResponse.json({ error: "guestId ist Pflicht" }, { status: 400 });
    }

    const guest = ensureGuest(guestId, name || "Gast", new Date().toISOString());
    const connections = getConnections(guestId).map((g) => ({
      guestId: g.guest_id, name: g.name, friendCode: g.friend_code,
    }));
    const matches = getMatches(guestId);

    return NextResponse.json({ friendCode: guest.friend_code, connections, matches });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
