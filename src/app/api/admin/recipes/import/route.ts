/**
 * POST /api/admin/recipes/import   (Header: x-server-key, n8n)
 * n8n (WF10b Link, WF14 Formular/Sprache) liefert ein ausgelesenes Rezept, am liebsten als
 * Kochbuch-Markdown. Vertrag: ImportAnfrage in lib/einreichung.ts.
 * 200 { ok, slug, status, pruefung, adminUrl, telegramText } · 409 schon_da · 404 einreichung_unbekannt
 */

import { NextResponse } from "next/server";
import { checkAdminOrServer } from "@/lib/guard";
import { uebernehmen, type ImportAnfrage } from "@/lib/einreichung";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const bad = checkAdminOrServer(req);
  if (bad) return bad;
  const body = (await req.json().catch(() => null)) as ImportAnfrage | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "json_fehlt" }, { status: 400 });
  try {
    const r = await uebernehmen(body);
    return NextResponse.json(r.body, { status: r.status });
  } catch (err) {
    console.error("[import]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
