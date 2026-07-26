# DEPLOYMENT — rezepte.christianarns.de

Schritt-für-Schritt, wie die App live geht. Aufgebaut **genauso wie das Fokus
Dashboard** (GHCR-Image → Portainer auf dem Umbrel → Cloudflare Tunnel). Wo etwas
identisch zum Dashboard ist, steht „wie beim Dashboard".

Zeitbedarf: ~20–30 Min beim ersten Mal. Danach ist jedes Update ein `git push`.

---

## 0. Voraussetzungen (hast du schon)

- Umbrel läuft, **Portainer** erreichbar unter `http://192.168.2.201:9000`
- **cloudflared**-Container läuft (der Tunnel, über den `dashboard.christianarns.de` geht)
- Domain `christianarns.de` liegt bei **Cloudflare**
- GitHub-Account `Arnswald`

---

## 1. Code auf GitHub bringen (erledigt Claude)

Das private Repo **`Arnswald/rezepte-swipe`** ist angelegt und gepusht. Der
Push auf `main` startet automatisch **GitHub Actions** (`.github/workflows/deploy.yml`):
das Docker-Image wird gebaut und nach **GHCR** geladen:

```
ghcr.io/arnswald/rezepte-swipe:latest
```

**Prüfen:** GitHub → Repo → Tab **Actions** → der Job „Build & Deploy" muss grün
sein (dauert ~2–3 Min). Danach GitHub → dein Profil → **Packages** → dort taucht
`rezepte-swipe` auf.

---

## 2. GHCR-Image für den Server erreichbar machen

Das Package ist zunächst **privat**. Zwei Wege (nimm den, den du beim Dashboard
auch nutzt):

**A) Package auf „public" stellen (einfachster Weg)**
GitHub → Packages → `rezepte-swipe` → **Package settings** → **Change visibility**
→ *Public*. Das Image enthält nur die kompilierte App (keine Secrets, keine
Rezepte — die kommen erst zur Laufzeit über den Mount). Portainer kann es dann
ohne Login ziehen.

**B) Privat lassen + Portainer-Registry-Login**
Portainer → **Registries** → **Add registry** → *Custom*:
- URL: `ghcr.io`
- Username: `Arnswald`
- Password: ein **GitHub PAT** mit Scope `read:packages`
Dann beim Stack unten das Image aus dieser Registry ziehen.

> Nimm dieselbe Methode wie bei `focus-dashboard` — dann ist es konsistent.

---

## 3. Portainer-Stack anlegen

Portainer → **Stacks** → **Add stack** → Name: `rezepte-swipe` → **Web editor**,
und folgendes einfügen:

```yaml
services:
  rezepte-swipe:
    image: ghcr.io/arnswald/rezepte-swipe:latest
    container_name: rezepte-swipe
    restart: unless-stopped
    ports:
      - "3100:3000"          # 3100 ist frei (Dashboard belegt 3000)
    volumes:
      - rezepte-data:/app/data
      # NUR der Rezept-Ordner, READ-ONLY. Nicht den ganzen Vault!
      - "/syncthing-data/Obsidian/06 Research/Gerichte:/app/recipes:ro"
    environment:
      - TZ=Europe/Berlin
      - DATA_DIR=/app/data
      - OBSIDIAN_RECIPES_PATH=/app/recipes
      - OBSIDIAN_IMAGES_PATH=/app/recipes/Bilder

volumes:
  rezepte-data:
```

Dann **Deploy the stack**.

**Wichtig — der Mount-Pfad:** `/syncthing-data/Obsidian` ist der Ort, an dem
Syncthing deinen kompletten Vault auf dem Umbrel ablegt (identisch zum Dashboard).
Wir hängen davon **nur** den Unterordner `06 Research/Gerichte` read-only rein.
Der Pfad muss exakt existieren — sonst startet der Container nicht.

**Prüfen:** Container-Liste → `rezepte-swipe` läuft (grün). Log ansehen: keine
Fehler. Dann im Browser `http://192.168.2.201:3100` → die App muss erscheinen und
Rezepte zeigen. Zur Not `http://192.168.2.201:3100/api/recipes?diag=1` — dort muss
`recipesDirExists: true` und `recipeCount: 23` stehen.

---

## 4. Cloudflare Tunnel → rezepte.christianarns.de

Du hast schon einen Tunnel (für das Dashboard). Wir hängen nur einen **Hostname**
dran — **kein** neuer Tunnel nötig.

