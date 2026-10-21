/**
 * POST /api/admin/recipes/<slug>/bild   (x-server-key / x-admin-pin)
 * Body { base64, rolle: "ki" | "galerie" | "selbst", alsKarte?: boolean, zusatz?: string, herkunft?: string }
 * Hängt ein Bild an ein Rezept (KI-Kartenbild, Szenen aus dem Video, eigenes Foto).
 * alsKarte: das Bild wird Kartenbild (Karte, Raster, Detail-Kopf).
 */

import { NextResponse } from "next/server";
import { checkAdminOrServer } from "@/lib/guard";
import { recipeStore, type ImageRole } from "@/lib/recipeStore";
import { invalidateRecipeCache } from "@/lib/recipes";
import { bildSpeichern } from "@/lib/einreichung";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROLLEN: ImageRole[] = ["ki", "galerie", "selbst"];

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const bad = checkAdminOrServer(req);
  if (bad) return bad;
  const { slug } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { base64?: string; rolle?: string; alsKarte?: boolean; zusatz?: string; herkunft?: string };
  const rolle = (ROLLEN.includes(b.rolle as ImageRole) ? b.rolle : "galerie") as ImageRole;
  if (!b.base64) return NextResponse.json({ error: "base64_fehlt" }, { status: 400 });
  const store = recipeStore();
  if (!store.getRow(slug)) return NextResponse.json({ error: "nicht_gefunden" }, { status: 404 });
  const buf = Buffer.from(b.base64.replace(/^data:[^,]+,/, ""), "base64");
  if (buf.length === 0 || buf.length > 20 * 1024 * 1024) return NextResponse.json({ error: "bild_ungueltig" }, { status: 400 });
  const zusatz = b.zusatz && /^[a-z0-9-]{1,30}$/i.test(b.zusatz) ? b.zusatz : undefined;
  const img = await bildSpeichern(slug, buf, { ki: rolle === "ki", zusatz, herkunftUrl: b.herkunft ?? null });
  const row = store.addImage(slug, { ...img, rolle });
  if (b.alsKarte) store.update(slug, { cardImage: img.datei });
  invalidateRecipeCache();
  return NextResponse.json({ ok: true, datei: img.datei, bild: row, recipe: store.get(slug, { status: "alle" }) });
}
