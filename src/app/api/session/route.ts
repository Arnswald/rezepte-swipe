/**
 * DELETE /api/session — Abmelden: Sitzung serverseitig beenden, Cookie löschen.
 * (Das Cookie ist httpOnly, die Seite kann es nicht selbst entfernen.)
 */

import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/db";
import { tokenFromRequest, clearSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  const t = tokenFromRequest(req);
  if (t) deleteSession(t);
  return clearSession(NextResponse.json({ ok: true }));
}
