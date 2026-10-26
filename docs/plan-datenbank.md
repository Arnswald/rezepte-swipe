# Rezepte aus der Datenbank statt aus Obsidian — Plan

Stand 17.10.2026: **gebaut und lokal geprüft** (Phase 1–3). Umschalten (Phase 4) über
`RECIPE_SOURCE=db` im Stack. Offene Entscheidungen von Christian beantwortet: Server-Schlüssel ok,
Kategorien wie gehabt (9 im Enum, 3 Gruppen in der App), eigene Telegram-Links direkt veröffentlichen
(wenn die Prüfung ok ist), Formular-Einreichungen weiter von Claude aufbereiten lassen.

**Abweichung vom Entwurf:** n8n schickt weiter das Kochbuch-Markdown (gleicher Claude-Prompt wie
für den Vault), die App parst es mit `parseRecipeMarkdown()`. So bleibt der Prompt unverändert,
und neue n8n-Workflows (10c, 14b) ersetzen nur das Ende. Gebaut von
`n8n-automationen/werkzeuge/rezepte_auf_app_umstellen.py`.

## Entscheidungen (Christian, 17.10.2026)

1. **Gemeinsamer Pool.** Alle sehen Christians Rezepte und freigegebene Einreichungen. Wer einreicht, sieht seine Einreichung sofort selbst, andere erst nach Freigabe.
2. **Datenbank ist führend.** Die 187 Rezepte werden einmal samt Bildern übernommen. Obsidian bekommt später eine Kopie (Export), wird aber nicht mehr gelesen.
3. **Einreichung per Link** (Instagram, TikTok, Pinterest, Website): automatisch auslesen und prüfen, Freigabe durch Christian im Admin mit einem Tipp, Telegram-Hinweis bei neuer Einreichung.

## Architektur: SQLite im DATA_DIR, kein Postgres

**Empfehlung: SQLite in derselben Datei wie heute (`DATA_DIR/rezepte.db`).**

| | SQLite im App-Container | eigener Postgres-Container |
|---|---|---|
| Betrieb | nichts Neues, better-sqlite3 läuft schon | zweiter Container, Passwort, Volume, Updates |
| Last | ~200 Rezepte, eine Handvoll Gäste, ein Schreiber | wäre für 1000× mehr gebaut |
| Backup | eine Datei; `db.backup()` → Export-Endpunkt, wie das Dashboard (`backup.mjs`) | `pg_dump` per Portainer-Exec, eigener Weg |
| n8n-Zugriff | über die App-API (Plausibilität, Dubletten, Bilder an einer Stelle) | Versuchung, direkt in die DB zu schreiben; Prüfungen doppelt |
| JOINs mit Verdicts/Trending | gleiche Datei, geht | zwei Datenbanken |
| Ausfallrisiko | ein Container | App ohne DB-Container = 500 |

Ein Betreiber, wenig Last, ein Schreibweg (die App): Postgres bringt hier nur Wartung. n8n und der Mac reden ausschließlich mit der App-API, nie mit der Datei.

**Bilder** liegen als Dateien in `DATA_DIR/bilder`, die Tabelle `recipe_images` verweist darauf. Dateinamen bleiben die aus dem Vault (`<slug>.jpg`, `_1`, `_selbst`, `_KI`, `_original`), Änderungszeit wird mitkopiert. Dadurch bleiben gültig: alle Bild-URLs `/api/recipes/image/<name>`, der Varianten-Cache `DATA_DIR/image-cache` und der Fokus-Cache `focus-v1.json` (Schlüssel Name + Größe + mtime). Kein Bild wird neu berechnet, Cloudflare behält seinen Cache.

## Was in diesem Branch liegt (nichts davon ist verdrahtet)

