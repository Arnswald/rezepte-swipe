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
import { attachSession, clearSession, resolveGuestId, sessionGuest } from "@/lib/session";
import { blocked, fail, succeed, LIMITS } from "@/lib/guard";
import { ensureGuest, createSession, deleteOwnAccount, hasAccount, checkPasswordForGuest, getVerdictsForGuest, getRatingsForGuest, getDislikes, getCookEventsForGuest, getConnections, getSwipeDaysForGuest, swipeWindow } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { guestId?: string; name?: string };
    const guestId = resolveGuestId(req, b.guestId);
    const name = (b.name ?? "").trim().slice(0, 80);
    if (!guestId) return NextResponse.json({ error: "guestId fehlt" }, { status: 400 });
    const guest = ensureGuest(guestId, name || "Gast", new Date().toISOString());
    const win = swipeWindow();
    // Sanfte Migration: Gerät ohne Sitzung (nur guestId) bekommt jetzt ein Token.
    const hadSession = !!sessionGuest(req);
    const fresh = hadSession ? null : createSession(guestId).token;
    const res = NextResponse.json({
      verdicts: getVerdictsForGuest(guestId),
      ratings: getRatingsForGuest(guestId),
      dislikes: getDislikes(guestId),
      cooked: getCookEventsForGuest(guestId),
      connections: getConnections(guestId).map((g) => ({ guestId: g.guest_id, name: g.name })),
      friendCode: guest.friend_code,
      swipeDays: { from: win.from, to: win.to, ...getSwipeDaysForGuest(guestId, win.from, win.to) },
      hasAccount: hasAccount(guestId),
      ...(fresh ? { token: fresh } : {}),
    });
    return fresh ? attachSession(res, fresh) : res;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/**
 * DELETE /api/me — Konto bzw. Gast selbst löschen (App Store 5.1.1(v)).
 * Body: { guestId?, password?, confirm: true }
 * Hängt ein Account an der Identität, ist das Passwort Pflicht (Bremse wie beim Login).
 * Löscht Bewertungen, Tageseinträge, Sterne, Vorlieben, Koch-Einträge, Verbindungen,
 * Gruppen-Mitgliedschaften, Account und Sitzungen. Eingereichte Rezepte bleiben ohne Personenbezug.
 */
export async function DELETE(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { guestId?: string; password?: string; confirm?: boolean };
    if (b.confirm !== true) return NextResponse.json({ error: "Bitte das Löschen bestätigen." }, { status: 400 });
    const guestId = resolveGuestId(req, b.guestId);
    if (!guestId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    if (hasAccount(guestId)) {
      const stop = blocked(req, LIMITS.login);
      if (stop) return stop;
      if (!checkPasswordForGuest(guestId, String(b.password ?? ""))) {
        fail(req, LIMITS.login);
        return NextResponse.json({ error: "Passwort falsch." }, { status: 401 });
      }
      succeed(req, LIMITS.login);
    }
    const r = deleteOwnAccount(guestId);
    return clearSession(NextResponse.json({ ok: true, deleted: r }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
