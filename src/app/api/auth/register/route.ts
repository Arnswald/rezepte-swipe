/**
 * POST /api/auth/register
 * Legt einen Account an (Benutzername + Passwort). Wird `guestId` mitgeschickt
 * (bestehende anonyme Identität), übernimmt der Account deren Likes/Gruppen.
 *
 * Body: { username, password, guestId? }
 *   → { guestId, name, verdicts } | { error }
 */

import { NextResponse } from "next/server";
import { registerAccount, getVerdictsForGuest } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { username?: string; password?: string; guestId?: string };
    const username = (b.username ?? "").trim().slice(0, 40);
    const password = String(b.password ?? "");
    const guestId = (b.guestId ?? "").trim().slice(0, 64) || null;
    if (!username || !password) {
      return NextResponse.json({ error: "Benutzername und Passwort sind Pflicht." }, { status: 400 });
    }
    const res = registerAccount(username, password, guestId, new Date().toISOString());
    if (!res.ok) {
      if (res.reason === "taken") return NextResponse.json({ error: "Diesen Benutzernamen gibt es schon." }, { status: 409 });
      return NextResponse.json({ error: "Benutzername min. 2, Passwort min. 4 Zeichen." }, { status: 400 });
    }
    return NextResponse.json({ guestId: res.guestId, name: res.name, verdicts: getVerdictsForGuest(res.guestId) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
