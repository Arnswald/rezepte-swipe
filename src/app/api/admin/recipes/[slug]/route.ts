/**
 * PATCH /api/admin/recipes/<slug>   (x-admin-pin) — Korrekturen vor der Freigabe
 * Body: Felder wie im Recipe-Typ (name, description, category, kcal, protein, carbs, fat,
 * totalTime, portions, difficulty, ingredients, steps, tips, imageFocus).
 */

import { NextResponse } from "next/server";
import { checkAdminOrServer } from "@/lib/guard";
import { recipeStore, type RecipeInput } from "@/lib/recipeStore";
import { invalidateRecipeCache } from "@/lib/recipes";

export const dynamic = "force-dynamic";

const ERLAUBT = ["name", "description", "category", "kcal", "protein", "carbs", "fat", "totalTime", "portions", "difficulty", "ingredients", "steps", "tips", "imageFocus", "cardImage"] as const;

export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const bad = checkAdminOrServer(req);
  if (bad) return bad;
  const { slug } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ERLAUBT) if (k in b) patch[k] = b[k];
  const recipe = recipeStore().update(slug, patch as Partial<RecipeInput>);
  if (!recipe) return NextResponse.json({ error: "nicht_gefunden" }, { status: 404 });
  invalidateRecipeCache();
  return NextResponse.json({ ok: true, recipe });
}