| Datei | Inhalt |
|---|---|
| `src/lib/recipeStore.ts` | Schema (recipes, recipe_images, schema_versionen), Migration mit Versionsnummer, `openRecipeStore()` / `recipeStore()`, list/get/insert/update/setStatus/addImage/findBySourceKey/titles, `rowToRecipe()` → exakt der heutige `Recipe`-Typ |
| `src/lib/obsidianImport.ts` | Übernahme, nutzt den Parser aus `recipes.ts` (nicht kopiert), idempotent |
| `src/lib/submission.ts` | Plattform erkennen, `quelleKey`, Slug, Plausibilitätsregeln, Titel-Ähnlichkeit, Telegram-Text, **API-Verträge als Kommentar**, Kostenvergleich n8n vs. App |
| `tools/import-obsidian.mjs` | `node tools/import-obsidian.mjs --ziel <DATA_DIR> [--quelle <Gerichte>] [--trocken]` |
| `tools/pruefe-import.mjs` | Gegenprobe: Anzahl, Rundreise aller Felder, Stichprobe gegen rohes Markdown, Bilder per sha1, Sichtbarkeits-Selbsttest |
| `tools/vergleich-live.mjs` | DB gegen `/api/recipes?lite=1` einer laufenden App (Slugs, Namen, alle Felder, Reihenfolge) |
| `tools/ts-laden.mjs` | lässt Node 25 die TS-Module aus `src/` direkt laden (Alias `@/`, JSON), ohne tsx |

**Zutaten/Schritte/Tipps als JSON-Spalten**, nicht als Tabellen: sie werden immer als Ganzes gelesen und geschrieben, Reihenfolge und Gruppen gehören zu den Daten, nie wird einzeln abgefragt; die Zutaten-Tags werden beim Schreiben in `tags` abgelegt. Bei ~1.800 Zutatenzeilen gibt es keinen Grund für drei JOINs pro Liste.

**Felder je Rezept** zusätzlich zu den heutigen: `status` (veroeffentlicht | eingereicht | abgelehnt), `status_grund`, `quelle_url`, `quelle_key`, `plattform`, `herkunft` (obsidian | link | formular | sprache | admin), `eingereicht_von` (guestId), `eingereicht_name`, `pruefung` (JSON), `bildfokus`, `kartenbild`, `obsidian_datei` / `obsidian_original` / `obsidian_hash` / `obsidian_export_hash`, `erstellt_am`, `geaendert_am`, `freigegeben_am`. Das komplette Original-Markdown wird mitgespeichert, damit nichts verloren geht („Meine Notizen“, „Selbst gekocht“, Quelle-Zeilen im Body).

### Probelauf 17.10.2026 (lokal, Scratchpad)

- 187 Markdown-Dateien → 187 Rezepte, 0 Parser-Fehler, alle veröffentlicht, keine Dubletten über die Quelle
- Rundreise: 187/187 Rezepte in allen 21 Feldern gleich mit `parseRecipeFile()`
- Stichprobe 5 Rezepte (wikingertopf, overnight-chiapudding, wassermelonen-tacos, slow-cooker-meal-prep-basis, Pfirsich Hähnchen) gegen das rohe Markdown: je 18/18 Felder ok
- Bilder: 292 Datensätze (187 Profil, 93 KI, 10 Galerie, 1 selbst, 1 original), 217 MB, alle mit gleicher Prüfsumme wie im Vault; 25 Rezepte mit KI-Kartenbild
- 5 Bilddateien gehören zu keinem Rezept (`butter-chicken.jpg`, `cheesy-egg-beef-breakfast-rolls.jpg`, `kag-tta-tavuk-bonfile.jpg`, `mcp-test-pfannkuchen.jpg`, `rotkohl-granatapfel-salat.jpg`) → werden nach `bilder/_unzugeordnet` kopiert, nicht verworfen
- Zweiter Lauf: 0 neu, 187 übersprungen, 0 Bilder kopiert (idempotent)
- **Live-Vergleich** gegen rezepte.christianarns.de: 187 = 187, gleiche Slugs, gleiche Reihenfolge, alle 20 Felder der Lite-Liste gleich (inkl. Kartenbild/`imageIsAi` aus 90a7c41)

## Umbau in Reihenfolge

Vorher: die beiden parallelen Branches (`heute-gemerkt-1018`, `bildwahl-1018`) auf `main`, dann diesen Branch darauf rebasen. Der Import nutzt den Parser aus `recipes.ts`; nach deren Merge `pruefe-import.mjs` und `vergleich-live.mjs` noch einmal laufen lassen.

