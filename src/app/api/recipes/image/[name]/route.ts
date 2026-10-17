/**
 * GET /api/recipes/image/<dateiname>?w=720&ar=4x5&fmt=avif&v=2[&f=50-70]
 *
 * Liefert ein Rezept-Bild aus dem gemounteten Ordner — verkleinert, optional auf ein
 * Seitenverhältnis zugeschnitten und als AVIF/WebP/JPEG.
 *
 *  w    Zielbreite (feste Liste, gegen Cache-Explosion)
 *  ar   Zuschnitt: 4x5 (Swipe-Karte), 8x7 (Raster), 1x1 (Mini-Vorschau), 3x2 (Favoriten,
 *       „Für dich“), 16x10 (Detail, Teilen-Seite, WhatsApp-Vorschau). Geschnitten wird um
 *       den Bildfokus (lib/imageFocus.ts), nicht stur um die Mitte.
 *  fmt  avif | webp | jpg — explizit in der URL statt per Accept-Header, weil Cloudflare
 *       die Bilder nach URL cacht und „Vary: Accept“ nicht beachtet.
 *  f    nur bei Titelbildern mit `bildfokus` im Frontmatter: der gesetzte Fokus. Ändert
 *       Christian ihn, ändert sich die URL → Browser und Cloudflare holen neu.
 *
 * Ohne ar/fmt (alte URLs `?w=800`) läuft alles wie vorher: WebP q78, nur verkleinert,
 * gleicher Cache-Schlüssel — die bestehenden Dateien im Cache bleiben gültig.
 *
 * PERFORMANCE: Ergebnisse liegen in DATA_DIR/image-cache. Neue Varianten haben einen
 * eigenen, versionierten Schlüssel (`.v2.` + Zuschnitt + Fokus); alte Dateien bleiben liegen.
 *
 * Sicherheit: nur Dateinamen ohne Pfad-Anteile, nur aus dem Bilder-Ordner.
 */

import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, basename } from "path";
import { createHash } from "crypto";
import { imagesDir, resolveImageFile, focusOverrideFor } from "@/lib/recipes";
import { getFocus, type Focus } from "@/lib/imageFocus";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Erlaubte Zielbreiten — verhindert Cache-Explosion durch beliebige Werte */
const ALLOWED_WIDTHS = [160, 320, 400, 480, 720, 800, 1080, 1200];
/** Erlaubte Zuschnitte (Breite / Höhe) */
const ASPECTS: Record<string, number> = { "4x5": 4 / 5, "8x7": 8 / 7, "1x1": 1, "3x2": 3 / 2, "16x10": 16 / 10 };
const FORMATS = {
  avif: "image/avif",
  webp: "image/webp",
  jpg: "image/jpeg",
} as const;
type Fmt = keyof typeof FORMATS;

/** Persistenter Cache-Ordner im schreibbaren Daten-Volume */
const CACHE_DIR = join(env.DATA_DIR, "image-cache");

const IMMUTABLE = "public, max-age=31536000, immutable";
/** Für Anfragen, deren URL nicht zum aktuellen Fokus passt (veralteter Client):
 *  kurz cachen, damit Cloudflare nicht ein Jahr lang den falschen Ausschnitt hält. */
const SHORT = "public, max-age=600";

/** Cache-Dateiname: lesbarer Teil plus Hash des echten Namens. Nur die Ersetzung
 *  reichte nicht, „Käse.png" und „Köse.png" landeten beide auf „K_se.png". */
function cacheKey(actualName: string, width: number, variant?: string): string {
  const safe = actualName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const hash = createHash("sha1").update(actualName).digest("hex").slice(0, 8);
  // Alte Form (nur verkleinert, WebP) unverändert lassen → bestehender Cache bleibt gültig
  if (!variant) return `${safe}.${hash}.${width}.webp`;
  return `${safe}.${hash}.v2.${variant}`;
}

