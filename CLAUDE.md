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
- **v4 (offen): Live-Match-Session** — gemeinsames Swipen in Echtzeit, beide Seiten
  bekommen das „Match für heute Abend"-Popup sofort (braucht Realtime/Polling).
- **v4 (offen): Richtiger Login** — Code/Magic-Link statt nur localStorage, damit
  Identität **geräteübergreifend** hält und die iOS-Safari-7-Tage-Storage-Löschung
  (greift nur ohne Home-Screen-PWA) umgangen wird. Bewusst zurückgestellt; ggf.
  später umsetzen, wenn der Freundeskreis wächst / Leute mehrere Geräte nutzen.
- **Offen**: Vorschläge → n8n → Obsidian-Inbox (`01 Inbox/Rezept-Vorschläge.md`).
  (Telegram-Push & n8n-Automationen aktuell **nicht** gewünscht.)
- **Ideen**: Reset/„nochmal von vorn" pro Gast, saisonale Trending-Gewichtung
  (Spargelzeit etc.), Gericht-Detail-Statistik im Admin, Export.

## Wichtige Dateien

| Datei | Zweck |
|---|---|
| `src/app/page.tsx` | Name-Gate, 3-Tab-Nav (Swipe/Raster/Account), Deck, Raster (Trending+Suche), Detail-Sheet, AccountView, Deep-Link `?rezept=` |
| `src/app/admin/page.tsx` | Admin-Auswertung (PIN-Gate + Dashboard) |
| `src/app/rezept/[slug]/page.tsx` | Teilbare, server-gerenderte Rezept-Seite (OG-Tags) |
| `src/components/ShareButton.tsx` | Teilen via `navigator.share`, Fallback Link-Copy |
| `src/lib/recipes.ts` | Rezept-Parser (+ `getRecipeBySlug` für die Detail-Seite) |
| `src/lib/db.ts` | better-sqlite3: `verdicts` + v3 `guests`/`connections`, Codes/Matches/Trending |
| `src/lib/env.ts` | Env-Zugriff (RECIPES-Pfade, DATA_DIR, ADMIN_PIN, SITE_URL, Webhook) |
| `src/app/api/verdict/route.ts` | POST: Verdict speichern/löschen (+ `ensureGuest`) |
| `src/app/api/friends/register/route.ts` | POST: Gast anlegen → Freundescode |
| `src/app/api/friends/connect/route.ts` | POST: per Code verbinden |
| `src/app/api/friends/matches/route.ts` | POST: Verbindungen + Matches („beide mögen es") |
| `src/app/api/admin/stats/route.ts` | GET (x-admin-pin): aggregierte Auswertung |
| `src/app/api/recipes/route.ts` | GET: alle Rezepte + Kategorien |
| `src/app/api/recipes/trending/route.ts` | GET: öffentliche Beliebtheits-Zähler (keine Namen) |
| `src/app/api/recipes/image/[name]/route.ts` | Bild → WebP, Disk-Cache |
| `src/app/api/recipes/suggest/route.ts` | Gast-Vorschläge entgegennehmen |
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