### Phase 1 · Lesen aus der DB, mit Schalter (≈ 4 h)

1. `src/lib/env.ts`: `RECIPE_SOURCE` (`obsidian` Default | `db`), `RECIPE_SERVER_KEY`.
2. `src/lib/recipes.ts`: `scanRecipes()`, `getRecipeBySlug()`, `focusOverrideFor()` verzweigen nach `RECIPE_SOURCE`; bei `db` → `recipeStore().list({ viewerGuestId: null })`. `deriveTags` exportieren (für neue Rezepte). `imagesDir()` liefert bei `db` `DATA_DIR/bilder`. `resolveImageFile()` vergleicht NFC-normalisiert (siehe Fallen).
3. `src/app/api/recipes/route.ts`: unverändert öffentlich und cachebar (ETag, Preload). Zusätzlich `?quelle=db|obsidian` nur mit `x-admin-pin`, für den Parallelvergleich.
4. `src/app/api/me/route.ts`: liefert `eigeneEinreichungen` (Status eingereicht/abgelehnt des Gasts). Die App mischt sie in Stapel/Raster ein. So bleibt die öffentliche Liste für alle gleich und cachebar.
5. `src/app/rezept/[slug]/page.tsx`: nur veröffentlichte (Server kennt den Gast nicht).
6. Neue Route `src/app/api/admin/recipes/import-obsidian/route.ts` (x-admin-pin): ruft `importiereObsidian()` im Container, liest den noch vorhandenen RO-Mount `/app/recipes`, schreibt `DATA_DIR/rezepte.db` + `DATA_DIR/bilder`. Gibt den Bericht zurück.
7. `CLAUDE.md` (Wichtige Dateien, Env-Tabelle, Datenfluss) im selben Schritt nachziehen.

### Phase 2 · Einreichung und Freigabe (≈ 8–10 h)

Verträge stehen in `src/lib/submission.ts` (Kommentar oben). Reihenfolge:

1. `src/app/api/admin/recipes/import/route.ts` (x-server-key): nimmt das ausgelesene Rezept von n8n, `pruefeRezept()`, Bild laden (URL oder Base64) → `DATA_DIR/bilder/<slug>.jpg`, speichern, Antwort mit `telegramText` + `adminUrl`. 409 bei gleicher Quelle.
2. `src/app/api/admin/recipes/route.ts` (GET Liste nach Status), `…/[slug]/status/route.ts` (ein Tipp: freigeben/ablehnen), `…/[slug]/route.ts` (PATCH Korrekturen).
3. `src/app/admin/page.tsx`: Reiter „Einreichungen“ — Karte mit Bild, Titel, Prüf-Ampel (Fehler rot, Hinweise gelb, Dubletten mit Link), Knöpfe **Freigeben** / **Ablehnen** / **Bearbeiten**.
4. `src/app/api/recipes/submit-link/route.ts` (Gast): Datensatz sofort anlegen (eingereicht, `pruefung.phase = "auslesen"`), n8n anstoßen. Bremse 10/Stunde/guestId.
5. `src/app/page.tsx`: Einreich-Sheet → Link-Feld nutzt `submit-link`; Profil „Meine Einreichungen“ mit Status (wird ausgelesen · wartet auf Freigabe · abgelehnt). Stapel blendet `phase: auslesen` aus.
6. **n8n WF10b** (`~/Projekte/06_Werkstatt/n8n-automationen/10. Rezept-Link … .json`):
   - „Kochbuch lesen“ / „Schon im Kochbuch?“ ersetzen: die App antwortet 409 bei Dublette.
   - „Rezept Schreiben“ + „Bild herunterladen/speichern“ ersetzen durch einen HTTP-Request an `/api/admin/recipes/import` (Claude soll JSON-Felder liefern statt Markdown: name, description, category, Makros, totalTime, portions, difficulty, ingredients[], steps[], tips[]; Prompt sonst gleich).
   - TikTok-Zweig: Apify `clockworks~tiktok-scraper` (Caption, Cover; Video für AssemblyAI nur mit Download-Zusatz).
   - Telegram: Text aus der Antwort. Christians eigene Telegram-Links mit `direktVeroeffentlichen: true`.
   - Upload per JSON-Import in n8n (Zugang ist hakelig, siehe Memory „n8n-Zugang“).
