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
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from "crypto";
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

    -- v3.1: Gruppen (mehrere Personen) mit teilbarem Gruppencode.
    CREATE TABLE IF NOT EXISTS groups (
      group_id   TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      group_code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id  TEXT NOT NULL,
      guest_id  TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (group_id, guest_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_members_guest ON group_members(guest_id);

    -- v5: "Essensplan für heute Abend" — pro Gruppe ein separater, zurücksetzbarer
    -- Swipe-Durchgang (getrennt von den Dauer-Favoriten/verdicts).
    CREATE TABLE IF NOT EXISTS evening_picks (
      group_id    TEXT NOT NULL,
      guest_id    TEXT NOT NULL,
      slug        TEXT NOT NULL,
      recipe_name TEXT NOT NULL DEFAULT '',
      category    TEXT NOT NULL DEFAULT '',
      verdict     TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (group_id, guest_id, slug)
    );
    CREATE INDEX IF NOT EXISTS idx_evening_group ON evening_picks(group_id);

    -- v4: echte Accounts (Benutzername + Passwort). Hängt an einem guest_id (= die Identität).
    CREATE TABLE IF NOT EXISTS accounts (
      username_norm TEXT PRIMARY KEY,   -- kleingeschrieben, für Eindeutigkeit/Login
      username      TEXT NOT NULL,       -- Anzeige (Original-Schreibweise)
      password_hash TEXT NOT NULL,       -- scrypt: "<saltHex>:<hashHex>"
      guest_id      TEXT NOT NULL UNIQUE,
      created_at    TEXT NOT NULL
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
  registeredAt: string | null; // Datum der Account-Registrierung (accounts.created_at)
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
  const accounts = db.prepare(`SELECT guest_id, created_at FROM accounts`).all() as { guest_id: string; created_at: string }[];
  const regByGuest = new Map(accounts.map((a) => [a.guest_id, a.created_at]));

  const map = new Map<string, AdminPerson>();
  const ensure = (id: string, name: string): AdminPerson => {
    let p = map.get(id);
    if (!p) {
      p = { guestId: id, name: name || "Gast", friendCode: null, likes: 0, supers: 0, nopes: 0, total: 0, connections: 0, connectedTo: [], liked: [], lastActive: null, createdAt: null, registeredAt: null };
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
  for (const p of map.values()) {
    p.connections = p.connectedTo.length;
    p.registeredAt = regByGuest.get(p.guestId) ?? null;
  }

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

/** Löscht eine Person vollständig: Verdicts, Verbindungen, Gruppen-Mitgliedschaften, Gast. */
export function deleteGuestCascade(guestId: string): { verdicts: number; connections: number; guest: number } {
  const db = getDb();
  const tx = db.transaction((id: string) => {
    const verdicts = db.prepare(`DELETE FROM verdicts WHERE guest_id = ?`).run(id).changes;
    const connections = db.prepare(`DELETE FROM connections WHERE guest_a = ? OR guest_b = ?`).run(id, id).changes;
    db.prepare(`DELETE FROM group_members WHERE guest_id = ?`).run(id);
    db.prepare(`DELETE FROM evening_picks WHERE guest_id = ?`).run(id);
    db.prepare(`DELETE FROM accounts WHERE guest_id = ?`).run(id);
    const guest = db.prepare(`DELETE FROM guests WHERE guest_id = ?`).run(id).changes;
    return { verdicts, connections, guest };
  });
  return tx(guestId);
}

// ── v4: Accounts (Benutzername + Passwort) ────────────────────────────────────

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = Buffer.from(hashHex, "hex");
  const test = scryptSync(password, Buffer.from(saltHex, "hex"), hash.length);
  return hash.length === test.length && timingSafeEqual(hash, test);
}

export type RegisterResult =
  | { ok: true; guestId: string; name: string }
  | { ok: false; reason: "taken" | "invalid" };

/**
 * Legt einen Account an. Ist `existingGuestId` gesetzt und hat noch keinen Account,
 * wird er übernommen (bestehende Likes/Gruppen bleiben) — sonst neue Identität.
 */
export function registerAccount(username: string, password: string, existingGuestId: string | null, now: string): RegisterResult {
  const name = username.trim();
  const norm = name.toLowerCase();
  if (name.length < 2 || password.length < 4) return { ok: false, reason: "invalid" };
  const db = getDb();
  if (db.prepare(`SELECT 1 FROM accounts WHERE username_norm = ?`).get(norm)) return { ok: false, reason: "taken" };

  let guestId = (existingGuestId ?? "").trim();
  if (guestId && db.prepare(`SELECT 1 FROM accounts WHERE guest_id = ?`).get(guestId)) {
    guestId = ""; // an dieser ID hängt schon ein Account → neue Identität
  }
  if (!guestId) guestId = randomUUID();

  ensureGuest(guestId, name, now);
  db.prepare(`UPDATE guests SET name = ? WHERE guest_id = ?`).run(name, guestId);
  db.prepare(`INSERT INTO accounts (username_norm, username, password_hash, guest_id, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(norm, name, hashPassword(password), guestId, now);
  return { ok: true, guestId, name };
}

export type LoginResult = { ok: true; guestId: string; name: string } | { ok: false };

export function loginAccount(username: string, password: string): LoginResult {
  const norm = username.trim().toLowerCase();
  const row = getDb()
    .prepare(`SELECT username, password_hash, guest_id FROM accounts WHERE username_norm = ?`)
    .get(norm) as { username: string; password_hash: string; guest_id: string } | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return { ok: false };
  return { ok: true, guestId: row.guest_id, name: row.username };
}

/** Ob an einer Identität ein Account hängt (für die UI). */
export function hasAccount(guestId: string): boolean {
  return !!getDb().prepare(`SELECT 1 FROM accounts WHERE guest_id = ?`).get(guestId);
}

/** Bewertungen eines Gasts als { slug: verdict } — für Server-Hydration nach Login. */
export function getVerdictsForGuest(guestId: string): Record<string, Verdict> {
  const rows = getDb().prepare(`SELECT slug, verdict FROM verdicts WHERE guest_id = ?`).all(guestId) as { slug: string; verdict: Verdict }[];
  const out: Record<string, Verdict> = {};
  for (const r of rows) out[r.slug] = r.verdict;
  return out;
}

// ── v3.1: Gruppen ─────────────────────────────────────────────────────────────

export interface GroupRow { group_id: string; name: string; group_code: string; created_at: string }

/** Ein Gericht im Gruppen-Ranking: wie viele Mitglieder mögen es (like/super). */
export interface GroupMatch {
  slug: string;
  recipeName: string;
  category: string;
  count: number;        // Mitglieder, die es mögen (like ODER super)
  supers: number;       // davon per Superlike
  memberCount: number;  // Gruppengröße
  unanimous: boolean;   // alle Mitglieder mögen es
}

export interface GroupView {
  id: string;
  name: string;
  code: string;
  members: { guestId: string; name: string }[];
  memberCount: number;
  matches: GroupMatch[];
  // "Essensplan für heute Abend": aktuelle Runde (getrennt von den Favoriten)
  evening: { plan: GroupMatch[]; myPicks: number };
}

function generateGroupCode(db: Database.Database, name: string): string {
  const prefix = codePrefix(name);
  const exists = db.prepare(`SELECT 1 FROM groups WHERE group_code = ?`);
  for (let i = 0; i < 40; i++) {
    const code = `${prefix}-${randomSuffix(i < 20 ? 3 : 4)}`;
    if (!exists.get(code)) return code;
  }
  return `${prefix}-${randomSuffix(6)}`;
}

/** Mitglieder einer Gruppe mit Namen (aus guests, Fallback verdicts). */
function groupMembers(db: Database.Database, groupId: string): { guestId: string; name: string }[] {
  return db.prepare(`
    SELECT gm.guest_id AS guestId,
           COALESCE(g.name, (SELECT v.name FROM verdicts v WHERE v.guest_id = gm.guest_id LIMIT 1), 'Gast') AS name
    FROM group_members gm
    LEFT JOIN guests g ON g.guest_id = gm.guest_id
    WHERE gm.group_id = ?
    ORDER BY name COLLATE NOCASE
  `).all(groupId) as { guestId: string; name: string }[];
}

/** Gruppen-Ranking: Gerichte sortiert nach Anzahl Mitglieder, die sie mögen. */
export function getGroupMatches(groupId: string): GroupMatch[] {
  const db = getDb();
  const memberCount = (db.prepare(`SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?`).get(groupId) as { n: number }).n;
  if (memberCount === 0) return [];
  const rows = db.prepare(`
    SELECT v.slug AS slug,
           MAX(v.recipe_name) AS recipeName,
           MAX(v.category) AS category,
           COUNT(DISTINCT v.guest_id) AS cnt,
           COUNT(DISTINCT CASE WHEN v.verdict = 'super' THEN v.guest_id END) AS supers
    FROM verdicts v
    JOIN group_members gm ON gm.guest_id = v.guest_id AND gm.group_id = @gid
    WHERE v.verdict IN ('like','super')
    GROUP BY v.slug
    ORDER BY cnt DESC, supers DESC, recipeName ASC
  `).all({ gid: groupId }) as { slug: string; recipeName: string; category: string; cnt: number; supers: number }[];
  return rows.map((r) => ({
    slug: r.slug,
    recipeName: r.recipeName || r.slug,
    category: r.category || "",
    count: r.cnt,
    supers: r.supers,
    memberCount,
    unanimous: r.cnt === memberCount,
  }));
}

export function getGroupByCode(code: string): GroupRow | undefined {
  const norm = code.trim().toUpperCase().replace(/\s/g, "");
  const db = getDb();
  const exact = db.prepare(`SELECT * FROM groups WHERE UPPER(group_code) = ?`).get(norm) as GroupRow | undefined;
  if (exact) return exact;
  const stripped = norm.replace(/[^A-Z0-9]/g, "");
  return db.prepare(`SELECT * FROM groups WHERE REPLACE(UPPER(group_code), '-', '') = ?`).get(stripped) as GroupRow | undefined;
}

/** Legt eine Gruppe an; wenn creatorGuestId gesetzt ist, wird er direkt Mitglied. */
export function createGroup(creatorGuestId: string | null, name: string, now: string): GroupRow {
  const db = getDb();
  const group_id = randomUUID();
  const code = generateGroupCode(db, name || "Gruppe");
  db.prepare(`INSERT INTO groups (group_id, name, group_code, created_at) VALUES (?, ?, ?, ?)`).run(group_id, name || "Gruppe", code, now);
  if (creatorGuestId) {
    db.prepare(`INSERT OR IGNORE INTO group_members (group_id, guest_id, joined_at) VALUES (?, ?, ?)`).run(group_id, creatorGuestId, now);
  }
  return { group_id, name: name || "Gruppe", group_code: code, created_at: now };
}

export type JoinGroupResult = { ok: true; group: GroupRow; already: boolean } | { ok: false; reason: "not_found" };

export function joinGroupByCode(guestId: string, code: string, now: string): JoinGroupResult {
  const g = getGroupByCode(code);
  if (!g) return { ok: false, reason: "not_found" };
  const db = getDb();
  const had = db.prepare(`SELECT 1 FROM group_members WHERE group_id = ? AND guest_id = ?`).get(g.group_id, guestId);
  if (!had) db.prepare(`INSERT INTO group_members (group_id, guest_id, joined_at) VALUES (?, ?, ?)`).run(g.group_id, guestId, now);
  return { ok: true, group: g, already: !!had };
}

/** Verlässt eine Gruppe; leere Gruppen werden aufgeräumt. */
export function leaveGroup(guestId: string, groupId: string): { removed: number; deletedGroup: boolean } {
  const db = getDb();
  const removed = db.prepare(`DELETE FROM group_members WHERE group_id = ? AND guest_id = ?`).run(groupId, guestId).changes;
  db.prepare(`DELETE FROM evening_picks WHERE group_id = ? AND guest_id = ?`).run(groupId, guestId);
  const remaining = (db.prepare(`SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?`).get(groupId) as { n: number }).n;
  let deletedGroup = false;
  if (remaining === 0) {
    db.prepare(`DELETE FROM evening_picks WHERE group_id = ?`).run(groupId);
    db.prepare(`DELETE FROM groups WHERE group_id = ?`).run(groupId);
    deletedGroup = true;
  }
  return { removed, deletedGroup };
}

/** Alle Gruppen eines Gasts inkl. Mitglieder + Ranking. */
export function getGroupsForGuest(guestId: string): GroupView[] {
  const db = getDb();
  const groups = db.prepare(`
    SELECT g.* FROM groups g
    JOIN group_members gm ON gm.group_id = g.group_id
    WHERE gm.guest_id = ?
    ORDER BY g.created_at DESC
  `).all(guestId) as GroupRow[];
  return groups.map((g) => {
    const members = groupMembers(db, g.group_id);
    return {
      id: g.group_id, name: g.name, code: g.group_code, members, memberCount: members.length,
      matches: getGroupMatches(g.group_id),
      evening: { plan: getEveningPlan(g.group_id), myPicks: getEveningPickCount(g.group_id, guestId) },
    };
  });
}

// ── v5: "Essensplan für heute Abend" (getrennte, zurücksetzbare Runde pro Gruppe) ──

/** Setzt/entfernt eine Abend-Bewertung (verdict null = entfernen). */
export function setEveningPick(v: {
  groupId: string; guestId: string; slug: string; recipeName: string; category: string; verdict: Verdict | null; now: string;
}) {
  const db = getDb();
  if (v.verdict === null) {
    db.prepare(`DELETE FROM evening_picks WHERE group_id = ? AND guest_id = ? AND slug = ?`).run(v.groupId, v.guestId, v.slug);
    return;
  }
  db.prepare(`
    INSERT INTO evening_picks (group_id, guest_id, slug, recipe_name, category, verdict, updated_at)
    VALUES (@groupId, @guestId, @slug, @recipeName, @category, @verdict, @now)
    ON CONFLICT(group_id, guest_id, slug) DO UPDATE SET
      recipe_name = @recipeName, category = @category, verdict = @verdict, updated_at = @now
  `).run(v);
}

/** Leert die Abend-Runde einer Person in einer Gruppe ("Neuer Abend"). */
export function resetEvening(groupId: string, guestId: string): { removed: number } {
  return { removed: getDb().prepare(`DELETE FROM evening_picks WHERE group_id = ? AND guest_id = ?`).run(groupId, guestId).changes };
}

export function getEveningPickCount(groupId: string, guestId: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM evening_picks WHERE group_id = ? AND guest_id = ?`).get(groupId, guestId) as { n: number }).n;
}

/** Abend-Ranking: Gerichte sortiert danach, wie viele Mitglieder sie HEUTE wollen. */
export function getEveningPlan(groupId: string): GroupMatch[] {
  const db = getDb();
  const memberCount = (db.prepare(`SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?`).get(groupId) as { n: number }).n;
  if (memberCount === 0) return [];
  const rows = db.prepare(`
    SELECT e.slug AS slug,
           MAX(e.recipe_name) AS recipeName,
           MAX(e.category) AS category,
           COUNT(DISTINCT e.guest_id) AS cnt,
           COUNT(DISTINCT CASE WHEN e.verdict = 'super' THEN e.guest_id END) AS supers
    FROM evening_picks e
    JOIN group_members gm ON gm.guest_id = e.guest_id AND gm.group_id = @gid
    WHERE e.group_id = @gid AND e.verdict IN ('like','super')
    GROUP BY e.slug
    ORDER BY cnt DESC, supers DESC, recipeName ASC
  `).all({ gid: groupId }) as { slug: string; recipeName: string; category: string; cnt: number; supers: number }[];
  return rows.map((r) => ({
    slug: r.slug, recipeName: r.recipeName || r.slug, category: r.category || "",
    count: r.cnt, supers: r.supers, memberCount, unanimous: r.cnt === memberCount,
  }));
}

// ── Admin: Gruppen verwalten ──────────────────────────────────────────────────

export interface AdminGroup {
  id: string; name: string; code: string; createdAt: string;
  members: { guestId: string; name: string }[];
  memberCount: number;
}

export function getAdminGroups(): AdminGroup[] {
  const db = getDb();
  const groups = db.prepare(`SELECT * FROM groups ORDER BY created_at DESC`).all() as GroupRow[];
  return groups.map((g) => {
    const members = groupMembers(db, g.group_id);
    return { id: g.group_id, name: g.name, code: g.group_code, createdAt: g.created_at, members, memberCount: members.length };
  });
}

export function addGroupMember(groupId: string, guestId: string, now: string): { added: boolean } {
  const db = getDb();
  const had = db.prepare(`SELECT 1 FROM group_members WHERE group_id = ? AND guest_id = ?`).get(groupId, guestId);
  if (!had) db.prepare(`INSERT INTO group_members (group_id, guest_id, joined_at) VALUES (?, ?, ?)`).run(groupId, guestId, now);
  return { added: !had };
}

export function removeGroupMember(groupId: string, guestId: string): { removed: number } {
  return { removed: getDb().prepare(`DELETE FROM group_members WHERE group_id = ? AND guest_id = ?`).run(groupId, guestId).changes };
}

export function deleteGroup(groupId: string): { members: number; group: number } {
  const db = getDb();
  const tx = db.transaction((id: string) => {
    db.prepare(`DELETE FROM evening_picks WHERE group_id = ?`).run(id);
    return {
      members: db.prepare(`DELETE FROM group_members WHERE group_id = ?`).run(id).changes,
      group: db.prepare(`DELETE FROM groups WHERE group_id = ?`).run(id).changes,
    };
  });
  return tx(groupId);
}
