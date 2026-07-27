/**
 * POST /api/friends/register
 * Legt den Gast an (falls neu) und gibt seinen Freundescode zurück.
 *
 * Body: { guestId, name }  → { friendCode, name }
 *
 * guestId wird bewusst NICHT in der URL übergeben (steht im Body), weil er die
 * einzige „Zugangskennung" des Gasts ist — nicht in Logs/Query-Strings landen lassen.
 */

import { NextResponse } from "next/server";
import { ensureGuest } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { guestId?: string; name?: string };
    const guestId = (b.guestId ?? "").trim().slice(0, 64);
    const name = (b.name ?? "").trim().slice(0, 80);
    if (!guestId || !name) {
      return NextResponse.json({ error: "guestId und name sind Pflicht" }, { status: 400 });
    }
    const guest = ensureGuest(guestId, name, new Date().toISOString());
    return NextResponse.json({ friendCode: guest.friend_code, name: guest.name });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