/** Zuschnitt-Rechteck um den Fokus, im Bild geklemmt */
function cropRect(W: number, H: number, ratio: number, [fx, fy]: Focus) {
  if (W / H > ratio) {
    const cw = Math.max(1, Math.round(H * ratio));
    const left = Math.min(Math.max(Math.round((fx / 100) * W - cw / 2), 0), W - cw);
    return { left, top: 0, width: cw, height: H };
  }
  const ch = Math.max(1, Math.round(W / ratio));
  const top = Math.min(Math.max(Math.round((fy / 100) * H - ch / 2), 0), H - ch);
  return { left: 0, top, width: W, height: ch };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  const { searchParams } = new URL(req.url);

  const requested = parseInt(searchParams.get("w") ?? "800");
  const width = ALLOWED_WIDTHS.includes(requested) ? requested : 800;
  const arKey = searchParams.get("ar") ?? "";
  const ratio = ASPECTS[arKey] ?? null;
  const fmtParam = searchParams.get("fmt") ?? "";
  const fmt: Fmt | null = fmtParam in FORMATS ? (fmtParam as Fmt) : null;
  const legacy = !ratio && !fmt;

  // Pfad-Traversal ausschliessen: nur der reine Dateiname zählt
  // Next liefert den Parameter schon dekodiert; ein zweites decodeURIComponent
  // warf bei „%" im Dateinamen einen URIError (unbehandelter 500).
  const safeName = basename(name);
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

  // Fokus nur nötig, wenn zugeschnitten wird. Übersteuerung aus dem Frontmatter gewinnt.
  let focus: Focus = [50, 50];
  let cacheControl = IMMUTABLE;
  if (ratio) {
    const override = focusOverrideFor(actualName);
    focus = override ?? (await getFocus(dir, actualName));
    const expected = override ? `${override[0]}-${override[1]}` : null;
    if (searchParams.get("f") !== expected) cacheControl = SHORT;
  }

  const outFmt: Fmt = fmt ?? "webp";
  // Schlüssel enthält Zuschnitt + tatsächlich benutzten Fokus → immer eindeutig
  const variant = legacy ? undefined : `${arKey || "orig"}.${focus[0]}-${focus[1]}.${width}.${outFmt}`;
  const cachePath = join(CACHE_DIR, cacheKey(actualName, width, variant));
  const headers = { "Content-Type": FORMATS[outFmt], "Cache-Control": cacheControl };

  // 1) Cache-Hit? Fertige Datei direkt ausliefern (schnellster Pfad)
  try {
    const cached = await readFile(cachePath);
    return new Response(new Uint8Array(cached), { headers: { ...headers, "X-Cache": "HIT" } });
  } catch {
    // Cache-Miss → weiter unten konvertieren
  }

  try {
    const input = await readFile(filePath);
    let body: Buffer;
    try {
      const sharp = (await import("sharp")).default;
      let pipeline;
      if (ratio) {
        // Erst drehen + auf handliche Größe (Originale bis 8064 px), roh weiterreichen,
        // dann um den Fokus zuschneiden und auf die Zielbreite bringen.
        const { data, info } = await sharp(input, { failOn: "none" })
          .rotate()
          .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
          .raw()
          .toBuffer({ resolveWithObject: true });
        const rect = cropRect(info.width, info.height, ratio, focus);
        pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
          .extract(rect)
          .resize({ width: Math.min(width, rect.width) });
      } else {
        pipeline = sharp(input, { failOn: "none" })
          .rotate()                                  // EXIF-Orientierung anwenden
          .resize({ width, withoutEnlargement: true });
      }
      if (legacy) pipeline = pipeline.webp({ quality: 78 });
      // AVIF q50 / effort 2: ~35 % kleiner als WebP q78 und schneller kodiert (gemessen 17.10.2026)
      else if (outFmt === "avif") pipeline = pipeline.avif({ quality: 50, effort: 2 });
      else if (outFmt === "jpg") pipeline = pipeline.jpeg({ quality: 80, mozjpeg: true });
      else pipeline = pipeline.webp({ quality: 75 });
      body = await pipeline.toBuffer();

      // 2) Cache-Miss: Ergebnis für alle künftigen Aufrufe speichern
      try {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(cachePath, body);
      } catch (cacheErr) {
        console.warn("[recipes/image] Cache-Schreiben fehlgeschlagen:", cacheErr);
      }
    } catch (sharpErr) {
      console.warn("[recipes/image] sharp nicht verfügbar, liefere Original:", sharpErr);
      const type = safeName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      return new Response(new Uint8Array(input), {
        headers: { "Content-Type": type, "Cache-Control": SHORT, "X-Cache": "MISS-RAW" },
      });
    }

    return new Response(new Uint8Array(body), { headers: { ...headers, "X-Cache": "MISS" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
