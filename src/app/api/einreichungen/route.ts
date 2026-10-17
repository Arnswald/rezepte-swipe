/**
 * POST /api/einreichungen   Body { guestId }
 * Die eigenen Einreichungen eines Gasts (Profil „Meine Einreichungen“): Status, Phase
 * (wird ausgelesen · wartet auf Freigabe · abgelehnt · veröffentlicht) und das Rezept selbst,
 * damit es sich schon vor der Freigabe öffnen lässt. Nur mit RECIPE_SOURCE=db, sonst leer.
 */

import { NextResponse } from "next/server";
import { RECIPE_SOURCE, publicRecipe } from "@/lib/recipes";
import { recipeStore, type StoredCheck } from "@/lib/recipeStore";
import { anzeigePhase } from "@/lib/einreichung";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { guestId?: string };
  const guestId = (b.guestId ?? "").trim().slice(0, 64);
  if (!guestId) return NextResponse.json({ error: "guestId fehlt" }, { status: 400 });
  if (RECIPE_SOURCE !== "db") return NextResponse.json({ einreichungen: [] });
  const store = recipeStore();
  const rows = store.db
    .prepare(`SELECT slug, status, status_grund, pruefung, erstellt_am FROM recipes WHERE eingereicht_von = ? ORDER BY erstellt_am DESC LIMIT 30`)
    .all(guestId) as { slug: string; status: string; status_grund: string | null; pruefung: string | null; erstellt_am: string }[];
  const einreichungen = rows.map((row) => {
    let phase: StoredCheck["phase"] = "fertig";
    try { phase = (row.pruefung ? (JSON.parse(row.pruefung) as StoredCheck).phase : undefined) ?? "fertig"; } catch { /* alt */ }
    const r = store.get(row.slug, { status: "alle" });
    return {
      slug: row.slug,
      status: row.status,
      phase: anzeigePhase(phase, row.erstellt_am),
      grund: row.status === "abgelehnt" ? row.status_grund : null,
      erstelltAm: row.erstellt_am,
      recipe: r ? publicRecipe(r) : null,
    };
  });
  return NextResponse.json({ einreichungen });
}
