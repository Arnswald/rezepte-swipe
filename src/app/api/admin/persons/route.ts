/**
 * /api/admin/persons   (Header: x-admin-pin)
 *   GET    → { persons: AdminPerson[] }         alle Personen (mit Code, Counts, Verbindungen)
 *   DELETE → { guestId }  löscht Person kaskadierend (Verdicts + Verbindungen + Gast)
 *
 * Schutz wie /api/admin/stats: PIN gegen ADMIN_PIN (env). Ohne PIN → 503.
 */

import { NextResponse } from "next/server";
import { getAdminPersons, deleteGuestCascade } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Prüft den Admin-PIN. Gibt eine Fehlerantwort zurück, oder null wenn ok. */
function checkPin(req: Request): NextResponse | null {
  if (!env.ADMIN_PIN) {
    return NextResponse.json({ error: "Admin nicht konfiguriert (ADMIN_PIN fehlt)" }, { status: 503 });
  }
  if ((req.headers.get("x-admin-pin") ?? "") !== env.ADMIN_PIN) {
    return NextResponse.json({ error: "Falscher PIN" }, { status: 401 });
  }
  return null;
}

export async function GET(req: Request) {
  const bad = checkPin(req);
  if (bad) return bad;
  return NextResponse.json({ persons: getAdminPersons() });
}

export async function DELETE(req: Request) {
  const bad = checkPin(req);
  if (bad) return bad;
  const b = (await req.json().catch(() => ({}))) as { guestId?: string };
  const guestId = (b.guestId ?? "").trim();
  if (!guestId) {
    return NextResponse.json({ error: "guestId fehlt" }, { status: 400 });
  }
  const deleted = deleteGuestCascade(guestId);
  return NextResponse.json({ ok: true, deleted });
}
