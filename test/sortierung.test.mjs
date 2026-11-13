// Sortierung im Reiter „Gerichte“ (13.11.2026): Zähler für „Beliebt“ und Datum für „Neu“.
// Eigene Test-DB im Temp-Ordner, nie die echte DATA_DIR.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "rezepte-sort-test-"));
process.env.NODE_ENV = "test";

const db = {};
const store = {};
before(async () => {
  Object.assign(db, await import("../src/lib/db.ts"));
  Object.assign(store, await import("../src/lib/recipeStore.ts"));
});

test("Trending-Zähler: Likes, Superlikes, Koch-Einträge und Sterne-Punkte je Gericht", () => {
  const now = "2026-11-13T10:00:00.000Z";
  const v = (g, slug, verdict) => db.upsertVerdict({ guestId: g, name: g, slug, recipeName: slug, category: "Hauptgericht", verdict, now });
  v("a", "pasta", "like");
  v("b", "pasta", "super");
  v("a", "suppe", "nope");
  db.addCookEvent({ authorGuest: "a", slug: "pasta", recipeName: "pasta", category: "Hauptgericht", partnerGuest: null, cookedOn: "2026-11-12", now });
  db.addCookEvent({ authorGuest: "b", slug: "kuchen", recipeName: "kuchen", category: "Dessert", partnerGuest: null, cookedOn: "2026-11-12", now });
  db.upsertRating({ guestId: "a", name: "a", slug: "pasta", recipeName: "pasta", category: "Hauptgericht", stars: 5, now });
  db.upsertRating({ guestId: "b", name: "b", slug: "suppe", recipeName: "suppe", category: "Hauptgericht", stars: 1, now });

  const c = db.getTrendingCounts();
  assert.deepEqual(c.pasta, { likes: 2, supers: 1, cooked: 1, starPoints: 2 });
  // nur gekocht, nie gewischt: taucht trotzdem auf
  assert.deepEqual(c.kuchen, { likes: 0, supers: 0, cooked: 1, starPoints: 0 });
  assert.deepEqual(c.suppe, { likes: 0, supers: 0, cooked: 0, starPoints: -2 });
});

test("added: Vault-Rezept trägt sein Frontmatter-Datum, alles andere den Zeitpunkt der Freigabe", () => {
  const basis = {
    id: 1, slug: "x", name: "X", beschreibung: "", kategorie: "Hauptgericht", kalorien: null, protein: null,
    kohlenhydrate: null, fette: null, gesamtzeit: null, portionen: null, schwierigkeit: null,
    zutaten: "[]", schritte: "[]", tipps: "[]", tags: "[]", erstellt: "2026-08-01", status: "veroeffentlicht",
    status_grund: null, quelle_url: null, quelle_key: null, plattform: null, eingereicht_von: null,
    eingereicht_name: null, pruefung: null, bildfokus: null, kartenbild: null, obsidian_datei: null,
    obsidian_original: null, obsidian_hash: null, obsidian_export_hash: null, privat: 0, ausgeblendet_am: null,
    erstellt_am: "2026-10-17T08:00:00.000Z", geaendert_am: "2026-10-17T08:00:00.000Z",
    freigegeben_am: "2026-10-17T08:00:00.000Z",
  };
  assert.equal(store.rowToRecipe({ ...basis, herkunft: "obsidian" }, []).added, "2026-08-01");
  // Einreichung vom 01.11., freigegeben am 12.11.: gilt ab dem 12.11. als neu
  assert.equal(
    store.rowToRecipe({ ...basis, herkunft: "link", erstellt: "2026-11-01", freigegeben_am: "2026-11-12T18:30:00.000Z" }, []).added,
    "2026-11-12T18:30:00.000Z",
  );
});
