/**
 * POST /api/friends/connect
 * Verbindet den Gast mit dem Inhaber eines Freundescodes.
 *
 * Body: { guestId, name, code }
 *   → { ok:true, partner:{ name }, already }  |  { error }
 */

import { NextResponse } from "next/server";
import { ensureGuest, connectByCode } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as {
      guestId?: string; name?: string; code?: string;
    };
    const guestId = (b.guestId ?? "").trim().slice(0, 64);
    const name = (b.name ?? "").trim().slice(0, 80);
    const code = (b.code ?? "").trim().slice(0, 40);
    if (!guestId || !name || !code) {
      return NextResponse.json({ error: "guestId, name und code sind Pflicht" }, { status: 400 });
    }

    const now = new Date().toISOString();
    ensureGuest(guestId, name, now); // sicherstellen, dass ich selbst existiere

    const res = connectByCode(guestId, code, now);
    if (!res.ok) {
      const msg = res.reason === "self"
        ? "Das ist dein eigener Code 🙂"
        : "Diesen Code gibt es nicht. Tippfehler?";
      return NextResponse.json({ error: msg, reason: res.reason }, { status: 404 });
    }
    return NextResponse.json({ ok: true, partner: { name: res.partner.name }, already: res.already });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
