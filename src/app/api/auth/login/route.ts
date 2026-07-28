/**
 * POST /api/auth/login
 * Meldet einen Account an (Benutzername + Passwort) und gibt Identität + Bewertungen
 * zurück, damit die App auf jedem Gerät den kompletten Stand herstellen kann.
 *
 * Body: { username, password }
 *   → { guestId, name, verdicts } | { error }
 */

import { NextResponse } from "next/server";
import { loginAccount, getVerdictsForGuest } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
    const username = (b.username ?? "").trim();
    const password = String(b.password ?? "");
    if (!username || !password) {
      return NextResponse.json({ error: "Benutzername und Passwort eingeben." }, { status: 400 });
    }
    const res = loginAccount(username, password);
    if (!res.ok) {
      return NextResponse.json({ error: "Benutzername oder Passwort falsch." }, { status: 401 });
    }
    return NextResponse.json({ guestId: res.guestId, name: res.name, verdicts: getVerdictsForGuest(res.guestId) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
