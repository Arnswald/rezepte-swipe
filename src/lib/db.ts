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

    -- v3: Gäste mit teilbarem Freundescode (Name steckt im Code, z.B. MELI-4K2)
    CREATE TABLE IF NOT EXISTS guests (
      guest_id    TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      friend_code TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL
    );

    -- v3: Verbindungen zwischen zwei Gästen. Paar normalisiert (a < b), 1 Zeile pro Paar.
    CREATE TABLE IF NOT EXISTS connections (
      guest_a    TEXT NOT NULL,
      guest_b    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (guest_a, guest_b)
    );
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

// ── v3: Gäste, Freundescodes, Verbindungen, Matches, Trending ──────────────

export interface GuestRow {
  guest_id: string;
  name: string;
  friend_code: string;
  created_at: string;
}

/** Match-Eintrag: ein Gericht, das ich UND ein:e Freund:in mögen. */
export interface MatchRecipe {
  slug: string;
  recipeName: string;
  category: string;
  mine: Verdict;
  theirs: Verdict;
  bothSuper: boolean;
}

export interface MatchGroup {
  partner: { guestId: string; name: string; friendCode: string };
  recipes: MatchRecipe[];
}

// Codes ohne verwechselbare Zeichen (kein 0/O, 1/I) — leichter vorzulesen/tippen.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function codePrefix(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-ZÄÖÜ]/g, "").replace(/Ä/g, "AE").replace(/Ö/g, "OE").replace(/Ü/g, "UE");
  const p = letters.slice(0, 4);
  return p.length >= 2 ? p : "GAST";
}

function randomSuffix(len = 3): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/** Erzeugt einen eindeutigen Freundescode mit Namens-Präfix, z.B. MELI-4K2. */
function generateFriendCode(db: Database.Database, name: string): string {
  const prefix = codePrefix(name);
  const exists = db.prepare(`SELECT 1 FROM guests WHERE friend_code = ?`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const code = `${prefix}-${randomSuffix(attempt < 20 ? 3 : 4)}`;
    if (!exists.get(code)) return code;
  }
  // Extrem unwahrscheinlich — Fallback mit langem Suffix
  return `${prefix}-${randomSuffix(6)}`;
}

/**
 * Stellt sicher, dass ein Gast existiert (mit Code) und hält den Namen aktuell.
 * Idempotent: legt Code nur einmal an, überschreibt ihn nie. Gibt den Gast zurück.
 */
