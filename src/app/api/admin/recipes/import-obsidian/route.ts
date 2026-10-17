/**
 * POST /api/admin/recipes/import-obsidian   (Header: x-admin-pin oder x-server-key)
 * ?trocken=1 → nur zählen
 *
 * Übernimmt die Rezepte aus dem Obsidian-Mount (/app/recipes) in DATA_DIR/rezepte.db und
 * kopiert die Bilder nach DATA_DIR/bilder. Idempotent: unveränderte und in der App
 * bearbeitete Rezepte bleiben, wie sie sind; neue kommen dazu. Gibt den Bericht zurück.
 */

import { NextResponse } from "next/server";
import { join } from "path";
import { env } from "@/lib/env";
import { checkAdminOrServer } from "@/lib/guard";
import { importiereObsidian } from "@/lib/obsidianImport";
import { recipeImagesDir } from "@/lib/recipeStore";
import { invalidateRecipeCache } from "@/lib/recipes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const bad = checkAdminOrServer(req);
  if (bad) return bad;
  const trocken = new URL(req.url).searchParams.get("trocken") === "1";
  try {
    const bericht = await importiereObsidian({
      dbFile: join(env.DATA_DIR, "rezepte.db"),
      bilderDir: recipeImagesDir(),
      trocken,
    });
    invalidateRecipeCache();
    return NextResponse.json({ ok: true, trocken, bericht });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