7. **n8n WF14** (Formular/Sprache): gleiches Ende, `herkunft: formular | sprache`, statt `01 Inbox/Neue Rezepte/`.
8. `src/app/api/recipes/submit/route.ts`: Backup in `DATA_DIR/einreichungen/` bleibt.

### Phase 3 · Backup und Obsidian-Kopie über den Mac-Runner (≈ 3 h)

Der Mac-Runner (`~/Projekte_Intern/Dashboard_Konsole/tools/auftrags-runner/`) kann beides, ohne dass die öffentliche App je in den Vault schreibt:

- **Backup** (`backup.mjs` um `sichereRezepte()` ergänzen, gleiches Muster wie die Dashboard-DB): nachts `GET /api/admin/backup` (x-server-key) → gzip-Kopie per `db.backup()` → entpacken, `PRAGMA quick_check`, `recipes ≥ 187` → Drive `Backups/Rezepte/rezepte-<Wochentag>.db.gz` + eine pro Monat. Bilder inkrementell: `GET /api/admin/bilder?seit=…` (Liste mit sha1), nur neue Originale laden. Der Weg über die Portainer-API (Exec im Container) ginge auch, ist aber zerbrechlicher (Token, Access-Schlüssel, Shell im Image) — Export-Endpunkt ist einfacher und testbar.
- **Obsidian-Export** (neu, z. B. `rezepte-export.mjs`): `GET /api/admin/recipes/export?seit=<Merker>` → für jedes neue/geänderte veröffentlichte Rezept `06 Research/Gerichte/<slug>.md` im Kochbuch-Template schreiben, fehlende Bilder nach `Bilder/`. Regeln: nur schreiben, wenn sich der Inhalt geändert hat (`obsidian_export_hash`); unveränderte Obsidian-Importe nie anfassen; vorhandenen Abschnitt „📝 Meine Notizen“ und alles darunter aus der bestehenden Datei übernehmen; **nie löschen**, abgelehnte/eingereichte nicht exportieren. Markdown-Bau als gemeinsame Funktion `src/lib/recipeMarkdown.ts` (Template aus `Kochbuch-Struktur.md`, Bau-Logik aus `api/recipes/submit` erweitert).
- Das Fokus Dashboard (`/rezepte`) und die Kochbuch-Base lesen weiter den Vault und sehen damit die Kopie.

### Phase 4 · Umschalten ohne Ausfall (≈ 1 h + eine Woche beobachten)

1. Image bauen und ausrollen, `RECIPE_SOURCE=obsidian` (nichts ändert sich sichtbar).
2. `RECIPE_SERVER_KEY` in Portainer setzen. Import auf dem Server: `POST /api/admin/recipes/import-obsidian`.
3. Gegenprobe: `vergleich-live.mjs` gegen `?quelle=db` und `?quelle=obsidian` — müssen gleich sein.
4. `RECIPE_SOURCE=db` setzen (Stack-Env, Portainer-API wie beim Ausrollen). Rückweg: Variable zurück, Mount ist noch da.
5. Direkt danach WF10b/WF14 auf die App-API umstellen. Zwischen Import und Umstellung neu im Vault gelandete Rezepte: Import noch einmal laufen lassen (idempotent, holt nur Neues).
6. Nach einer Woche ohne Auffälligkeiten: RO-Mount aus dem Stack nehmen (Christian), `Kochbuch-Struktur.md` und `00 System/config/Automationen.md` anpassen (Quelle der Wahrheit = App-DB, Obsidian = Kopie).

## Zeitschätzung

