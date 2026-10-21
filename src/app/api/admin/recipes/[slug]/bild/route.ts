/**
 * POST /api/admin/recipes/<slug>/bild   (x-server-key / x-admin-pin)
 * Body { base64, rolle: "ki" | "galerie" | "selbst", alsKarte?: boolean, zusatz?: string, herkunft?: string }
 * Hängt ein Bild an ein Rezept (KI-Kartenbild, Szenen aus dem Video, eigenes Foto).
 * alsKarte: das Bild wird Kartenbild (Karte, Raster, Detail-Kopf).
 *
 * DELETE /api/admin/recipes/<slug>/bild?datei=<name>
 * Nimmt ein Bild aus dem Rezept. Die Datei wird nicht gelöscht, sondern nach
 * DATA_DIR/bilder/_entfernt verschoben (zurückholbar). Das Kartenbild lässt sich so nicht entfernen.
 */

import { NextResponse } from "next/server";
import { checkAdminOrServer } from "@/lib/guard";
import { recipeStore, type ImageRole } from "@/lib/recipeStore";
import { invalidateRecipeCache } from "@/lib/recipes";
import { bildSpeichern } from "@/lib/einreichung";
import { existsSync, mkdirSync, renameSync } from "fs";
import { basename, join } from "path";
import { recipeImagesDir } from "@/lib/recipeStore";

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

export async function DELETE(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const bad = checkAdminOrServer(req);
  if (bad) return bad;
  const { slug } = await ctx.params;
  const datei = basename(new URL(req.url).searchParams.get("datei") ?? "");
  const store = recipeStore();
  const row = store.getRow(slug);
  if (!row || !datei) return NextResponse.json({ error: "nicht_gefunden" }, { status: 404 });
  if ((row.kartenbild ?? "").toLowerCase() === datei.toLowerCase()) return NextResponse.json({ error: "ist_kartenbild" }, { status: 409 });
  const info = store.db.prepare(`DELETE FROM recipe_images WHERE recipe_id = ? AND lower(datei) = lower(?)`).run(row.id, datei);
  if (info.changes === 0) return NextResponse.json({ error: "bild_nicht_am_rezept" }, { status: 404 });
  const dir = recipeImagesDir();
  if (existsSync(join(dir, datei))) {
    mkdirSync(join(dir, "_entfernt"), { recursive: true });
    renameSync(join(dir, datei), join(dir, "_entfernt", datei));
  }
  invalidateRecipeCache();
  return NextResponse.json({ ok: true, entfernt: datei, recipe: store.get(slug, { status: "alle" }) });
}
