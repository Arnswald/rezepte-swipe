/**
 * GET /api/admin/recipes?status=eingereicht|abgelehnt|veroeffentlicht|alle   (x-admin-pin)
 * Einreichungen fürs Admin, neueste zuerst, mit Prüfergebnis und wer eingereicht hat.
 */

import { NextResponse } from "next/server";
import { checkAdminOrServer } from "@/lib/guard";
import { recipeStore, RECIPE_STATUSES, type RecipeStatus, type StoredCheck } from "@/lib/recipeStore";
import { anzeigePhase } from "@/lib/einreichung";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const bad = checkAdminOrServer(req);
  if (bad) return bad;
  const q = new URL(req.url).searchParams.get("status") ?? "eingereicht";
  const status = q === "alle" ? "alle" : (q.split(",").filter((s) => RECIPE_STATUSES.includes(s as RecipeStatus)) as RecipeStatus[]);
  const store = recipeStore();
  const recipes = store
    .list({ status })
    .map((r) => {
      const row = store.getRow(r.slug)!;
      let pruefung: StoredCheck | null = null;
      try { pruefung = row.pruefung ? JSON.parse(row.pruefung) : null; } catch { /* alt */ }
      if (pruefung && anzeigePhase(pruefung.phase, row.erstellt_am) !== pruefung.phase) {
        pruefung = { ...pruefung, phase: "fehlgeschlagen", fehler: [...pruefung.fehler, "Auslesen hängt seit über 20 Minuten (n8n-Lauf prüfen)"] };
      }
      return {
        ...r,
        pruefung,
        herkunft: row.herkunft,
        statusGrund: row.status_grund,
        erstelltAm: row.erstellt_am,
      };
    })
    .sort((a, b) => b.erstelltAm.localeCompare(a.erstelltAm));
  return NextResponse.json({ recipes, counts: Object.fromEntries(RECIPE_STATUSES.map((s) => [s, store.count(s)])) });
}
