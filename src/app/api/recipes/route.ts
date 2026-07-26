/**
 * GET /api/recipes            → alle Rezepte (inkl. Diagnose)
 * GET /api/recipes?diag=1     → nur Diagnose (Pfad-Check, schnell)
 */

import { NextResponse } from "next/server";
import { scanRecipes, recipesDiagnostics } from "@/lib/recipes";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const diag = recipesDiagnostics();

  if (searchParams.get("diag") === "1") {
    return NextResponse.json({ diagnostics: diag });
  }

  try {
    const recipes = scanRecipes();
    const categories = [...new Set(recipes.map((r) => r.category))].sort();
    return NextResponse.json({ recipes, categories, diagnostics: diag });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), diagnostics: diag },
      { status: 500 },
    );
  }
}
