/**
 * GET /api/admin/backup   (x-server-key, Mac-Runner nachts)
 * Konsistente Kopie von DATA_DIR/rezepte.db (better-sqlite3 backup), gzip.
 */

import { NextResponse } from "next/server";
import { gzipSync } from "zlib";
import { readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { checkAdminOrServer } from "@/lib/guard";
import { recipeStore } from "@/lib/recipeStore";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const bad = checkAdminOrServer(req);
  if (bad) return bad;
  const ziel = join(tmpdir(), `rezepte-backup-${Date.now()}.db`);
  try {
    await recipeStore().db.backup(ziel);
    const gz = gzipSync(readFileSync(ziel));
    return new Response(new Uint8Array(gz), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="rezepte-${new Date().toISOString().slice(0, 10)}.db.gz"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  } finally {
    rmSync(ziel, { force: true });
  }
}
