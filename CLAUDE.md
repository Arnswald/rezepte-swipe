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
- **Phase 3 (offen)**: Superlike → n8n-Webhook → **Telegram**-Push an Christian
  (Env `N8N_SUGGEST_WEBHOOK` existiert schon für Vorschläge; für Superlikes
  analog einen Webhook-Post in `handleVerdict` ergänzen).
- **Offen**: Vorschläge → n8n → Obsidian-Inbox (`01 Inbox/Rezept-Vorschläge.md`).
- **Ideen**: Reset/„nochmal von vorn" pro Gast, geteilte Favoriten-Liste,
  Gericht-Detail-Statistik im Admin, Export.

## Wichtige Dateien

| Datei | Zweck |
|---|---|
| `src/app/page.tsx` | Name-Gate, Swipe-Deck, Raster, Detail-Sheet, Vorschlag-Sheet |
| `src/app/admin/page.tsx` | Admin-Auswertung (PIN-Gate + Dashboard) |
| `src/lib/recipes.ts` | Rezept-Parser (Markdown + Frontmatter → Recipe) |
| `src/lib/db.ts` | better-sqlite3: `verdicts`-Tabelle, upsert/delete/getAll |
| `src/lib/env.ts` | Env-Zugriff (RECIPES-Pfade, DATA_DIR, ADMIN_PIN, Webhook) |
| `src/app/api/verdict/route.ts` | POST: Verdict speichern/löschen |
| `src/app/api/admin/stats/route.ts` | GET (x-admin-pin): aggregierte Auswertung |
| `src/app/api/recipes/route.ts` | GET: alle Rezepte + Kategorien |
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
- **Nach jeder Änderung**: `npm run build` grün, dann committen + pushen.
- Beziehung zum Dashboard: Die Swipe-UI stammt aus `Fokus Dashboard/src/app/rezepte`.
  Diese App ist ab jetzt die **kanonische** Version. Verbesserungen hier machen;
  ins Dashboard nur zurückportieren, wenn Christian die interne Ansicht behalten will.
```
