/**
 * SQLite-Speicher für Gäste-Verdicts (wer mag welches Gericht).
 *
 * Liegt im schreibbaren DATA_DIR-Volume neben dem Bild-Cache. Kein ORM —
 * better-sqlite3 direkt, synchron. Eine Zeile pro (guest_id, slug); ein erneutes
 * Wischen aktualisiert die Zeile (upsert), Undo löscht sie.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { env } from "@/lib/env";

export type Verdict = "like" | "nope" | "super";

export interface VerdictRow {
  guest_id: string;
  name: string;
  slug: string;
  recipe_name: string;
  category: string;
  verdict: Verdict;
  updated_at: string;
}

// LAZY-Singleton: die DB wird NICHT beim Import geöffnet, sondern erst beim
// ersten echten Aufruf zur Laufzeit. Wichtig: Beim `next build` importieren
// mehrere Worker die Route-Module parallel — würde die DB hier beim Import
// geöffnet, gäbe es „database is locked". Deshalb strikt lazy.
const globalForDb = globalThis as unknown as { rezepteDb?: Database.Database };

function getDb(): Database.Database {
  if (globalForDb.rezepteDb) return globalForDb.rezepteDb;
  const dir = env.DATA_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const database = new Database(join(dir, "rezepte.db"));
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS verdicts (
      guest_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL,
      recipe_name TEXT NOT NULL DEFAULT '',
      category    TEXT NOT NULL DEFAULT '',
      verdict     TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (guest_id, slug)
    );
    CREATE INDEX IF NOT EXISTS idx_verdicts_slug ON verdicts(slug);
    CREATE INDEX IF NOT EXISTS idx_verdicts_name ON verdicts(name);
  `);
  globalForDb.rezepteDb = database;
  return database;
}

/** Setzt/aktualisiert ein Verdict (upsert). now = ISO-Timestamp (Route liefert ihn). */
export function upsertVerdict(v: {
  guestId: string; name: string; slug: string; recipeName: string; category: string; verdict: Verdict; now: string;
}) {
  getDb().prepare(`
    INSERT INTO verdicts (guest_id, name, slug, recipe_name, category, verdict, updated_at)
    VALUES (@guestId, @name, @slug, @recipeName, @category, @verdict, @now)
    ON CONFLICT(guest_id, slug) DO UPDATE SET
      name = @name, recipe_name = @recipeName, category = @category,
      verdict = @verdict, updated_at = @now
  `).run(v);
}

/** Entfernt ein Verdict (Undo). */
export function deleteVerdict(guestId: string, slug: string) {
  getDb().prepare(`DELETE FROM verdicts WHERE guest_id = ? AND slug = ?`).run(guestId, slug);
}

/** Alle Verdicts (für die Admin-Auswertung — Datenmenge ist klein). */
export function getAllVerdicts(): VerdictRow[] {
  return getDb().prepare(`SELECT * FROM verdicts ORDER BY updated_at DESC`).all() as VerdictRow[];
}