export function ensureGuest(guestId: string, name: string, now: string): GuestRow {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM guests WHERE guest_id = ?`).get(guestId) as GuestRow | undefined;
  if (existing) {
    if (name && name !== existing.name) {
      db.prepare(`UPDATE guests SET name = ? WHERE guest_id = ?`).run(name, guestId);
      existing.name = name;
    }
    return existing;
  }
  const friend_code = generateFriendCode(db, name || "Gast");
  db.prepare(
    `INSERT INTO guests (guest_id, name, friend_code, created_at) VALUES (?, ?, ?, ?)`,
  ).run(guestId, name || "Gast", friend_code, now);
  return { guest_id: guestId, name: name || "Gast", friend_code, created_at: now };
}

/** Sucht einen Gast per Freundescode (case-insensitiv, Bindestrich egal). */
export function getGuestByCode(code: string): GuestRow | undefined {
  const norm = code.trim().toUpperCase().replace(/\s/g, "");
  const db = getDb();
  // exakt (mit Bindestrich) zuerst, sonst tolerant ohne Sonderzeichen
  const exact = db.prepare(`SELECT * FROM guests WHERE UPPER(friend_code) = ?`).get(norm) as GuestRow | undefined;
  if (exact) return exact;
  const stripped = norm.replace(/[^A-Z0-9]/g, "");
  return db
    .prepare(`SELECT * FROM guests WHERE REPLACE(UPPER(friend_code), '-', '') = ?`)
    .get(stripped) as GuestRow | undefined;
}

/** Normalisiert ein Paar, damit jede Verbindung nur einmal gespeichert wird. */
function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export type ConnectResult =
  | { ok: true; partner: GuestRow; already: boolean }
  | { ok: false; reason: "self" | "not_found" };

/**
 * Verbindet den Gast `guestId` mit dem Inhaber von `code`.
 * `ensureGuest` muss für den Aufrufer vorher aufgerufen werden (macht die Route).
 */
export function connectByCode(guestId: string, code: string, now: string): ConnectResult {
  const target = getGuestByCode(code);
  if (!target) return { ok: false, reason: "not_found" };
  if (target.guest_id === guestId) return { ok: false, reason: "self" };
  const [a, b] = pair(guestId, target.guest_id);
  const db = getDb();
  const existed = db.prepare(`SELECT 1 FROM connections WHERE guest_a = ? AND guest_b = ?`).get(a, b);
  if (!existed) {
    db.prepare(`INSERT INTO connections (guest_a, guest_b, created_at) VALUES (?, ?, ?)`).run(a, b, now);
  }
  return { ok: true, partner: target, already: !!existed };
}

/** Alle verbundenen Gäste eines Gasts. */
export function getConnections(guestId: string): GuestRow[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT guest_a, guest_b FROM connections WHERE guest_a = ? OR guest_b = ?`)
    .all(guestId, guestId) as { guest_a: string; guest_b: string }[];
  const partnerIds = rows.map((r) => (r.guest_a === guestId ? r.guest_b : r.guest_a));
  if (partnerIds.length === 0) return [];
  const placeholders = partnerIds.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM guests WHERE guest_id IN (${placeholders})`)
    .all(...partnerIds) as GuestRow[];
}

/**
 * Matches für einen Gast: pro Verbindung die Gerichte, die BEIDE mögen
 * (Verdict like oder super). Doppel-Superlike wird markiert.
 */
export function getMatches(guestId: string): MatchGroup[] {
  const db = getDb();
  const partners = getConnections(guestId);
  const stmt = db.prepare(`
    SELECT a.slug AS slug, a.recipe_name AS recipeName, a.category AS category,
           a.verdict AS mine, b.verdict AS theirs
    FROM verdicts a
    JOIN verdicts b ON a.slug = b.slug
    WHERE a.guest_id = @me AND b.guest_id = @partner
      AND a.verdict IN ('like','super') AND b.verdict IN ('like','super')
    ORDER BY (a.verdict = 'super' AND b.verdict = 'super') DESC, a.recipe_name ASC
  `);
  const groups: MatchGroup[] = [];
  for (const p of partners) {
    const rows = stmt.all({ me: guestId, partner: p.guest_id }) as Omit<MatchRecipe, "bothSuper">[];
    groups.push({
      partner: { guestId: p.guest_id, name: p.name, friendCode: p.friend_code },
      recipes: rows.map((r) => ({ ...r, bothSuper: r.mine === "super" && r.theirs === "super" })),
    });
  }
  return groups;
}

/** Ein frisch entstandenes Match beim Swipen (für die „Es ist ein Match!"-Animation). */
export interface MatchPing {
  name: string;
  theirs: Verdict;
  bothSuper: boolean;
}

/**
 * Prüft, ob mein gerade gesetztes Verdict (`myVerdict`) auf `slug` ein Match mit
 * verbundenen Freund:innen ergibt — also ob jemand, mit dem ich verbunden bin,
 * dasselbe Gericht auch mag (like/super). Gibt diese Partner zurück.
 * Nur relevant für like/super (Rechts-/Hoch-Swipe).
 */
export function getMatchPartnersForSlug(guestId: string, slug: string, myVerdict: Verdict): MatchPing[] {
  if (myVerdict !== "like" && myVerdict !== "super") return [];
  const partners = getConnections(guestId);
  if (partners.length === 0) return [];
  const ids = partners.map((p) => p.guest_id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT guest_id, verdict FROM verdicts
       WHERE slug = ? AND verdict IN ('like','super') AND guest_id IN (${placeholders})`,
    )
    .all(slug, ...ids) as { guest_id: string; verdict: Verdict }[];
  const nameById = new Map(partners.map((p) => [p.guest_id, p.name]));
  return rows.map((r) => ({
    name: nameById.get(r.guest_id) ?? "Freund:in",
    theirs: r.verdict,
    bothSuper: myVerdict === "super" && r.verdict === "super",
  }));
}

/** Öffentliche Aggregat-Zähler pro Gericht (KEINE Namen): likes = like+super, supers = super. */
export function getTrendingCounts(): Record<string, { likes: number; supers: number }> {
  const rows = getDb()
    .prepare(`
      SELECT slug,
             SUM(CASE WHEN verdict IN ('like','super') THEN 1 ELSE 0 END) AS likes,
             SUM(CASE WHEN verdict = 'super' THEN 1 ELSE 0 END) AS supers
      FROM verdicts
      GROUP BY slug
    `)
    .all() as { slug: string; likes: number; supers: number }[];
  const out: Record<string, { likes: number; supers: number }> = {};
  for (const r of rows) out[r.slug] = { likes: r.likes, supers: r.supers };
  return out;
}

// ── Admin-Verwaltung (Personen löschen etc.) ──────────────────────────────────

