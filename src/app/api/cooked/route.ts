/**
 * POST /api/cooked
 * Koch-Verlauf: "bereits gekocht" festhalten (optional MIT wem + Datum).
 *
 * Body (action=add):    { guestId, name, slug, recipeName?, category?, partnerGuest?|null, cookedOn? }
 * Body (action=remove): { guestId, name, id }
 * Antwort: { ok, cooked }  — der komplette Koch-Verlauf des Gasts (neu geladen).
 */

import { NextResponse } from "next/server";
import { ensureGuest, addCookEvent, deleteCookEvent, getCookEventsForGuest } from "@/lib/db";

export const dynamic = "force-dynamic";

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as {
      guestId?: string; name?: string; action?: string;
      slug?: string; recipeName?: string; category?: string;
      partnerGuest?: string | null; cookedOn?: string; id?: number;
    };
    const guestId = (b.guestId ?? "").trim().slice(0, 64);
    const name = (b.name ?? "").trim().slice(0, 80);
    if (!guestId) return NextResponse.json({ error: "guestId fehlt" }, { status: 400 });
    ensureGuest(guestId, name || "Gast", new Date().toISOString());

    if (b.action === "remove") {
      if (!b.id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });
      deleteCookEvent(Number(b.id), guestId);
      return NextResponse.json({ ok: true, cooked: getCookEventsForGuest(guestId) });
    }

    // action=add (default)
    const slug = (b.slug ?? "").trim().slice(0, 200);
    if (!slug) return NextResponse.json({ error: "slug fehlt" }, { status: 400 });
    const today = new Date().toISOString().slice(0, 10);
    const cookedOn = b.cookedOn && isDate(b.cookedOn) ? b.cookedOn : today;
    const partnerGuest = b.partnerGuest ? String(b.partnerGuest).trim().slice(0, 64) : null;
    if (partnerGuest === guestId) {
      return NextResponse.json({ error: "Partner darf nicht man selbst sein" }, { status: 400 });
    }

    addCookEvent({
      authorGuest: guestId,
      slug,
      recipeName: (b.recipeName ?? "").slice(0, 200),
      category: (b.category ?? "").slice(0, 60),
      partnerGuest,
      cookedOn,
      now: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, cooked: getCookEventsForGuest(guestId) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
