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

**Kategorien:** bewusst auf **3** reduziert — `Hauptgericht`, `Frühstück`,
`Dessert` (Stand 27.07.2026; „Salat" wurde zu Hauptgericht, „Snack" zu Dessert).
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
| `N8N_SUGGEST_WEBHOOK` | Optional: Vorschläge zusätzlich an n8n posten | — |
| `TZ` | Zeitzone für Timestamps | `Europe/Berlin` |

## Deployment

- **CI**: Push auf `main` → GitHub Actions baut Docker-Image → **GHCR**
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
| `src/lib/db.ts` | better-sqlite3: `verdicts` + `guests`/`connections` + `groups`/`group_members` + `ratings` (Sterne) + `preferences` (Abneigungen) + `cook_events` (Koch-Verlauf, Autor+Partner+Datum), Codes/Matches/Trending/Gruppen-Ranking |
| `src/lib/env.ts` | Env-Zugriff (RECIPES-Pfade, DATA_DIR, ADMIN_PIN, SITE_URL, Webhook) |
| `src/app/api/auth/register/route.ts` | POST: Account anlegen (Benutzername+Passwort, übernimmt guestId) |
| `src/app/api/auth/login/route.ts` | POST: Login → Identität + Server-Bewertungen |
| `src/app/api/me/route.ts` | POST: Server-Stand (Verdicts, Sterne, Abneigungen, Freundescode) fürs Hydrieren |
| `src/app/api/verdict/route.ts` | POST: Verdict speichern/löschen (+ `ensureGuest`) |
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
| `src/app/api/recipes/route.ts` | GET: alle Rezepte + Kategorien |
| `src/app/api/recipes/trending/route.ts` | GET: öffentliche Beliebtheits-Zähler (keine Namen) |
| `src/app/api/recipes/image/[name]/route.ts` | Bild → WebP, Disk-Cache |
| `src/app/api/recipes/submit/route.ts` | POST (multipart): volles Rezept + Bild → Template-.md + WebP in `DATA_DIR/einreichungen/` + n8n-Webhook |
| `src/app/api/recipes/suggest/route.ts` | Gast-Vorschläge (leichte Idee/Link) entgegennehmen |
| `src/components/ui/` | NumberFlow, Lens, AnimatedInput, Toast |
| `docker-compose.yml` | Referenz-Stack (RO-Mount, Envs) |
| `DEPLOYMENT.md` | Schritt-für-Schritt live + Redeploy + ADMIN_PIN |

## Konventionen

- **Copy-Paste-Texte** (Mails etc.) immer als Plaintext, kein Markdown.
- **Mobile-first**: Swipe-Ansicht muss ohne Seiten-Scroll auf einen iPhone-Screen
  passen — Karte flext (Foto füllt), Buttons sitzen fix unten. Höhe wird über
  `h-[100dvh]` + Flex gesteuert; wenn's mal klemmt, ist es eine Zahl in `page.tsx`.
- **Deploy-Workflow (WICHTIG): jede Änderung geht direkt live.** Nach jeder
  Änderung: `npm run build` grün → **direkt auf `main` committen UND pushen**, ohne
  Rückfrage und ohne Feature-Branch. Christian will nicht extra sagen müssen „mach
  es live" — der Push IST das Live-Schalten. (Push → CI baut Image → Portainer.)
  - **Voraussetzung für echtes Auto-Deploy:** das Repo-Secret `PORTAINER_WEBHOOK_URL`
    muss gesetzt sein (Portainer-Stack → Webhooks → URL → GitHub Secret). Ist es
    **nicht** gesetzt, baut der Push nur das Image — der Container zieht `:latest`
    erst nach manuellem „Recreate (Re-pull image)" in Portainer. Dann Christian
    kurz erinnern. Status prüfbar im CI-Log-Step „Trigger Portainer redeploy".
- Beziehung zum Dashboard: Die Swipe-UI stammt aus `Fokus Dashboard/src/app/rezepte`.
  Diese App ist ab jetzt die **kanonische** Version. Verbesserungen hier machen;
  ins Dashboard nur zurückportieren, wenn Christian die interne Ansicht behalten will.
```
