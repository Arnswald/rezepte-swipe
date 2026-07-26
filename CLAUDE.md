# CLAUDE.md — Rezepte-Swipe (öffentliche Rezept-App)

> Briefing für jede neue Claude-Code-Session in diesem Projekt.

## Was ist das?

Eine **öffentliche „Tinder für Rezepte"-App**. Christian schickt Freund:innen
(und Melissa) einen Link, sie wischen durch seine Lieblingsrezepte:
**rechts = lecker, links = nö, hoch = Superlike**. Gäste können außerdem eigene
Rezept-Ideen einreichen („+ Vorschlag").

Die App ist aus dem **Fokus Dashboard** (`/rezepte`) herausgelöst und läuft
eigenständig unter **rezepte.christianarns.de**. Design: „Swipe for Dinner"-Look —
clean & modern, Creme + Terrakotta + Waldgrün, mobile-first PWA.

**Christian ist der einzige Betreiber.** Sprache im Code & UI: Deutsch, direkt.
Sein Primärgerät ist das iPhone → jede Änderung zuerst mobil denken.

## Tech-Stack

- **Next.js 16** (App Router, `output: "standalone"`), React 19, TypeScript
- **Tailwind v4** (Tokens in `globals.css`, warmes Theme ist der Default)
- **framer-motion** (Swipe-Physik, Sheets, Animationen)
- **sharp** (Rezept-Bilder PNG → WebP, on-the-fly + Disk-Cache)
- **gray-matter** (Frontmatter-Parsing der Rezept-Markdowns)
- Kein DB in v1. Likes liegen im `localStorage` des Gasts.

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
   src/app/page.tsx     → Swipe-Deck + Raster + Detail-Sheet + Vorschlag-Sheet
```

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

## Environment-Variablen

| Variable | Zweck | Beispiel |
|---|---|---|
| `OBSIDIAN_RECIPES_PATH` | Absoluter Pfad zum Rezept-Ordner (der RO-Mount) | `/app/recipes` |
| `OBSIDIAN_IMAGES_PATH` | Absoluter Pfad zum Bilder-Ordner | `/app/recipes/Bilder` |
| `OBSIDIAN_VAULT_PATH` | Fallback, wenn ganzer Vault gemountet (Dashboard-Modus) | — |
| `DATA_DIR` | Schreibbares Volume: Bild-Cache + Vorschläge | `/app/data` |
| `N8N_SUGGEST_WEBHOOK` | Optional: Vorschläge zusätzlich an n8n posten | — |
| `TZ` | Zeitzone für Vorschlags-Timestamps | `Europe/Berlin` |

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

- **v1 (live)**: Swipen (localStorage-Likes) + „Vorschlag einreichen". Kein Login.
- **Phase 2**: Name-Login pro Gast, Likes/Superlikes serverseitig gespeichert
  (SQLite via better-sqlite3), einfache Statistik. Kein Dashboard-Zugriff für Gäste.
- **Phase 3**: Superlike → n8n-Webhook → **Telegram**-Push an Christian.
  Admin-Backend (PIN) mit Auswertung: was wird am meisten geliked?
- Vorschläge → n8n → Obsidian-Inbox (`01 Inbox/Rezept-Vorschläge.md`) + Telegram.

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
