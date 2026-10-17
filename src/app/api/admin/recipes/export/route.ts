/**
 * GET /api/admin/recipes/export?seit=<ISO>   (x-server-key, Mac-Runner)
 * Veröffentlichte Rezepte, die nicht aus Obsidian stammen und seit `seit` geändert wurden,
 * als Kochbuch-Markdown. Der Mac schreibt sie nach 06 Research/Gerichte (Kopie, die App
 * bleibt führend). Bilder einzeln über /api/admin/bild/<datei>.
 * 200 { jetzt, rezepte: [{ slug, geaendertAm, markdown, bilder: [{ datei, rolle, sha1 }] }] }
 */

import { NextResponse } from "next/server";
import { checkAdminOrServer } from "@/lib/guard";
import { recipeStore } from "@/lib/recipeStore";
import { recipeMarkdown } from "@/lib/recipeMarkdown";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const bad = checkAdminOrServer(req);
  if (bad) return bad;
  const seit = new URL(req.url).searchParams.get("seit") ?? "";
  const jetzt = new Date().toISOString();
  const store = recipeStore();
  const zeilen = store.db
    .prepare(`SELECT * FROM recipes WHERE status = 'veroeffentlicht' AND herkunft != 'obsidian' AND geaendert_am > ? ORDER BY geaendert_am`)
    .all(seit) as { id: number; slug: string; geaendert_am: string; eingereicht_name: string | null }[];
  const rezepte = zeilen.map((z) => {
    const r = store.get(z.slug, { status: "alle" })!;
    const bilder = store.images(z.id);
    const titel = bilder.find((b) => b.rolle === "titel")?.datei ?? null;
    return {
      slug: z.slug,
      geaendertAm: z.geaendert_am,
      markdown: recipeMarkdown(r, { titelbild: titel, eingereichtVon: z.eingereicht_name }),
      bilder: bilder.map((b) => ({ datei: b.datei, rolle: b.rolle, sha1: b.sha1 })),
    };
  });
  return NextResponse.json({ jetzt, rezepte });
}