| Phase | Aufwand |
|---|---|
| 1 Lesen aus DB mit Schalter, Server-Import, Gegenprobe | 4 h |
| 2 Admin-Freigabe, Gast-Einreichung, Import-API | 5–6 h |
| 2 n8n WF10b + WF14 umbauen, TikTok, Test je Plattform | 3–4 h |
| 3 Backup + Obsidian-Export im Mac-Runner | 3 h |
| 4 Umschalten, Beobachten, Mount raus | 1 h |
| **Summe** | **16–18 h, rund 2½ Arbeitstage** |

Kleinste sinnvolle Lieferung: Phase 1 + Phase 4 Schritte 1–4 (≈ 5 h). Danach liest die App aus der DB, alles andere läuft wie bisher.

## Offen für Christian

- `RECIPE_SERVER_KEY` erzeugen und in Portainer + n8n-Credential hinterlegen.
- Kategorien: Kochbuch-Enum hat 9, die App zeigt 3 Gruppen. Bleibt so?
- Eigene Telegram-Links direkt veröffentlichen (Vorschlag: ja) oder auch über die Freigabe?
- Formular-Einreichungen weiter von Claude formatieren und Makros schätzen lassen (≈ 5 Cent) — Vorschlag: ja, gleiche Qualität wie Link-Rezepte.
- Die 5 Bilder ohne Rezept: behalten (liegen in `_unzugeordnet`), Rezepte fehlen vermutlich nach Umbenennung.

## Fallen (gelernt beim Probelauf)

- **Umlaute in Dateinamen (NFC/NFD):** macOS liefert aus `readdir` „Pfirsich Hähnchen.png“ zerlegt (NFD), das Frontmatter zusammengesetzt (NFC). `parseRecipeFile` gab auf dem Mac dasselbe Bild zweimal in der Galerie zurück. Der Import normalisiert auf NFC und entdoppelt; die Bild-Route muss den angefragten Namen ebenfalls NFC-normalisieren.
- **Groß/klein auf dem Mac:** `resolveImageFile("Protein-Pancakes.png")` liefert auf dem Mac die Frontmatter-Schreibweise, im Linux-Container den echten Namen `protein-pancakes.png`. Die DB speichert den echten Namen (wie live).
- **Lokales `main` war hinter `origin/main`** (90a7c41 Kartenbild fehlte). Vor dem Vergleich mit live immer `git fetch` und auf `origin/main` aufsetzen.
- **Node lädt die TS-Module direkt** (Typ-Stripping ab 23.6), braucht aber den Alias-Hook `tools/ts-laden.mjs`; JSON-Importe ohne `with { type: "json" }` lädt der Hook als Modul.
- **Platte voll:** Am 17.10.2026 waren auf dem Mac nur noch 149 MB frei, `npm ci` im Worktree brach mit ENOSPC ab. Worktrees deshalb mit Symlink auf das `node_modules` des Hauptrepos; Bilder werden per APFS-Klon kopiert (`COPYFILE_FICLONE`, kostet keinen Platz).
- **iCloud lagert Rezepte aus:** Am 17.10.2026 waren 155 von 188 Rezeptdateien auf dem Mac nur „dataless“ (Platzmangel). `readFileSync` blockiert dann den ganzen Next-Prozess, bis iCloud lädt, und das kam aus der Sitzung nie. Prüfen mit `ls -lO | grep dataless`. Lokale Tests mit einer Teilmenge (nur lokal vorhandene Dateien), der echte Import läuft auf dem Server (Syncthing hat alles). Der Mac-Runner prüft vor dem Lesen per `stat -f %Sf` und überspringt ausgelagerte Dateien.
- **Turbopack und verlinktes node_modules:** Im Worktree mit Symlink auf `../rezepte-swipe/node_modules` bricht `next dev` mit „Symlink … points out of the filesystem root“ ab. Lokal `next dev --webpack` nehmen; CI baut im echten Checkout und ist nicht betroffen.
- **Link-Webhook fehlte im Stack:** `N8N_LINK_WEBHOOK` stand bis 17.10.2026 nicht im Rezepte-Stack, Links aus der App gingen nie an n8n. Und in WF10b/WF14 stand statt der Chat-ID der Platzhalter `DEINE_TELEGRAM_CHAT_ID`: Telegram-Hinweise zu App-Einreichungen kamen nie an. Beides mit dem Umbau behoben.
