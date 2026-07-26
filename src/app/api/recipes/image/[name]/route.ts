/**
 * GET /api/recipes/image/<dateiname>?w=800
 *
 * Liefert ein Rezept-Bild aus dem gemounteten Ordner — verkleinert und als WebP.
 * Die Original-PNGs sind 5-6 MB gross; für Mobile-Swiping unbrauchbar.
 * Sharp reduziert das auf ~50-150 KB.
 *
 * PERFORMANCE: Konvertierte WebPs werden auf Platte gecacht (DATA_DIR/image-cache).
 * Sharp läuft dann nur EINMAL pro (Bild, Breite) — jeder weitere Aufruf (egal von
 * welchem Gerät) liest die fertige WebP direkt von Disk. Das macht das Swipen flott.
 *
 * Sicherheit: nur Dateinamen ohne Pfad-Anteile, nur aus dem Bilder-Ordner.
 */

import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, basename } from "path";
import { imagesDir, resolveImageFile } from "@/lib/recipes";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Erlaubte Zielbreiten — verhindert Cache-Explosion durch beliebige Werte */
const ALLOWED_WIDTHS = [400, 800, 1200];

/** Persistenter Cache-Ordner im schreibbaren Daten-Volume */
const CACHE_DIR = join(env.DATA_DIR, "image-cache");

/** Cache-Dateiname: nur sichere Zeichen, plus Breite */
function cacheKey(actualName: string, width: number): string {
  const safe = actualName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${safe}.${width}.webp`;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  const { searchParams } = new URL(req.url);

  const requested = parseInt(searchParams.get("w") ?? "800");
  const width = ALLOWED_WIDTHS.includes(requested) ? requested : 800;

  // Pfad-Traversal ausschliessen: nur der reine Dateiname zählt
  const safeName = basename(decodeURIComponent(name));
  if (!safeName || safeName.startsWith(".")) {
    return NextResponse.json({ error: "Ungültiger Dateiname" }, { status: 400 });
  }

  const dir = imagesDir();
  if (!dir) {
    return NextResponse.json({ error: "Rezept-Bilderpfad nicht gesetzt" }, { status: 500 });
  }

  // Case-insensitiv auflösen (Frontmatter-Schreibweise weicht teils vom Dateinamen ab)
  const actualName = resolveImageFile(safeName);
  if (!actualName) {
    return NextResponse.json({ error: `Bild nicht gefunden: ${safeName}` }, { status: 404 });
  }
  const filePath = join(dir, actualName);
  const cachePath = join(CACHE_DIR, cacheKey(actualName, width));

  // Header, die für Cache-Hit und -Miss identisch sind
  const webpHeaders = {
    "Content-Type": "image/webp",
    // Bilder ändern sich praktisch nie → aggressiv cachen (Browser + CDN)
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  // 1) Cache-Hit? Fertige WebP direkt ausliefern (schnellster Pfad)
  try {
    const cached = await readFile(cachePath);
    return new Response(new Uint8Array(cached), { headers: { ...webpHeaders, "X-Cache": "HIT" } });
  } catch {
    // Cache-Miss → weiter unten konvertieren
  }

  try {
    const input = await readFile(filePath);

    // Sharp ist über Next.js verfügbar; falls nicht → Original ausliefern
    let body: Buffer = input;
    let contentType = safeName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    let isWebp = false;

    try {
      const sharp = (await import("sharp")).default;
      body = await sharp(input)
        .rotate()                                  // EXIF-Orientierung anwenden
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      contentType = "image/webp";
      isWebp = true;

      // 2) Cache-Miss: konvertierte WebP für alle künftigen Aufrufe speichern
      try {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(cachePath, body);
      } catch (cacheErr) {
        console.warn("[recipes/image] Cache-Schreiben fehlgeschlagen:", cacheErr);
      }
    } catch (sharpErr) {
      console.warn("[recipes/image] sharp nicht verfügbar, liefere Original:", sharpErr);
    }

    return new Response(new Uint8Array(body), {
      headers: isWebp
        ? { ...webpHeaders, "X-Cache": "MISS" }
        : {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Cache": "MISS-RAW",
          },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