export interface AdminPerson {
  guestId: string;
  name: string;
  friendCode: string | null;
  likes: number;
  supers: number;
  nopes: number;
  total: number;
  connections: number;
  connectedTo: { guestId: string; name: string }[];
  liked: string[];
  lastActive: string | null;
  createdAt: string | null;
}

/**
 * Alle Personen für das Admin-Panel — vereint die `guests`-Tabelle (mit Code)
 * und die `verdicts` (auch Alt-Gäste ohne guests-Zeile), plus Verbindungs-Anzahl.
 */
export function getAdminPersons(): AdminPerson[] {
  const db = getDb();
  const guests = db.prepare(`SELECT guest_id, name, friend_code, created_at FROM guests`).all() as GuestRow[];
  const verdicts = db
    .prepare(`SELECT guest_id, name, recipe_name, slug, verdict, updated_at FROM verdicts`)
    .all() as { guest_id: string; name: string; recipe_name: string; slug: string; verdict: Verdict; updated_at: string }[];
  const conns = db.prepare(`SELECT guest_a, guest_b FROM connections`).all() as { guest_a: string; guest_b: string }[];

  const map = new Map<string, AdminPerson>();
  const ensure = (id: string, name: string): AdminPerson => {
    let p = map.get(id);
    if (!p) {
      p = { guestId: id, name: name || "Gast", friendCode: null, likes: 0, supers: 0, nopes: 0, total: 0, connections: 0, connectedTo: [], liked: [], lastActive: null, createdAt: null };
      map.set(id, p);
    }
    return p;
  };

  for (const g of guests) {
    const p = ensure(g.guest_id, g.name);
    p.name = g.name;
    p.friendCode = g.friend_code;
    p.createdAt = g.created_at;
  }
  for (const v of verdicts) {
    const p = ensure(v.guest_id, v.name);
    if (v.name) p.name = v.name;
    if (v.verdict === "like") p.likes += 1;
    else if (v.verdict === "super") p.supers += 1;
    else p.nopes += 1;
    p.total += 1;
    if (v.verdict === "like" || v.verdict === "super") p.liked.push(v.recipe_name || v.slug);
    if (!p.lastActive || v.updated_at > p.lastActive) p.lastActive = v.updated_at;
  }
  for (const c of conns) {
    const pa = map.get(c.guest_a);
    const pb = map.get(c.guest_b);
    if (pa && pb) {
      pa.connectedTo.push({ guestId: pb.guestId, name: pb.name });
      pb.connectedTo.push({ guestId: pa.guestId, name: pa.name });
    } else {
      // Verbindung zu jemandem ohne Personen-Eintrag (selten) — nur der bekannten Seite zählen
      if (pa) pa.connectedTo.push({ guestId: c.guest_b, name: "?" });
      if (pb) pb.connectedTo.push({ guestId: c.guest_a, name: "?" });
    }
  }
  for (const p of map.values()) p.connections = p.connectedTo.length;

  return [...map.values()].sort(
    (a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? "") || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );
}

/** Admin: verbindet zwei Personen direkt (per guestId, ohne Code). Paar normalisiert. */
export function adminConnect(a: string, b: string, now: string): { ok: boolean; already: boolean; reason?: "self" } {
  if (a === b) return { ok: false, already: false, reason: "self" };
  const db = getDb();
  const [x, y] = pair(a, b);
  const had = db.prepare(`SELECT 1 FROM connections WHERE guest_a = ? AND guest_b = ?`).get(x, y);
  if (!had) db.prepare(`INSERT INTO connections (guest_a, guest_b, created_at) VALUES (?, ?, ?)`).run(x, y, now);
  return { ok: true, already: !!had };
}

/** Admin: trennt eine Verbindung zwischen zwei Personen. */
export function adminDisconnect(a: string, b: string): { removed: number } {
  const [x, y] = pair(a, b);
  const removed = getDb().prepare(`DELETE FROM connections WHERE guest_a = ? AND guest_b = ?`).run(x, y).changes;
  return { removed };
}

/** Löscht eine Person vollständig: ihre Verdicts, alle ihre Verbindungen und den Gast selbst. */
export function deleteGuestCascade(guestId: string): { verdicts: number; connections: number; guest: number } {
  const db = getDb();
  const tx = db.transaction((id: string) => ({
    verdicts: db.prepare(`DELETE FROM verdicts WHERE guest_id = ?`).run(id).changes,
    connections: db.prepare(`DELETE FROM connections WHERE guest_a = ? OR guest_b = ?`).run(id, id).changes,
    guest: db.prepare(`DELETE FROM guests WHERE guest_id = ?`).run(id).changes,
  }));
  return tx(guestId);
}
