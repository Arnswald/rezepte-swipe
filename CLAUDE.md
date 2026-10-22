# CLAUDE.md — Rezepte-Swipe (öffentliche Rezept-App)

> Briefing für jede neue Claude-Code-Session in diesem Projekt.

## Was ist das?

Eine **öffentliche „Tinder für Rezepte"-App**. Christian schickt Freund:innen
(und Melissa) einen Link, sie geben **einmalig ihren Namen** ein und wischen dann
durch seine Lieblingsrezepte: **rechts = lecker, links = nö, hoch = Superlike**.
Gäste können außerdem eigene Rezept-Ideen einreichen („+ Vorschlag").

Christian sieht unter **`/admin`** (PIN-geschützt) die Auswertung: beliebteste
Gerichte, wer was mag, letzte Aktivität.

Die App ist aus dem **Fokus Dashboard** (`/rezepte`) herausgelöst und läuft
eigenständig unter **rezepte.christianarns.de** (seit 27.07.2026 live). Design:
„Swipe for Dinner"-Look — clean & modern, Creme + Terrakotta + Waldgrün,
mobile-first PWA.

**Christian ist der einzige Betreiber.** Sprache im Code & UI: Deutsch, direkt.
Sein Primärgerät ist das iPhone → jede Änderung zuerst mobil denken.

**Stand (v2, 27.07.2026):** Name-Gate, Verdict-Backend (SQLite) und Admin-Seite
sind gebaut und lokal getestet. Damit sie live sind, muss der Stack in Portainer
neu ausgerollt werden (Image `:latest` neu ziehen) **und** `ADMIN_PIN` als Env
gesetzt sein — siehe `DEPLOYMENT.md`.

## Tech-Stack

- **Next.js 16** (App Router, `output: "standalone"`), React 19, TypeScript
- **Tailwind v4** (Tokens in `globals.css`, warmes Theme ist der Default)
- **framer-motion** (Swipe-Physik, Sheets, Animationen)
- **sharp** (Rezept-Bilder PNG → WebP, on-the-fly + Disk-Cache)
- **gray-matter** (Frontmatter-Parsing der Rezept-Markdowns)
- **better-sqlite3** (Verdict-Speicher in `DATA_DIR/rezepte.db`, synchron, kein ORM)
- Likes liegen zusätzlich im `localStorage` des Gasts (Quelle der Wahrheit für die
  UI: Favoriten, Undo). Das Backend ist für Christians Auswertung.

## Architektur / Datenfluss

**Seit 17.10.2026: Rezept-Datenbank.** Schalter `RECIPE_SOURCE` (`obsidian` | `db`). Mit `db`
liest die App `DATA_DIR/rezepte.db` (Tabellen `recipes`, `recipe_images`) und die Bilder aus
`DATA_DIR/bilder`; der Vault bekommt nur noch eine Kopie. Plan und Begründung:
`docs/plan-datenbank.md`.

```
Einreichung (Gast: Link/Formular/Sprache)      Christian: Link per Telegram
   POST /api/recipes/submit                       │
     → Datensatz „eingereicht“ (lib/einreichung)  │
     → n8n-Webhook (einreichung: <slug>)          │
              ▼                                   ▼
   n8n 10c (Link) / 14b (Formular, Sprache): auslesen, Claude → Kochbuch-Markdown
              │  POST /api/admin/recipes/import  (x-server-key)
              ▼
   uebernehmen(): parsen, prüfen (lib/submission), Bild → DATA_DIR/bilder
     Gast → „eingereicht“, Telegram mit Admin-Link · Christian → direkt „veröffentlicht“
              │
   /admin Einreichungen: Freigeben / Ablehnen (ein Tipp)
              │
   Mac-Runner (fokus-dashboard/tools/auftrags-runner/rezepte.mjs):
     nachts /api/admin/backup → Drive Backups/Rezepte · alle 30 Min /api/admin/recipes/export
     → Kopie nach 06 Research/Gerichte (nur `rezepte_app: true`-Dateien, Notizen bleiben)
     · Brücke: import-obsidian holt Rezepte, die noch direkt im Vault landen
```

Bis 17.10.2026 (und mit `RECIPE_SOURCE=obsidian`):

```
Obsidian-Vault (Christians Kochbuch)
  06 Research/Gerichte/*.md           ← Rezepte (Frontmatter + Sektionen)
  06 Research/Gerichte/Bilder/*.jpg   ← Fotos (Titelbild, _1, _selbst, _KI …)
        │  (Syncthing → Umbrel-Server)
        ▼
Container-Mount  /app/recipes  (READ-ONLY!)
        │
   src/lib/recipes.ts   → parst Rezepte (scanRecipes)
        │
   /api/recipes         → JSON (alle Rezepte + Kategorien + Diagnose)
   /api/recipes/image/[name]?w=800  → WebP, gecacht in DATA_DIR/image-cache
   /api/recipes/suggest → hängt Gast-Vorschlag an DATA_DIR/rezept-vorschlaege.md
        │
   src/app/page.tsx     → Name-Gate + Swipe-Deck + Raster + Detail + Vorschlag-Sheet

Verdict-Fluss (v2):
   Gast wischt → src/app/page.tsx postVerdict()
        │  POST /api/verdict  {guestId, name, slug, recipeName, category, verdict}
        ▼
   src/lib/db.ts (better-sqlite3, Tabelle `verdicts`, PK (guest_id, slug))
        ▲
   GET /api/admin/stats (Header x-admin-pin) ← src/app/admin/page.tsx (PIN-Gate)
```

- **Name-Gate**: `page.tsx` rendert `NameGate`, bis `rezepte-guest-name` +
  `rezepte-guest-id` (localStorage) gesetzt sind. Ohne Namen kein Wischen.
- **Undo** postet `verdict: null` → Zeile wird gelöscht.
- **Admin** (`/admin`): PIN in `sessionStorage`, gegen `ADMIN_PIN` (env) geprüft.

### Sicherheit / Privatsphäre — WICHTIGSTE Regel
Diese App ist **öffentlich erreichbar**. Sie bekommt deshalb **NUR den
Rezept-Ordner read-only** gemountet — **NIEMALS den ganzen Vault**. Journal,
Personen, CRM etc. dürfen für diese App nicht sichtbar sein. Der Container
schreibt **nie** in den Vault (Vorschläge gehen in ein separates `DATA_DIR`).

(Das Fokus Dashboard mountet den ganzen Vault read-write — das ist okay, weil
es hinter einem PIN/Cloudflare-Access liegt. Diese App nicht. Grenze niemals
aufweichen.)

## Rezept-Datenformat

Frontmatter (bei allen Rezepten konsistent):
`name`, `Kurzbeschreibung`, `kategorie`, `kalorien`, `protein`,
`kohlenhydrate`, `fette`, `Profilbild`, `erstellt`, `quelle?`.
Body-H2-Sektionen: `📋 Überblick` (Tabelle mit Gesamtzeit/Portionen/Schwierigkeit),
`🛒 Zutaten` (Gruppen fett, Items als `- [ ]`), `👨‍🍳 Zubereitung` (nummeriert),
`💡 Tipps`. Bild-Auflösung ist **case-insensitiv** (Linux-Container ist
case-sensitive, macOS/Frontmatter oft nicht).
Optional `bildfokus:` (seit 17.10.2026): wo im Titelbild das Gericht sitzt, z. B. `"50 70"` (x y in %),
`"70"` (nur senkrecht) oder `unten` / `oben links`. Übersteuert den automatischen Bildfokus. Gilt für das **Kartenbild**
(also fürs KI-Bild, wenn die Karte das KI-Bild zeigt).
Optional `kartenbild: ki | original` (seit 17.10.2026): welches Bild Karte, Raster, Detail-Kopf und Teilen-Vorschau zeigen.
Übersteuert die Einstufung in `src/lib/kartenbild.json` (siehe „Kartenbild“ unten). `ki` wirkt nur, wenn `<slug>_KI.jpg` existiert.

**Kategorien:** Am 27.07.2026 auf 3 reduziert (`Hauptgericht`, `Frühstück`, `Dessert`; „Salat" → Hauptgericht,
„Snack" → Dessert). Die verbindliche Liste in `00 System/config/Kochbuch-Struktur.md` hat aber 9 Werte, und die
Rezept-Automation schreibt danach: Stand 08.10.2026 sind 8 im Einsatz (Hauptgericht 63, Dessert 59, Frühstück 31,
Salat 14, Beilage 11, Sauce 5, Snack 4, Getränk 1). Ob wieder zusammengelegt wird, entscheidet Christian.
Die App zeigt die Kategorien dynamisch aus den Rezepten — neue Kategorien tauchen
also automatisch als Filter-Pill auf. Wenn Christian wieder eine Kategorie
mergen will: `kategorie:`-Frontmatter in `06 Research/Gerichte/*.md` ändern.

## Environment-Variablen

| Variable | Zweck | Beispiel |
|---|---|---|
| `OBSIDIAN_RECIPES_PATH` | Absoluter Pfad zum Rezept-Ordner (der RO-Mount) | `/app/recipes` |
| `OBSIDIAN_IMAGES_PATH` | Absoluter Pfad zum Bilder-Ordner | `/app/recipes/Bilder` |
| `OBSIDIAN_VAULT_PATH` | Fallback, wenn ganzer Vault gemountet (Dashboard-Modus) | — |
| `DATA_DIR` | Schreibbares Volume: Bild-Cache + Vorschläge + `rezepte.db` | `/app/data` |
| `ADMIN_PIN` | PIN für `/admin`. Ohne PIN ist die Admin-Seite gesperrt (503). | `4711` |
| `SITE_URL` | Öffentliche Basis-URL für absolute OG-/Teilen-Links. Default: prod. | `https://rezepte.christianarns.de` |
| `N8N_SUGGEST_WEBHOOK` | Optional: Vorschläge (Text/Sprache) an n8n posten (WF14) | — |
| `N8N_LINK_WEBHOOK` | Optional: Link im „Quelle"-Feld → Scraping-Automation (WF10b) | `https://n8n.christianarns.de/webhook/rezept-link` |
| `RECIPE_SOURCE` | `obsidian` (Default, liest den Mount) oder `db` (Rezept-Datenbank) | `db` |
| `RECIPE_SERVER_KEY` | Schlüssel für n8n und Mac-Runner, Header `x-server-key`. Auf dem Mac: `~/.config/second-brain/rezepte-server.key`, in n8n: Header-Auth-Credential „Rezepte-App Server-Schlüssel“ | 64 Hex-Zeichen |
| `TZ` | Zeitzone für Timestamps | `Europe/Berlin` |

## Deployment

- **CI**: Push auf `main` → GitHub Actions baut Docker-Image → **GHCR**; danach `node tools/ausrollen.mjs` (Stack 10 neu ziehen)
  (`ghcr.io/arnswald/rezepte-swipe:latest`) → triggert optional den
  Portainer-Redeploy-Webhook (`PORTAINER_WEBHOOK_URL` als Repo-Secret).
- **Host**: Umbrel (Portainer, lokal `192.168.2.201:9000`), Cloudflare Tunnel
  (`cloudflared`-Container) → `rezepte.christianarns.de`.
- **Details & Schritt-für-Schritt**: siehe `DEPLOYMENT.md`.
- Nach Änderungen an Bildern/Rezepten muss nichts neu gebaut werden — der
  RO-Mount ist live. Nur Code-Änderungen brauchen einen neuen Image-Build.
- **Bild-Cache**: liegt im `DATA_DIR`-Volume, überlebt Neustarts. Bei einem
  frischen Image ist er leer → der erste Durchwischen-Durchgang baut ihn auf.

## Lokal entwickeln

```bash
npm install
# Rezept-Ordner auf den echten Vault zeigen lassen:
export OBSIDIAN_RECIPES_PATH="/Users/christianarns/Library/Mobile Documents/iCloud~md~obsidian/Documents/Arns Obsidian Vault/06 Research/Gerichte"
export OBSIDIAN_IMAGES_PATH="$OBSIDIAN_RECIPES_PATH/Bilder"
export DATA_DIR="./data"
npm run dev            # http://localhost:3000
```

Schnelltest der API: `curl "http://localhost:3000/api/recipes?diag=1"`.

## Roadmap

- **v1 (live)**: Swipen (localStorage-Likes) + „Vorschlag einreichen". Kein Login. ✅
- **v2 (gebaut, 27.07.2026)**: Name-Gate (Pflicht), Verdicts serverseitig (SQLite),
  Admin-Auswertung `/admin` (PIN). Muss auf dem Server noch ausgerollt +
  `ADMIN_PIN` gesetzt werden. ✅ Code / ⏳ Deploy
- **v3 (LIVE seit 27.07.2026): Account & Match.** Grundsatz-Entscheidungen:
  - **3-Tab-Navigation** oben zentriert: **Swipe · Raster · Account**. „+ Vorschlag"
    ist aus dem Header raus und lebt jetzt auf der Account-Seite.
  - **Freundescode-Pairing** (KEIN Login): jeder Gast bekommt einen Code mit
    Namen drin (z.B. `MELI-4K2`). Man gibt den Code des anderen ein → Verbindung.
    Identität bleibt `guestId` im localStorage → **pro Gerät**, nicht
    geräteübergreifend. Bewusst so gewählt (Aufwand sparen).
  - **Matches = „beide mögen es"** (persistent): Schnittmenge der Likes/Superlikes
    zweier verbundener Gäste; Doppel-Superlike hervorgehoben. Live-Session
    („für heute Abend", Echtzeit) ist Phase v4.
  - **Raster = Trending**: Ecken-Badge zeigt aggregierte Like-/Superlike-Zahl
    (öffentlich, keine Namen) statt Kategorie-Icon; Sortierung nach Beliebtheit.
    **Suche** (schwebend unten, fadet beim Scrollen) filtert nach Name/Beschreibung.
  - **Kategorie-Labels gekürzt** (nur Anzeige): `Hauptgericht` → **„Gerichte"**.
    Vault-Frontmatter bleibt `Hauptgericht` — nur `CATEGORY_LABEL`-Map in `page.tsx`.
  - **Teilbare Rezept-Seiten** `/rezept/[slug]` (server-gerendert, OG-Tags → schöne
    WhatsApp-Vorschau). Teilen-Button nutzt `navigator.share`, Fallback WhatsApp/Copy.
  - **Match-Animation beim Swipen**: Swipt man rechts/hoch auf ein Gericht, das
    ein:e verbundene:r Freund:in **schon** mag, erscheint ein „Es ist ein Match!"-
    Overlay (framer-motion). Feuert für die Person, die das Paar komplettiert;
    der/die andere sieht es in „Eure Matches" (echtes Live-Notify für beide = v4).
    Backend: `/api/verdict` gibt bei like/super die passenden Partner zurück
    (`getMatchPartnersForSlug` in `db.ts`).
- **v3.1 (LIVE-fähig, 28.07.2026): Gruppen.** Echte Gruppen (mehrere Personen) mit
  teilbarem **Gruppencode** (Name drin, z.B. `FAMI-3K2`). In „Account": Gruppe
  erstellen / per Code beitreten / verlassen. **Gruppen-Ranking** = Gerichte
  sortiert nach „wie viele Mitglieder mögen es" (X/N), einstimmige grün + ✓ markiert.
  Admin (`/admin` → „Gruppen"): Gruppen anlegen, Mitglieder hinzufügen/entfernen,
  löschen. Tabellen `groups` + `group_members`; Ranking in `getGroupMatches`.
  Freundescodes sind im Admin sichtbar/kopierbar; Personen dort verbindbar/trennbar.
- **v5 (LIVE-fähig, 28.07.2026): Essensplan für heute Abend + Feinschliff.**
  - **Match-Animation:** schwebende **Küchen-Utensilien** (Kochtopf/Bestecke/
    Kochmütze/Suppe) statt Herzen.
  - **Gruppen-Einladungslink:** pro Gruppe „Einladungslink verschicken"
    (`navigator.share`, Link `/?gruppe=CODE`). Wer ihn öffnet, muss sich einen
    Account machen und tritt danach **automatisch** der Gruppe bei (Auto-Join beim
    App-Start, dann Account-Tab).
  - **„Essensplan für heute Abend"** (pro Gruppe, **nacheinander**, kein Realtime):
    Tabelle `evening_picks` — ein **getrennter, zurücksetzbarer** Swipe-Durchgang,
    **unabhängig** von den Dauer-Favoriten (`verdicts`). Account-Gruppenkarte:
    Button „🍳 Für heute Abend planen" → Swipe-Deck im **Abend-Modus** (Banner
    „Heute Abend · Gruppe", **nach Beliebtheit sortiert**, Neuer Abend/Fertig).
    Zwei Rankings pro Gruppe: **„Essensplan heute"** (Abend-Runde, X/N) +
    **„Beliebt in der Gruppe"** (Dauer-Favoriten). `/api/groups`-Actions
    `evening-pick` / `evening-reset`; `getEveningPlan`/`setEveningPick`/`resetEvening`.
- **v-future (offen): Live-Match-Session** — gemeinsames Swipen in **Echtzeit**,
  beide Seiten bekommen das „Match"-Popup sofort (braucht Realtime/Polling).
- **v4 (LIVE-fähig, 28.07.2026): Richtiger Login (Pflicht).** `AuthGate` (ersetzt
  das alte Name-Gate): **Registrieren / Einloggen** mit **Benutzername + Passwort**
  (kein E-Mail-Dienst; Passwort mit Node-`scrypt` gehasht, Tabelle `accounts`).
  Beim Registrieren wird ein bestehender anonymer `guestId` übernommen → Likes/
  Gruppen bleiben. Login gibt Identität **inkl. Server-Bewertungen** zurück; die App
  hydratisiert beim Öffnen über **`/api/me`** → Stand hält **geräteübergreifend**
  und übersteht die iOS-Safari-7-Tage-Löschung. „Abmelden" auf der Account-Seite.
  Routen: `/api/auth/register`, `/api/auth/login`, `/api/me`. guestId bleibt der
  Bearer (in localStorage); das Passwort ist der Weg, ihn woanders wiederzubekommen.
- **v6 (LIVE-fähig, 30.07.2026): Rezept-Einreichung mit Bild → n8n → Obsidian.**
  Vollformular „Rezept einreichen" (`SuggestSheet` in `page.tsx`): Name, Beschreibung,
  Kategorie, Zutaten/Zubereitung (Freitext, eine Zeile = ein Punkt), Tipps, Quelle,
  **Foto-Upload**. `/api/recipes/submit` (multipart): baut eine **fertige Vault-Template-
  `.md`** (Frontmatter gequotet, 🛒 als `- [ ]`, 👨‍🍳 nummeriert), konvertiert das Bild
  zu **WebP** (`sharp`), legt beides als Backup in `DATA_DIR/einreichungen/` ab **und**
  POSTet an `N8N_SUGGEST_WEBHOOK` (Bild als Base64). **Die App schreibt NIE in den Vault**
  — das Einsortieren macht **n8n** (Workflow `14. Rezepte-App Einreichung → Obsidian`
  im n8n-Repo: Webhook → Claude formatiert ins Template → `.md` + WebP in
  `01 Inbox/Neue Rezepte/`).
- **v7 (LIVE-fähig, 30.07.2026): Einreichung per Sprachnachricht + Telegram-Notify.**
  Einreich-Sheet hat einen Umschalter **Tippen / Sprechen** (`VoiceRecorder`,
  MediaRecorder, Tap-Start/Stop, Wiedergabe). Audio geht als `mode=audio` an
  `/api/recipes/submit` — die App transkribiert NICHT selbst, sondern reicht die
  Aufnahme (Base64) an n8n weiter. **Workflow 14** hat jetzt zwei Zweige: `mode=audio`
  → AssemblyAI (Upload/Transkript/Poll wie WF10) → Claude „aus Sprachnachricht";
  `mode=text` → Claude „aus Text". Beide → `01 Inbox/Neue Rezepte/`. Plus
  **Telegram-Benachrichtigung** an den Kochbuch-Bot bei jeder Einreichung — im
  Telegram-Node die eigene chatId eintragen. **Ohne Foto:** die App erinnert beim
  Absenden freundlich („Hast du ein Foto?", trotzdem absendbar), und **Workflow 14
  generiert dann ein KI-Bild** (Claude-Foto-Prompt → Imagen, wie WF10) als
  `Profilbild` (`{slug}.jpg`; mit Foto: `{slug}.webp`). Poll-Zähler nutzt `$runIndex`.
- **v8 (LIVE-fähig, 30.07.2026): Bewerten, Empfehlungen, Vorlieben + Feinschliff.**
  - **Swipe-Deck filtert Geswipte:** zeigt nur noch ungeswipte Gerichte (stabiler
    Snapshot). **„Nö" bleibt dauerhaft weg**, auch nach „Nochmal von vorn"/nächstem Tag
    (Reset = alles außer Abgelehnte). Snapshot wird nach `/api/me`-Hydration einmalig
    neu gebaut, solange noch nicht geswipt.
  - **Sterne-Bewertung nach dem Kochen** (getrennt vom Swipe-Verdict): 1–5 Sterne im
    Detail-Sheet („Schon gekocht?"), Profil-Sektion „Schon gekocht". Tabelle `ratings`,
    `/api/rating`, in `/api/me` mit ausgeliefert.
  - **Bewerten/Hinzufügen aus „Alle Gerichte":** Detail-Sheet hat Verdict-Buttons
    (Nö/Lecker/Superlike) + Sterne — funktioniert also auch ohne Swipen.
  - **Empfehlungen (zutatenbasiert):** `deriveTags` in `recipes.ts` (kuratiertes Lexikon
    → Tags wie hähnchen/pasta/käse/vegetarisch aus Name+Zutaten). Client baut ein
    Geschmacksprofil aus Likes/Superlikes/Sternen → **„Für dich"-Reihe** in Alle Gerichte
    **+ Swipe-Deck nach Geschmack sortiert** (`recipeScore`/`orderDeck` in `page.tsx`).
  - **„Was ich nicht mag" (schlank):** Freitext-Tags im Profil (Tabelle `preferences`,
    `/api/preferences`). Gerichte mit diesen Zutaten sinken im Raster/Deck + dezente
    Notiz im Detail. In `/api/me` mit ausgeliefert (geräteübergreifend).
  - **Header/Nav:** Logo + „Rezepte"-Text oben links **entfernt** → nur noch zentrierte
    3-Tab-Nav, aktiver Tab zeigt Label. Tabs: **Entdecken · Alle Gerichte · Profil**.
    Neues Logo **„Gabel & Swipe"** (`src/components/LogoMark.tsx`) dient nur als
    **Favicon/App-Icon** (`public/icon.svg` + PNGs neu generiert).
  - **DB-Migration:** neue Tabellen (`ratings`, `preferences`) entstehen automatisch via
    `CREATE TABLE IF NOT EXISTS` beim ersten Zugriff — kein manueller Schritt nötig.
- **v9 (LIVE-fähig, 30.07.2026): Koch-Verlauf + Profil-Umbau.**
  - **„Bereits gekocht (mit wem + Datum)"** = Koch-Verlauf: Tabelle `cook_events`
    (Autor + optional Partner + `cooked_on`), mehrere Einträge pro Gericht (Verlauf).
    Eingabe im Detail-Sheet („Bereits gekocht — festhalten"): Dropdown **mit wem**
    (aus den Verbindungen) + **Datum** + „Eintragen"; Verlaufsliste mit Löschen.
    Einträge sind für **Autor UND Partner** sichtbar (`getCookEventsForGuest` = author
    OR partner). `/api/cooked` (action add/remove); in `/api/me` mit `cooked` +
    `connections` (fürs Dropdown). Profil-Sektion **„Schon gekocht"** merged jetzt
    Sterne **und** Koch-Verlauf („Zuletzt TT.MM.JJJJ · mit Name").
  - **Profil-Reihenfolge** (per CSS `order`): Begrüßung → **Eure Matches** →
    **Meine Favoriten** → **Schon gekocht** → **Rezept einreichen** (akzentfarben,
    weiter oben) → Gruppen → Freundescode → Verbinden → Was ich nicht mag → Abmelden.
  - **Favoriten**: max. 10, Rest per „Alle N anzeigen" aufklappbar (`favsExpanded`).
- **v10 (Branch `heute-gemerkt-1018`, 17.10.2026): „Heute gemerkt“ + Design-Mängel aus `docs/review-2026-10-18.md`.**
  Dreht die v8-Regel um: **Nö gilt nur für heute.** Details im Abschnitt „Heute gemerkt“ unten.
- **Ideen**: saisonale Trending-Gewichtung (Spargelzeit etc.),
  Gericht-Detail-Statistik im Admin, Export, Sterne-Schnitt öffentlich anzeigen.

## Wichtige Dateien

| Datei | Zweck |
|---|---|
| `src/app/page.tsx` | Auth-Gate (Login), 3-Tab-Nav (Entdecken/Alle Gerichte/Profil), Deck (Snapshot, geswipte raus, geschmackssortiert), Raster (Trending+Suche+„Für dich"), Detail-Sheet (Verdict+Sterne), AccountView (Favoriten/Schon gekocht/Was ich nicht mag), Empfehlungslogik (`recipeScore`/`orderDeck`), Deep-Link `?rezept=` |
| `src/components/LogoMark.tsx` | Logo „Gabel & Swipe" (SVG-Komponente) — dient nur als Favicon/App-Icon |
| `src/app/admin/page.tsx` | Admin-Auswertung + Personen-Verwaltung (PIN-Gate, Löschen) |
| `src/app/rezept/[slug]/page.tsx` | Teilbare, server-gerenderte Rezept-Seite (OG-Tags) |
| `src/components/ShareButton.tsx` | Teilen via `navigator.share`, Fallback Link-Copy |
| `src/lib/recipes.ts` | Rezept-Parser (+ `getRecipeBySlug`) + `deriveTags` (Zutaten-Tags fürs Empfehlungs-Scoring) |
| `src/lib/day.ts` | Tageslogik „Heute“: `dayKey` (Tag beginnt 4:00 Europe/Berlin), `shiftDay`, `showYesterday` (4–12 Uhr). Server und Browser |
| `src/lib/db.ts` | better-sqlite3: `verdicts` + `swipe_days` (Tageseinträge, „Heute gemerkt“) + `guests`/`connections` + `groups`/`group_members` + `ratings` (Sterne) + `preferences` (Abneigungen) + `cook_events` (Koch-Verlauf, Autor+Partner+Datum), Codes/Matches/Trending/Gruppen-Ranking |
| `src/lib/guard.ts` | Bremse gegen Durchprobieren (Fehlversuche je IP: Login 10/15 Min, Admin-PIN 5/30 Min, Freundes-/Gruppencode 15/15 Min) + `checkAdminPin` (zeitkonstant) für alle Admin-Routen |
| `src/lib/env.ts` | Env-Zugriff (RECIPES-Pfade, DATA_DIR, ADMIN_PIN, SITE_URL, Webhook, RECIPE_SERVER_KEY) |
| `src/lib/recipeStore.ts` | Rezept-Datenbank: Schema, Migration (`schema_versionen`), list/get/insert/update/setStatus/Bilder/rename |
| `src/lib/obsidianImport.ts` | Übernahme aus dem Vault, idempotent (unverändert/in der App bearbeitet → bleibt) |
| `src/lib/einreichung.ts` | Platzhalter anlegen, `uebernehmen()` (Markdown von n8n → prüfen → speichern → Bild), Bild laden/speichern |
| `src/lib/submission.ts` | Plattform, Quelle-Schlüssel (Dubletten), Slug, Plausibilitätsprüfung, Telegram-Text |
| `src/lib/recipeMarkdown.ts` | DB-Rezept → Kochbuch-Markdown (für die Vault-Kopie, Rundreise verlustfrei) |
| `src/components/admin/Einreichungen.tsx` | Admin: offene/abgelehnte Einreichungen, Prüf-Ampel, Freigeben/Ablehnen |
| `src/app/api/admin/recipes/import/route.ts` | POST (x-server-key): n8n liefert ein Rezept |
| `src/app/api/admin/recipes/import-obsidian/route.ts` | POST: Vault → DB (Brücke, idempotent) |
| `src/app/api/admin/recipes/route.ts` · `[slug]/route.ts` · `[slug]/status/route.ts` | Admin: Liste, Korrektur (PATCH), Freigeben/Ablehnen |
| `src/app/api/admin/recipes/export/route.ts` · `admin/bild/[datei]` · `admin/backup` | Mac-Runner: Vault-Kopie, Originalbilder, DB-Sicherung |
| `src/app/api/einreichungen/route.ts` | POST: eigene Einreichungen eines Gasts (Profil „Meine Einreichungen“) |
| `src/app/api/auth/register/route.ts` | POST: Account anlegen (Benutzername+Passwort, übernimmt guestId) |
| `src/app/api/auth/login/route.ts` | POST: Login → Identität + Server-Bewertungen |
| `src/app/api/me/route.ts` | POST: Server-Stand (Verdicts, Sterne, Abneigungen, Freundescode, `swipeDays`) fürs Hydrieren |
| `src/app/api/verdict/route.ts` | POST: Swipe → Tageseintrag (`swipe_days`) + Dauerstand (`verdicts`, Nö überschreibt kein Like); `undo: true` setzt beides exakt zurück |
| `src/app/api/rating/route.ts` | POST: Sterne-Bewertung (1–5) speichern/löschen |
| `src/app/api/preferences/route.ts` | POST: „Was ich nicht mag"-Tags speichern |
| `src/app/api/cooked/route.ts` | POST (add/remove): Koch-Verlauf „bereits gekocht" (mit wem + Datum) |
| `src/app/api/friends/register/route.ts` | POST: Gast anlegen → Freundescode |
| `src/app/api/friends/connect/route.ts` | POST: per Code verbinden |
| `src/app/api/friends/matches/route.ts` | POST: Verbindungen + Matches („beide mögen es") |
| `src/app/api/groups/route.ts` | POST (action): Gruppen — overview/create/join/leave + Abend-Plan (evening-pick/evening-reset) |
| `src/app/api/admin/groups/route.ts` | GET/POST/DELETE (x-admin-pin): Gruppen listen/erstellen/Mitglieder/löschen |
| `src/app/api/admin/stats/route.ts` | GET (x-admin-pin): aggregierte Auswertung |
| `src/app/api/admin/persons/route.ts` | GET/DELETE (x-admin-pin): Personen listen + löschen (kaskadiert Verdicts+Verbindungen) |
| `src/app/api/admin/connections/route.ts` | POST/DELETE (x-admin-pin): zwei Personen verbinden/trennen |
| `src/app/api/recipes/route.ts` | GET: alle Rezepte + Kategorien. `?lite=1` ohne Zubereitung/Tipps (nutzt die App), `?slug=x` ein Rezept komplett (Detail lädt nach) |
| `src/app/api/recipes/trending/route.ts` | GET: öffentliche Beliebtheits-Zähler (keine Namen) |
| `src/app/api/recipes/image/[name]/route.ts` | Bild → AVIF/WebP/JPEG, Zuschnitt `ar` um den Bildfokus, Disk-Cache (`.v2.`-Schlüssel); alte `?w=`-URLs unverändert |
| `src/lib/imageFocus.ts` | Bildfokus je Bild (Median aus sharp attention/entropy + Essens-Score), gemerkt in `DATA_DIR/image-cache/focus-v1.json` |
| `src/app/api/recipes/submit/route.ts` | POST (multipart): volles Rezept + Bild → Template-.md + WebP in `DATA_DIR/einreichungen/` + n8n-Webhook |
| `src/app/api/recipes/suggest/route.ts` | Gast-Vorschläge (leichte Idee/Link) entgegennehmen |
| `src/components/ui/` | NumberFlow, Lens, AnimatedInput, Toast |
| `docker-compose.yml` | Referenz-Stack (RO-Mount, Envs) |
| `DEPLOYMENT.md` | Schritt-für-Schritt live + Redeploy + ADMIN_PIN |

## Fallen (gelernt, iPhone-Durchsicht 08.10.2026)

- **Lint lief nie:** FlatCompat + `eslint-config-next` 16 bricht mit „circular structure“ ab. Flat-Configs direkt importieren (`eslint.config.mjs`).
- **Sheets:** `max-h-[92vh]` ist in Safari zu hoch (vh = große Ansicht ohne Leisten) → `dvh`. Scrollende Sheets brauchen `overscroll-contain`, unten `env(safe-area-inset-bottom)`.
- **`navigator.share` abgebrochen** wirft `AbortError` → nicht in den Kopier-Fallback laufen.
- **iOS feuert nach einem Tipp emulierte Maus-Events** (mouseenter ohne mouseleave) → Hover-Effekte (Lupe) nach Touch sperren.
- **`touch-action` wirkt nur bis zum nächsten Scroll-Container** → `:where(*) { touch-action: manipulation }` in `globals.css`; framer-motion setzt am Drag-Element inline `none` und gewinnt.
- **Tipps im Vault** stehen als `**Titel:** Text` (Doppelpunkt in den Sternchen) → Parser darf keinen zweiten anhängen.
- **Headless-Test:** `next start` (Produktionsbuild) statt `next dev`, Chrome nur über `~/.local/bin/render-chrome --headless=new`. Messskripte der Durchsicht: CDP mit 390×844, Touch, 4G, CPU 4×.

## Fallen (Bug-Runde 09.10.2026)

- **Wisch-Knöpfe ohne Sperre:** zweiter Tipp in den 0,32 s Abflug traf dieselbe Karte und überschrieb das Urteil → `flying`-Ref in `SwipeDeck.commit`.
- **/api/me ersetzte den lokalen Stand** → fehlgeschlagene Swipes landen in `rezepte-pending-v1` und werden beim Öffnen nachgeschickt; Swipes dieser Sitzung (`touchedRef`) überleben die ältere Server-Antwort.
- **Undo** speichert je Swipe das vorherige Urteil (`history: {slug, prev}`), sonst löschte Undo nach „Nochmal von vorn" den Favoriten.
- **Abend-Modus teilt `index`/`history`** mit dem Entdecken-Stapel → Position in `savedDeckPos` merken und beim Verlassen zurückholen.
- **Bild-Route:** Next liefert `params` schon dekodiert (zweites `decodeURIComponent` → 500 bei „%“); Cache-Key mit Hash, „Käse“/„Köse“ kollidierten.
- **Test im eingebauten Browser-Bereich:** ist der Bereich ausgeblendet, läuft kein `requestAnimationFrame` → framer-Animationen hängen, Sheets schließen nicht. Kein App-Fehler; Logik per JS prüfen, Optik im Simulator.
- **Doppelte Rezepte im Vault** (gleicher Link, von Claude anders benannt): `scanRecipes` zeigt je Quelle nur eins (`sourceKey`, IG per Post-ID). Ursache abgestellt in WF10b („Schon im Kochbuch?“ vor dem Scrapen).
- **Layout seit 09.10.2026 wie Outfits** (`kleiderschrank/app/stil.css`): großer Titel oben, Glas-Leiste unten (`.glas-flaeche`/`.glas-linse` in `globals.css`, Markierung per `layoutId="tab-linse"`). Raster/Profil scrollen über die volle Höhe, Kopf schwebt mit Verlauf darüber (Höhe per ResizeObserver), unten fester Ausblender. Detail kompakt: Instagram + Eckdaten + Zutaten oben, Zubereitung/Tipps/Koch-Verlauf in `Collapsible`, Sheet am Griff wegziehbar (`useDragControls`).
- **iOS 26, Home-Bildschirm-App (09.10.2026):** mit Statusleiste `black-translucent` war der Viewport beim Start ~110 pt zu kurz (Leiste schwebte, Sheets endeten zu früh), erst ein Scroll korrigierte ihn. Jetzt `default` wie Outfits, `apple-mobile-web-app-capable` per `metadata.other`, und beim Start im Standalone-Modus 1 px Scroll und zurück. In Safari selbst ist die Lücke richtig (dort sitzt Safaris Leiste). Messseite: `vp-test.html` (nicht im Repo).
- **Filter nur drei Gruppen** (`catGroup`): Frühstück, Gerichte (alles außer Frühstück/Dessert), Dessert. Detail oben nur Nährwerte + „Video“, Bewertung/Gekocht/Teilen ganz unten, Lecker/Nö nur noch beim Wischen.
- **Login-Felder brauchen `autoComplete` und ein `<form>`**, sonst bietet iOS keinen Schlüsselbund an. Safari und Home-Bildschirm-App haben getrennten Speicher, dort muss man sich je einmal anmelden.
- **Optik-Test headless:** CDP-Skript mit `render-chrome`, 390×844, localStorage `rezepte-guest-name`/`-id` setzen, dann `[aria-label=…]` klicken und `Page.captureScreenshot`.
- **Offen (Entscheidung Christian):** Die guestId ist das einzige Geheimnis und wird über Matches/Gruppen an andere ausgeliefert. Richtige Lösung: Session-Cookie beim Login, guestId serverseitig ableiten (alle müssen sich einmal neu anmelden).

## Bilder & Ladezeit (perf-bilder-1018, 17.10.2026)

- **Jede Ansicht hat ihren Zuschnitt vom Server** (`SHAPES` in `page.tsx`: Karte 4:5, Raster 8:7, Mini 1:1, Favoriten 3:2, Detail/Teilen 16:10) plus `srcset`/`sizes`, AVIF mit WebP-Rückfall per `<picture>`. Format steht in der URL (`fmt=`), nicht im Accept-Header: Cloudflare cacht `/api/recipes/image/*.jpg` nach URL und ignoriert `Vary`.
- **Warum Bilder „nicht mittig“ waren:** Quellbilder sind 9:16 (Instagram-Standbild, Gericht unten, Gesicht/Schrift oben) oder 16:9 (KI). Detail (16:10) und Raster (8:7) schnitten stur mittig → Gesicht statt Teller. Jetzt um den Bildfokus, bei Hochformat nur nach unten (50–80 %). Ausreißer per `bildfokus:` im Frontmatter korrigieren.
- **Zuschnitt-Logik geändert?** `IMG_V` in `page.tsx` hochzählen (neue URLs, sonst halten Browser/Cloudflare ein Jahr den alten Ausschnitt) und den Cache-Schlüssel in der Bild-Route versionieren. Alte Cache-Dateien nicht löschen.
- **Erste Ansicht:** `/api/recipes?lite=1` wird per `<link rel=preload>` mit dem HTML geholt (darum kein `cache: "no-store"` beim fetch), Antwort mit ETag → 304 beim erneuten Öffnen. Vor dem Hydrieren und solange der Stapel baut: `DeckSkeleton` (CLS war 0,13 durch den Wechsel Scroll-↔Stapel-Layout und ein kurz aufblitzendes „Alles durchgeswiped!“).
- **Vorausladen:** im `SwipeDeck` als unsichtbare `<picture>` (Karten +3 bis +5), erst nachdem das vorderste Bild da ist.
- `scanRecipes` ist 20 s gemerkt, das Bilder-Verzeichnis 10 s (vorher ≈190 × `readdir` pro Anfrage).

## Kartenbild: Profilbild oder KI-Bild (bildwahl-1018, 17.10.2026)

- **Problem:** Viele Profilbilder sind Instagram-Standbilder mit Person (Gesicht, Oberkörper) oder Schrift, aber ohne erkennbares Gericht (Beispiel Spiegeleier: Mann im Tanktop mit Baguette). 94 Rezepte haben zusätzlich ein KI-Bild `<slug>_KI.jpg`.
- **`src/lib/kartenbild.json`:** alle 187 Profilbilder von Hand am Kontaktbogen (4:5-Zuschnitt um den Bildfokus, so wie die Karte ihn zeigt) eingestuft: `slug → { kategorie: gericht|person|schrift|unklar, quelle: ki|original, grund, kiPasst? }`. Stand: 144 gericht, 34 person, 4 schrift, 5 unklar. `quelle: ki` = kein Gericht zu sehen **und** ein passendes KI-Bild existiert (25 Rezepte). `kiPasst: false` = KI-Bild zeigt ein anderes Gericht (fluffy-jell-o, matthew-mcconaugheys-thunfischsalat, grillfackeln-mit-kraeuterbutter), dann bleibt das Original.
- **Logik (`recipes.ts`):** `image` ist jetzt das **Kartenbild**; alle Ansichten (Karte, Raster, Favoriten, Detail-Kopf, Teilen-/WhatsApp-Vorschau) nehmen es automatisch. Reihenfolge: Frontmatter `kartenbild` → `kartenbild.json` → Original. Das Kartenbild steht in `images` immer vorn, das Profilbild direkt dahinter (bleibt in der Galerie). Neue Rezepte, die nicht in der Datei stehen, zeigen das Original.
- **Kennzeichnung:** nur in der Detail-Galerie („1 / 2 · KI-Bild“ in der Zähler-Pille, bei nur einem Bild eigene kleine Pille). Auf der Karte bewusst nicht: dort stehen schon Kategorie, Zähler, „Rezept“-Knopf und Chips, ein weiteres Abzeichen wäre Unruhe; die KI-Bilder sind als Foto des Gerichts gemeint, die Offenlegung im Detail reicht.
- **Neue Rezepte einstufen:** Kontaktbogen bauen (Karten-Zuschnitt vom Server holen: `/api/recipes/image/<datei>?w=480&ar=4x5&fmt=webp&v=2`), ansehen, Eintrag in `kartenbild.json` ergänzen. Oder einfach `kartenbild: ki` ins Frontmatter.
- `bildfokus` hilft bei den Personen-Bildern ohne KI-Bild meist nicht: das Gericht sitzt am unteren Bildrand, der Fokus steht dort schon am Anschlag (80 %). Da hilft nur ein neues KI-Bild.

## Heute gemerkt (heute-gemerkt-1018, 17.10.2026)

- **Ablauf:** Entdecken zeigt **alle** Rezepte außer den **heute** bewerteten (rechts, links, hoch). Ab **4:00 Uhr Europe/Berlin** ist alles wieder im Stapel (`dayKey` = Berliner Datum von Zeit − 4 h). Sind alle für heute durch: `DayDone` mit „Heute gemerkt ansehen“ und „Nochmal alle ansehen“ (zeigt auch heute bewertete, Karte trägt „Heute gemerkt“; rechts ändert nichts, links nimmt aus „Heute“ heraus). Tageswechsel bei offener App: `visibilitychange`/`focus` + Minuten-Takt.
- **Profil oben:** „Heute gemerkt“ (Kacheln, Superlikes zuerst, Zeit, Tipp öffnet Detail) → „Gestern gemerkt“ (nur 4–12 Uhr, einklappbar) → „Insgesamt oft gemocht“ (an wie vielen Tagen gemocht, absteigend; ersetzt „Meine Favoriten“). Kopf im Stapel: „Heute N ♥“ (Tipp → Profil). Karte: Badge „♥ N×“ ab 2 Tagen.
- **Tabelle `swipe_days`** `(guest_id, slug, day, verdict, recipe_name, category, swiped_at)`, PK `(guest_id, slug, day)`: ein Eintrag je Gast, Gericht und Tag. **`verdicts` bleibt der Dauerstand** für Matches, Gruppen, Abend-Modus, Trending, Admin. Ein Nö überschreibt dort kein like/super mehr (`applySwipeVerdict`), sonst verschwände ein Favorit aus Matches, nur weil man heute keine Lust hatte.
- **Migration** läuft automatisch beim ersten DB-Zugriff nach dem Deploy (`migrate()` in `db.ts`, gezählt über `PRAGMA user_version`, jetzt 1): je `verdicts`-Zeile ein Tageseintrag am Tag von `updated_at` → alte Likes zählen als „1×“. `verdicts` wird nicht verändert. Personen löschen (Admin) räumt `swipe_days` mit ab.
- **Sync:** localStorage `rezepte-heute-v1` = `{ from, days: { day: { slug: {v, at} } }, before }` ist Quelle für die UI, Server ist Quelle der Wahrheit. `/api/me` liefert die Tage vorgestern…morgen einzeln und davor nur die Zählung (`likeCountsBefore`); eigene, noch nicht bestätigte Swipes (Sitzung + `rezepte-pending-v1`) gewinnen. Swipes schicken `day` + `swipedAt` mit; der Server nimmt `day` nur im Fenster vorgestern…morgen an (spät nachgeschickt, Uhr daneben), sonst heute. Pending-Schlüssel jetzt `slug|day`.
- **Test ohne Warten:** headless mit Fake-Uhr (CDP `Page.addScriptToEvaluateOnNewDocument` ersetzt `Date`), Uhrzeit 17.10. 20:00 → 18.10. 04:01. `day.ts` bekommt deshalb immer ein konkretes `Date`. Kein Test-Schalter im App-Code.

## Design-Runde und Home-Bildschirm-App (heute-gemerkt-1018, 17.10.2026)

- **Kontrast:** `--text-muted` `#776854` (4,7 : 1 Creme, 5,4 : 1 Weiß; auf `--surface-hover` nur 4,4). Für Deko (leere Sterne, Kreisränder) `--text-faint`.
- **Dunkelmodus-Leck:** `@custom-variant dark (&:where(.dark, .dark *))` in `globals.css`; ohne das schaltet Tailwind v4 `dark:` über die Systemeinstellung, obwohl die App fest hell ist.
- **Detail:** Zeit + Portionen als ruhige Zeile über den Zutaten (`fmtPortions`), Beschreibung ganz, Schritte offen in 16 px/1,6, alle Tippziele ≥ 44 px (gemessen 0 von 16 darunter, vorher 12). Destruktives fragt per `useConfirm()` (Portal an `<body>`, kein `window.confirm`): Gruppe verlassen, Abmelden, Koch-Eintrag löschen.
- **Raster:** Hero alle 7 statt 6 (+ `grid-flow-dense`) → bei 2 Spalten keine Löcher (vorher 31).
- **Home-Bildschirm-App, Leiste zu hoch beim Start (iOS 26):** WebKit meldet beim Start eine um ~60 pt zu kurze Viewport-Höhe, bis man scrollt/tippt; `100dvh` und `position: fixed; bottom` hängen beide daran, der 1-px-Scroll-Trick von 7ec0d2a reichte nicht. Jetzt: Inline-Skript im `<head>` setzt in der Standalone-App `html.standalone` + `--screen-h` (= `screen.height`, kein Messen des Viewports); `.app-h` = `max(100dvh, min(--screen-h, 100dvh + 2 × safe-area-top))`; Leiste, Suche und Ausblender sind `absolute` im App-Rahmen statt `fixed`. Ohne Statusleisten-Abstand (inset-top 0) bleibt es exakt bei 100dvh. **Nur headless simuliert, am iPhone bestätigen.** Sheets (`fixed inset-0`) hängen weiter am Viewport.
- **Kopf in Raster/Profil** scrollt jetzt mit dem Inhalt; oben bleibt nur ein Ausblender in Höhe Statusleiste + 14 px (vorher lag ein hoher Verlauf über Titel und Chips).
- **Messskripte** (CDP, `render-chrome`, 390×844 @3x, Touch, `Emulation.setSafeAreaInsetsOverride` 59/34): nicht im Repo; Screenshots vorher/nachher lagen beim Bau in `docs/heute-gemerkt/` (nicht eingecheckt).

## Konventionen

- **Copy-Paste-Texte** (Mails etc.) immer als Plaintext, kein Markdown.
- **Mobile-first**: Swipe-Ansicht muss ohne Seiten-Scroll auf einen iPhone-Screen
  passen — Karte flext (Foto füllt), Buttons sitzen fix unten. Höhe wird über
  `h-[100dvh]` + Flex gesteuert; wenn's mal klemmt, ist es eine Zahl in `page.tsx`.
- **Deploy-Workflow (WICHTIG): der Push auf `main` IST das Live-Schalten** (Push → CI baut Image → Portainer).
  Seit 25.08.2026 gilt Christians globale Regel: **committen und pushen nur auf Ansage** (die App ist öffentlich,
  Freund:innen benutzen sie). Also: Änderung auf einem Branch fertig machen, `npm run lint` + `npm run build` grün,
  Christian sagen, was sich ändert, nach seinem Okay auf `main` und pushen. (Bis 08.10.2026 stand hier „ohne Rückfrage
  direkt pushen“, das widersprach der globalen Regel.)
  - **Voraussetzung für echtes Auto-Deploy:** das Repo-Secret `PORTAINER_WEBHOOK_URL`
    muss gesetzt sein (Portainer-Stack → Webhooks → URL → GitHub Secret). Ist es
    **nicht** gesetzt, baut der Push nur das Image — der Container zieht `:latest`
    erst nach manuellem „Recreate (Re-pull image)" in Portainer. Dann Christian
    kurz erinnern. Status prüfbar im CI-Log-Step „Trigger Portainer redeploy".
- Beziehung zum Dashboard: Die Swipe-UI stammt aus `Fokus Dashboard/src/app/rezepte`.
  Diese App ist ab jetzt die **kanonische** Version. Verbesserungen hier machen;
  ins Dashboard nur zurückportieren, wenn Christian die interne Ansicht behalten will.
```

- **App-Symbol (08.10.2026):** im Stil der dunklen iPhone-Standard-Apps (dunkler Verlauf, Gabel in Terrakotta, Wisch-Bogen zart): `public/apple-touch-icon-v2.png`, `icon-192-v2.png`, `icon-512-v2.png`; Quelle `tools/icon/gabel.svg` + `tools/icon/ios2.swift` (`swift ios2.swift gabel.svg out.png 0.74`). Neue Dateinamen, weil iOS Symbole festhält; alte Dateien bleiben.
- **Ausrollen ohne Klicken (08.10.2026):** `PORTAINER_WEBHOOK_URL` ist nicht gesetzt, CI baut nur das Image. Der Container lief deshalb vom 31.07. bis 08.10. unverändert. Ausrollen per Portainer-API wie das Dashboard-Autodeploy: Stack 10 (`rezepte-swipe`) mit `PUT /api/stacks/10?endpointId=1 {stackFileContent, env, pullImage: true}`, Zugang über portainer.christianarns.de (Cloudflare-Access-Dienstschlüssel + Portainer-Token in ~/.config/second-brain/).

## Feinschliff-Runde 21.10.2026 (Christian auf dem iPhone)

- **Stapel ohne Nachladen:** vordere und hintere Karten sind EINE Liste mit dem Slug als Schlüssel. Rückt eine Karte nach vorne, bleibt sie dasselbe Element mit demselben, schon dekodierten Bild (geprüft: gleiches `<img>`, `complete`). Vorher waren es getrennte Bäume, die nachrückende Karte wurde neu aufgebaut und sprang. Badges auf der Karte ohne `backdrop-blur` (kostet beim Wischen jedes Bild).
- **Kategorien:** vier Gruppen (Frühstück · Hauptgang · Snacks & Co · Dessert) als gleich breite Leiste, kein „Alle“ mehr; aktive Gruppe nochmal antippen = Filter aus. Hauptgang = Hauptgericht + Salat (+ Suppe), Snacks & Co = Snack, Beilage, Sauce, Getränk.
- **Oben kein Verlauf mehr** in Raster und Profil: nur eine glatte Fläche in Höhe der Statusleiste.
- **Rezept-Fenster:** Titel + Beschreibung (2 Zeilen, antippen = ganz) oben, darunter die Bilder (3:2, ohne Verlauf), Zubereitung und Tipps zugeklappt, Bewerten + Gekocht in einer Klappe, Teilen entfernt. Nach unten ziehen schließt von überall, solange der Inhalt oben steht (eigene Touch-Logik, `touchmove` nicht passiv).
- **Heute gemerkt bearbeiten:** Gedrückt halten (0,45 s) → Wackel-Modus mit ✕ wie auf dem Homescreen. Entfernen = heute „Nö“; das dauerhafte Like bleibt nur, wenn an einem anderen Tag gemocht.
- **Kartenbilder:** 27 Karten per `PATCH /api/admin/recipes/<slug>` `{cardImage}` auf das vorhandene `_KI`-Bild gestellt (Prüfung aller 202 Kartenbilder, Liste im Scratchpad der Sitzung). 48 Rezepte haben kein Bild mit fertigem Gericht und brauchen ein neues KI-Bild.
- **Szenen aus den Videos (21.10.2026):** `tools/video-szenen.mjs` zieht per yt-dlp (ohne Login, kostenlos) und ffmpeg je Video 10 Kandidaten und einen nummerierten Bogen; ausgewählt wird per Auge (Claude liest die Bögen), hochgeladen per `hochladen auswahl.json` an `POST /api/admin/recipes/<slug>/bild`. Zeigt ein Kandidat das fertige Gericht, wird er Kartenbild: echtes Bild vor KI-Bild. Nur wo das Video das Gericht nie fertig zeigt: `tools/ki-kartenbild.mjs` (fal.ai nano-banana/edit, ~0,04 USD, Vorlage = Original-Standbild). Falle: dem Homebrew-ffmpeg fehlt `drawtext`, Bogen deshalb mit Pillow.
- **Automatik für neue Rezepte (21.10.2026):** Der Mac-Runner (`fokus-dashboard/tools/auftrags-runner/rezepte-bilder.mjs`) nimmt alle 30 Min bis zu 3 Rezepte mit Video und ohne Szenen, zieht Kandidaten, lässt Claude (CLI, Sonnet, nur Read) Szenen und Karte wählen, lädt hoch und generiert nur bei Bedarf ein KI-Bild (danach Prüfung auf Schrift/Person, sonst `--ohne-vorlage`). Höchstens 2 Versuche je Rezept, Anmeldefehler der CLI zählen nicht. Falle: Bei manchen Reels ist der Ton länger als das Bild, deshalb Länge der Bildspur nehmen und bei Fehler früher greifen. Bilder entfernen: `DELETE /api/admin/recipes/<slug>/bild?datei=` (Datei nach `bilder/_entfernt`).
- **Runde 22.10.2026:** Raster ohne framer-`layout` je Kachel und ohne backdrop-blur, Kacheln mit `content-visibility: auto`, `RecipeGrid` als `memo`; die schwebende Suche (mit Scroll-Handler, der bei jedem Scrollen die ganze Seite neu renderte) ist weg, die Suche sitzt oben unter den Kategorien (16 px, sonst zoomt iOS). Titel Entdecken/Alle Gerichte um 10 px eingerückt. Rezept-Fenster: Nährwerte, Video und Zeit über den Bildern. Home-Bildschirm-App: Dokument scrollt nicht mehr (`html.standalone` overflow hidden), vorher rutschte die Seite beim Hochwischen unter den iOS-Weichzeichner der Statusleiste; Kopf 1,1 rem unter der Statusleiste. Rezepte ohne Szenen mit lockerer Auswahl (Person darf mit im Bild sein) nachgezogen.
- **Profil 22.10.2026:** Heute gemerkt nach Zeit (zuletzt Gewischtes oben), Oft gemocht 6 + „Alle anzeigen“, Schon gekocht 4 + „Alle anzeigen“. Freundescode, Verbinden, Matches und Gruppen ersetzt durch eine Karte „Zu zweit“ (ohne Verbindung: Code teilen + verbinden; verbunden: „Mit Name“, gemeinsam gemocht als Kacheln, 6 + aufklappen, „Weitere Person verbinden“ eingeklappt). Gruppen und Abend-Modus sind im Profil nicht mehr erreichbar (API und Abend-Stapel bestehen weiter).