**Cloudflare Zero Trust Dashboard** (one.dash.cloudflare.com):
→ **Networks → Tunnels** → deinen Tunnel wählen → **Public Hostnames** →
**Add a public hostname**:

| Feld | Wert |
|---|---|
| Subdomain | `rezepte` |
| Domain | `christianarns.de` |
| Type | `HTTP` |
| URL | `rezepte-swipe:3000` *(Container-Name:Port)* |

> `rezepte-swipe:3000` funktioniert, wenn der `cloudflared`-Container und
> `rezepte-swipe` im **selben Docker-Netzwerk** sind (wie beim Dashboard). Falls
> nicht, nimm `192.168.2.201:3100`.

**Save**. Cloudflare legt den DNS-CNAME automatisch an. Nach ~1 Min ist
`https://rezepte.christianarns.de` live (TLS macht Cloudflare).

> **Alternative (config.yml-Tunnel):** Falls dein Tunnel über eine Datei
> konfiguriert ist statt über die UI, füge unter `ingress:` vor dem
> `service: http_status:404`-Fallback hinzu:
> ```yaml
>   - hostname: rezepte.christianarns.de
>     service: http://rezepte-swipe:3000
> ```
> und starte `cloudflared` neu.

---

## 5. Testen + auf den Homescreen

1. `https://rezepte.christianarns.de` am iPhone öffnen.
2. Durchwischen testen. Der **erste** Durchgang baut den Bild-Cache auf (etwas
   langsamer), ab dem zweiten ist alles flott.
3. **Safari → Teilen → „Zum Home-Bildschirm"** → die App startet dann im
   Vollbild wie eine native App (Icon + Splash sind eingebaut).
4. Link an Melissa & Freund:innen schicken. Fertig.

Eingegangene **Vorschläge** landen im Volume unter
`/app/data/rezept-vorschlaege.md` (in Portainer über das `rezepte-data`-Volume
einsehbar). In Phase 2 wird das an n8n → Obsidian-Inbox/Telegram gehängt.

---

## 6. Auto-Deploy bei jedem Push (optional, empfohlen)

Damit ein `git push` automatisch neu deployt:

1. Portainer → Stack `rezepte-swipe` → **Webhooks** → Webhook aktivieren → URL kopieren.
2. GitHub → Repo → **Settings → Secrets and variables → Actions** → **New secret**:
   - Name: `PORTAINER_WEBHOOK_URL`
   - Value: die kopierte URL
3. Ab jetzt: Push auf `main` → Image neu gebaut → Portainer zieht automatisch die
   neue `:latest` und startet den Container neu.

Ohne diesen Schritt musst du nach einem Push in Portainer manuell
**Recreate** (mit *Re-pull image*) klicken.

---

## 7. Troubleshooting

| Symptom | Ursache / Fix |
|---|---|
| Container startet nicht, „read-only file system" o. Pfad-Fehler | Mount-Pfad `06 Research/Gerichte` existiert nicht exakt so unter `/syncthing-data/Obsidian`. Pfad in Portainer prüfen (Groß/Klein, Leerzeichen). |
| App lädt, aber „Keine Rezepte gefunden" | `/api/recipes?diag=1` aufrufen. `recipesDirExists:false` → Mount falsch. `OBSIDIAN_RECIPES_PATH` muss auf `/app/recipes` zeigen. |
| Bilder kaputt / grau | `OBSIDIAN_IMAGES_PATH` prüft `/app/recipes/Bilder`. Ordner `Bilder` muss im gemounteten Rezept-Ordner liegen. |
| 502 auf der Subdomain | Container läuft nicht oder Tunnel-URL falsch. Erst `http://192.168.2.201:3100` testen (lokal). Läuft das → Tunnel-Hostname/Netzwerk prüfen. Läuft das nicht → Container-Log in Portainer. |
| Langsame Bilder | Nur beim allerersten Durchgang (Cache wird gebaut). Bleibt es langsam → Log auf `sharp`-Fehler prüfen. |
| Neues Rezept erscheint nicht | Muss es nicht neu bauen — Syncthing muss die neue `.md` + Bild auf den Server synchronisiert haben. Kurz warten, Seite neu laden. |

---

## Was NICHT tun

- **Niemals** den ganzen Vault in diese App mounten. Nur `06 Research/Gerichte:ro`.
- Den Rezept-Mount **nicht** auf `:rw` stellen — die App braucht keinen Schreibzugriff auf den Vault.
- Keine Secrets ins Repo oder in `docker-compose.yml` schreiben — die App hat in v1 keine.
