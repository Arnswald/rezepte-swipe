/**
 * /api/admin/connections   (Header: x-admin-pin)
 *   POST   { a, b }  → verbindet zwei Personen (per guestId)
 *   DELETE { a, b }  → trennt die Verbindung
 *
 * Schutz wie /api/admin/stats: PIN gegen ADMIN_PIN (env). Ohne PIN → 503.
 */

import { NextResponse } from "next/server";
import { adminConnect, adminDisconnect } from "@/lib/db";
import { checkAdminPin } from "@/lib/guard";

export const dynamic = "force-dynamic";

const checkPin = checkAdminPin;

async function readPair(req: Request): Promise<{ a: string; b: string } | null> {
  const body = (await req.json().catch(() => ({}))) as { a?: string; b?: string };
  const a = (body.a ?? "").trim();
  const b = (body.b ?? "").trim();
  if (!a || !b) return null;
  return { a, b };
}

export async function POST(req: Request) {
  const bad = checkPin(req);
  if (bad) return bad;
  const p = await readPair(req);
  if (!p) return NextResponse.json({ error: "a und b sind Pflicht" }, { status: 400 });
  const res = adminConnect(p.a, p.b, new Date().toISOString());
  if (!res.ok) return NextResponse.json({ error: "Das ist dieselbe Person." }, { status: 400 });
  return NextResponse.json({ ok: true, already: res.already });
}

export async function DELETE(req: Request) {
  const bad = checkPin(req);
  if (bad) return bad;
  const p = await readPair(req);
  if (!p) return NextResponse.json({ error: "a und b sind Pflicht" }, { status: 400 });
  return NextResponse.json({ ok: true, ...adminDisconnect(p.a, p.b) });
}
