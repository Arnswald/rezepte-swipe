/**
 * GET /api/admin/bild/<datei>   (x-server-key) — Originalbild aus DATA_DIR/bilder,
 * unverändert. Für die Obsidian-Kopie und die Bilder-Sicherung des Mac-Runners.
 */

import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { basename, join } from "path";
import { checkAdminOrServer } from "@/lib/guard";
import { recipeImagesDir } from "@/lib/recipeStore";

export const dynamic = "force-dynamic";

const TYP: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function GET(req: Request, ctx: { params: Promise<{ datei: string }> }) {
  const bad = checkAdminOrServer(req);
  if (bad) return bad;
  const datei = basename(decodeURIComponent((await ctx.params).datei));
  const ext = datei.split(".").pop()?.toLowerCase() ?? "";
  if (!TYP[ext] || datei.startsWith(".")) return NextResponse.json({ error: "ungueltig" }, { status: 400 });
  try {
    const buf = await readFile(join(recipeImagesDir(), datei));
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": TYP[ext], "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "nicht_gefunden" }, { status: 404 });
  }
}
