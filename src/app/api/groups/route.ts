/**
 * POST /api/groups   (eine Route, per `action` gesteuert)
 *
 *   { action:"overview", guestId, name? }        → { groups: GroupView[] }
 *   { action:"create",   guestId, name, groupName } → { group:{id,name,code} }
 *   { action:"join",     guestId, name, code }    → { ok, group:{id,name,code}, already } | { error }
 *   { action:"leave",    guestId, groupId }       → { ok }
 *
 * POST statt GET, damit guestId (die Zugangskennung) nicht in URL/Logs landet.
 */

import { NextResponse } from "next/server";
import {
  ensureGuest, getGroupsForGuest, createGroup, joinGroupByCode, leaveGroup,
  setEveningPick, resetEvening, getEveningPlan, type Verdict,
} from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID: Verdict[] = ["like", "nope", "super"];

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as {
      action?: string; guestId?: string; name?: string; groupName?: string; code?: string; groupId?: string;
      slug?: string; recipeName?: string; category?: string; verdict?: string | null;
    };
    const action = b.action ?? "";
    const guestId = (b.guestId ?? "").trim().slice(0, 64);
    const name = (b.name ?? "").trim().slice(0, 80);
    if (!guestId) return NextResponse.json({ error: "guestId ist Pflicht" }, { status: 400 });

    const now = new Date().toISOString();
    ensureGuest(guestId, name || "Gast", now);

    if (action === "overview") {
      return NextResponse.json({ groups: getGroupsForGuest(guestId) });
    }

    if (action === "create") {
      const groupName = (b.groupName ?? "").trim().slice(0, 60);
      if (!groupName) return NextResponse.json({ error: "Gib der Gruppe einen Namen." }, { status: 400 });
      const g = createGroup(guestId, groupName, now);
      return NextResponse.json({ group: { id: g.group_id, name: g.name, code: g.group_code } });
    }

    if (action === "join") {
      const code = (b.code ?? "").trim().slice(0, 40);
      if (!code) return NextResponse.json({ error: "Gib einen Gruppencode ein." }, { status: 400 });
      const res = joinGroupByCode(guestId, code, now);
      if (!res.ok) return NextResponse.json({ error: "Diese Gruppe gibt es nicht. Tippfehler?" }, { status: 404 });
      return NextResponse.json({ ok: true, group: { id: res.group.group_id, name: res.group.name, code: res.group.group_code }, already: res.already });
    }

    if (action === "leave") {
      const groupId = (b.groupId ?? "").trim();
      if (!groupId) return NextResponse.json({ error: "groupId fehlt" }, { status: 400 });
      return NextResponse.json({ ok: true, ...leaveGroup(guestId, groupId) });
    }

    // "Essensplan für heute Abend": eine Abend-Bewertung setzen (getrennt von Favoriten)
    if (action === "evening-pick") {
      const groupId = (b.groupId ?? "").trim();
      const slug = (b.slug ?? "").trim().slice(0, 200);
      if (!groupId || !slug) return NextResponse.json({ error: "groupId und slug sind Pflicht" }, { status: 400 });
      const verdict = (b.verdict === null || b.verdict === undefined || b.verdict === "")
        ? null
        : (VALID.includes(b.verdict as Verdict) ? (b.verdict as Verdict) : undefined);
      if (verdict === undefined) return NextResponse.json({ error: "Ungültiges Verdict" }, { status: 400 });
      setEveningPick({
        groupId, guestId, slug,
        recipeName: (b.recipeName ?? "").slice(0, 200),
        category: (b.category ?? "").slice(0, 60),
        verdict, now: new Date().toISOString(),
      });
      return NextResponse.json({ ok: true, plan: getEveningPlan(groupId) });
    }

    // Abend-Runde zurücksetzen ("Neuer Abend")
    if (action === "evening-reset") {
      const groupId = (b.groupId ?? "").trim();
      if (!groupId) return NextResponse.json({ error: "groupId fehlt" }, { status: 400 });
      return NextResponse.json({ ok: true, ...resetEvening(groupId, guestId) });
    }

    return NextResponse.json({ error: "Unbekannte action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
