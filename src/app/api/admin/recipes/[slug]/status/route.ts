/**
 * POST /api/admin/recipes/<slug>/status   (x-admin-pin) — der eine Tipp im Admin
 * Body { status: "veroeffentlicht" | "abgelehnt" | "eingereicht", grund?: string }
 */

import { NextResponse } from "next/server";
import { checkAdminOrServer } from "@/lib/guard";
import { recipeStore, RECIPE_STATUSES, type RecipeStatus } from "@/lib/recipeStore";
import { invalidateRecipeCache } from "@/lib/recipes";
import { PLATZHALTER } from "@/lib/einreichung";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const bad = checkAdminOrServer(req);
  if (bad) return bad;
  const { slug } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { status?: string; grund?: string };
  if (!RECIPE_STATUSES.includes(b.status as RecipeStatus)) return NextResponse.json({ error: "status_unbekannt" }, { status: 400 });
  const store = recipeStore();
  const row = store.getRow(slug);
  if (!row) return NextResponse.json({ error: "nicht_gefunden" }, { status: 404 });
  if (b.status === "veroeffentlicht" && row.slug.startsWith(PLATZHALTER)) {
    return NextResponse.json({ error: "noch_nicht_ausgelesen" }, { status: 409 });
  }
  const recipe = store.setStatus(slug, b.status as RecipeStatus, { reason: b.grund?.slice(0, 300) ?? null });
  invalidateRecipeCache();
  return NextResponse.json({ ok: true, recipe });
}
