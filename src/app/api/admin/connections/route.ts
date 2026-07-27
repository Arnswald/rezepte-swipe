/**
 * /api/admin/connections   (Header: x-admin-pin)
 *   POST   { a, b }  → verbindet zwei Personen (per guestId)
 *   DELETE { a, b }  → trennt die Verbindung
 *
 * Schutz wie /api/admin/stats: PIN gegen ADMIN_PIN (env). Ohne PIN → 503.
 */

import { NextResponse } from "next/server";
import { adminConnect, adminDisconnect } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function checkPin(req: Request): NextResponse | null {
  if (!env.ADMIN_PIN) {
    return NextResponse.json({ error: "Admin nicht konfiguriert (ADMIN_PIN fehlt)" }, { status: 503 });
  }
  if ((req.headers.get("x-admin-pin") ?? "") !== env.ADMIN_PIN) {
    return NextResponse.json({ error: "Falscher PIN" }, { status: 401 });
  }
  return null;
}

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
