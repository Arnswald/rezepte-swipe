# 🍽️ Rezepte-Swipe

Öffentliche „Tinder für Rezepte"-App. Wisch dich durch Christians
Lieblingsrezepte — **rechts = lecker, links = nö, hoch = Superlike** — und reich
eigene Ideen ein. Läuft unter **rezepte.christianarns.de**.

Clean & modern im „Swipe for Dinner"-Look, mobile-first PWA (zum Homescreen
hinzufügbar). Die Rezepte kommen aus Christians Obsidian-Kochbuch
(`06 Research/Gerichte`), read-only gemountet.

## Quickstart (lokal)

```bash
npm install

# Rezept-Ordner auf den Vault zeigen:
export OBSIDIAN_RECIPES_PATH="…/Arns Obsidian Vault/06 Research/Gerichte"
export OBSIDIAN_IMAGES_PATH="$OBSIDIAN_RECIPES_PATH/Bilder"
export DATA_DIR="./data"

npm run dev     # → http://localhost:3000
```

Siehe `.env.example` für alle Variablen.

## Stack

Next.js 16 (standalone) · React 19 · Tailwind v4 · framer-motion · sharp (WebP)

## Wichtige Dateien

| Datei | Zweck |
|---|---|
| `src/app/page.tsx` | Swipe-Deck, Raster, Detail-Sheet, Vorschlag-Sheet |
| `src/lib/recipes.ts` | Rezept-Parser (liest Markdown + Frontmatter) |
| `src/app/api/recipes/image/[name]/route.ts` | Bild → WebP, mit Disk-Cache |
| `src/app/api/recipes/suggest/route.ts` | Gast-Vorschläge entgegennehmen |
| `docker-compose.yml` | Referenz-Setup (read-only Rezept-Mount) |
| `DEPLOYMENT.md` | Schritt-für-Schritt live auf die Subdomain |
| `CLAUDE.md` | Projekt-Briefing für Claude Code |

## Deployment

Push auf `main` → GitHub Actions baut das Image nach GHCR → Portainer zieht es
auf dem Umbrel → Cloudflare Tunnel serviert `rezepte.christianarns.de`.
Details in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

> **Sicherheit:** Diese App ist öffentlich und bekommt **nur** den Rezept-Ordner
> read-only — nie den ganzen Vault. Details in `CLAUDE.md`.
