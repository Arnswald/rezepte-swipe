/**
 * POST /api/verdict
 * Speichert die Bewertung eines Gasts zu einem Gericht.
 *
 * Body: { guestId, name, slug, recipeName?, category?, verdict, day?, swipedAt?, undo?, dayVerdict? }
 *
 * Normaler Swipe (verdict = like | nope | super):
 *   - Tageseintrag in swipe_days (day = Tag der App, 4:00 Berlin; fehlt er → heute laut Server)
 *   - Dauerstand in verdicts: like/super setzen, „Nö“ überschreibt kein früheres like/super
 * Undo der neuen App (undo = true):
 *   - verdicts exakt auf `verdict` (null = löschen), Tageseintrag auf `dayVerdict` (null = löschen)
 * Altes Undo (verdict = null, ohne undo): löscht verdict + heutigen Tageseintrag.
 *
 * `day` wird nur im Fenster vorgestern…morgen angenommen (verspätet nachgeschickte
 * Swipes, Uhren-Abweichung), sonst gilt der heutige Tag des Servers.
 */

import { NextResponse } from "next/server";
import {
  upsertVerdict, deleteVerdict, applySwipeVerdict, setSwipeDay, swipeWindow,
  ensureGuest, getMatchPartnersForSlug, type Verdict,
} from "@/lib/db";
import { isDayKey } from "@/lib/day";

export const dynamic = "force-dynamic";

const VALID: Verdict[] = ["like", "nope", "super"];
const asVerdict = (v: unknown): Verdict | null => (VALID.includes(v as Verdict) ? (v as Verdict) : null);

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as {
      guestId?: string; name?: string; slug?: string;
      recipeName?: string; category?: string; verdict?: string | null;
      day?: string; swipedAt?: string; undo?: boolean; dayVerdict?: string | null;
    };

    const guestId = (b.guestId ?? "").trim().slice(0, 64);
    const name = (b.name ?? "").trim().slice(0, 80);
    const slug = (b.slug ?? "").trim().slice(0, 200);
    if (!guestId || !name || !slug) {
      return NextResponse.json({ error: "guestId, name und slug sind Pflicht" }, { status: 400 });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    // Gast (mit Freundescode) anlegen/aktualisieren — so ist jede:r auffindbar zum Verbinden.
    ensureGuest(guestId, name, nowIso);

    const win = swipeWindow(now);
    const day = isDayKey(b.day) && b.day >= win.from && b.day <= win.to ? b.day : win.today;
    // Zeitpunkt des Swipes: vom Gerät (verspätet nachgeschickt), höchstens 48 h alt, nie in der Zukunft.
    const t = b.swipedAt ? Date.parse(b.swipedAt) : NaN;
    const swipedAt = Number.isFinite(t) && t <= now.getTime() && t >= now.getTime() - 48 * 3600_000 ? new Date(t).toISOString() : nowIso;
    const recipeName = (b.recipeName ?? "").slice(0, 200);
    const category = (b.category ?? "").slice(0, 60);

    // Undo der neuen App: beide Stände exakt zurücksetzen
    if (b.undo) {
      const v = asVerdict(b.verdict);
      if (v) upsertVerdict({ guestId, name, slug, recipeName, category, verdict: v, now: nowIso });
      else deleteVerdict(guestId, slug);
      setSwipeDay({ guestId, slug, day, verdict: asVerdict(b.dayVerdict), recipeName, category, swipedAt });
      return NextResponse.json({ ok: true, undone: true });
    }

    // Altes Undo (gecachte ältere App-Version) → löschen
    if (b.verdict === null || b.verdict === undefined || b.verdict === "") {
      deleteVerdict(guestId, slug);
      setSwipeDay({ guestId, slug, day, verdict: null, recipeName, category, swipedAt });
      return NextResponse.json({ ok: true, deleted: true });
    }

    const verdict = asVerdict(b.verdict);
    if (!verdict) return NextResponse.json({ error: "Ungültiges Verdict" }, { status: 400 });

    applySwipeVerdict({ guestId, name, slug, recipeName, category, verdict, now: nowIso });
    setSwipeDay({ guestId, slug, day, verdict, recipeName, category, swipedAt });

    // Bei „mögen" (rechts/hoch) prüfen, ob das ein Match mit Freund:innen ist.
    const matches = getMatchPartnersForSlug(guestId, slug, verdict);
    return NextResponse.json({ ok: true, matches, day });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
