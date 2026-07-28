/**
 * /api/admin/groups   (Header: x-admin-pin)
 *   GET    → { groups: AdminGroup[] }
 *   POST   { action:"create", name }                 → { group }
 *          { action:"addMember", groupId, guestId }  → { ok, added }
 *          { action:"removeMember", groupId, guestId}→ { ok, removed }
 *   DELETE { groupId }                               → { ok, deleted }
 *
 * Schutz wie /api/admin/stats: PIN gegen ADMIN_PIN (env). Ohne PIN → 503.
 */

import { NextResponse } from "next/server";
import {
  getAdminGroups, createGroup, addGroupMember, removeGroupMember, deleteGroup,
} from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function checkPin(req: Request): NextResponse | null {
  if (!env.ADMIN_PIN) return NextResponse.json({ error: "Admin nicht konfiguriert (ADMIN_PIN fehlt)" }, { status: 503 });
  if ((req.headers.get("x-admin-pin") ?? "") !== env.ADMIN_PIN) return NextResponse.json({ error: "Falscher PIN" }, { status: 401 });
  return null;
}

export async function GET(req: Request) {
  const bad = checkPin(req);
  if (bad) return bad;
  return NextResponse.json({ groups: getAdminGroups() });
}

export async function POST(req: Request) {
  const bad = checkPin(req);
  if (bad) return bad;
  const b = (await req.json().catch(() => ({}))) as { action?: string; name?: string; groupId?: string; guestId?: string };
  const now = new Date().toISOString();

  if (b.action === "create") {
    const name = (b.name ?? "").trim().slice(0, 60);
    if (!name) return NextResponse.json({ error: "Name fehlt" }, { status: 400 });
    const g = createGroup(null, name, now); // Admin-Gruppe ohne festen Ersteller
    return NextResponse.json({ group: { id: g.group_id, name: g.name, code: g.group_code } });
  }

  const groupId = (b.groupId ?? "").trim();
  const guestId = (b.guestId ?? "").trim();
  if (b.action === "addMember") {
    if (!groupId || !guestId) return NextResponse.json({ error: "groupId und guestId sind Pflicht" }, { status: 400 });
    return NextResponse.json({ ok: true, ...addGroupMember(groupId, guestId, now) });
  }
  if (b.action === "removeMember") {
    if (!groupId || !guestId) return NextResponse.json({ error: "groupId und guestId sind Pflicht" }, { status: 400 });
    return NextResponse.json({ ok: true, ...removeGroupMember(groupId, guestId) });
  }
  return NextResponse.json({ error: "Unbekannte action" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const bad = checkPin(req);
  if (bad) return bad;
  const b = (await req.json().catch(() => ({}))) as { groupId?: string };
  const groupId = (b.groupId ?? "").trim();
  if (!groupId) return NextResponse.json({ error: "groupId fehlt" }, { status: 400 });
  return NextResponse.json({ ok: true, deleted: deleteGroup(groupId) });
}
