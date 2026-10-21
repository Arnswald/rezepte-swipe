// Szenen aus dem Rezept-Video (21.10.2026). Zwei Schritte, damit vor dem Hochladen jemand hinsieht:
//
//  1) Kandidaten ziehen (kostenlos: yt-dlp ohne Login, ffmpeg):
//       node tools/video-szenen.mjs kandidaten <slug …> | --alle
//     → ./szenen/<slug>/k-01.jpg … k-10.jpg und ./szenen/<slug>/bogen.jpg (nummeriert)
//     10 Bilder gleichmäßig über das Video, je Abschnitt kurz nach einem Szenenwechsel, die
//     erste Sekunde (Hook-Text) übersprungen. Rezepte mit vorhandenen Szenen werden übersprungen.
//
//  2) Auswahl hochladen:
//       node tools/video-szenen.mjs hochladen auswahl.json
//     auswahl.json: { "<slug>": { "szenen": [3, 5, 8], "karte": 10 | null } }
//     szenen → Galerie (rolle galerie, Name <slug>_szene-N.jpg), karte → zusätzlich Kartenbild.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const H = homedir();
const SERVER_KEY = readFileSync(join(H, ".config/second-brain/rezepte-server.key"), "utf8").trim();
const APP = "https://rezepte.christianarns.de";
const UA = { "User-Agent": "curl/8.7.1" };
const ANZAHL = 10;
const BOGEN_PY = `
import sys
from PIL import Image, ImageDraw, ImageFont
d, n = sys.argv[1], int(sys.argv[2])
W, Hh = 216, 384
bogen = Image.new("RGB", (W * 5, Hh * ((n + 4) // 5)), "black")
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 34)
for i in range(n):
    im = Image.open(f"{d}/k-{i+1:02d}.jpg").convert("RGB")
    im.thumbnail((W, Hh))
    x, y = (i % 5) * W + (W - im.width) // 2, (i // 5) * Hh + (Hh - im.height) // 2
    bogen.paste(im, (x, y))
    dr = ImageDraw.Draw(bogen)
    dr.rectangle([(i % 5) * W, (i // 5) * Hh, (i % 5) * W + 46, (i // 5) * Hh + 44], fill="black")
    dr.text(((i % 5) * W + 8, (i // 5) * Hh + 4), str(i + 1), fill="white", font=font)
bogen.save(f"{d}/bogen.jpg", quality=82)
`;
const [modus, ...rest] = process.argv.slice(2);
const sh = (cmd, a) => execFileSync(cmd, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
const holeRezept = async (slug) => (await (await fetch(`${APP}/api/recipes?slug=${encodeURIComponent(slug)}`, { headers: UA })).json()).recipe;
const istVideo = (u) => /instagram\.com|tiktok\.com|youtube\.com|youtu\.be/i.test(u ?? "");

async function kandidaten(slug) {
  const r = await holeRezept(slug);
  if (!istVideo(r?.source)) return console.log(slug, "→ kein Video-Link");
  if (r.images.some((i) => /_szene-\d/i.test(i))) return console.log(slug, "→ hat schon Szenen");
  const dir = join("szenen", slug);
  if (existsSync(join(dir, "bogen.jpg"))) return console.log(slug, "→ Bogen schon da");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try { sh("yt-dlp", ["-q", "--no-warnings", "--socket-timeout", "30", "-f", "mp4/best", "-o", join(dir, "video.%(ext)s"), r.source]); } catch (e) { /* unten geprüft */ }
  const video = readdirSync(dir).find((f) => f.startsWith("video."));
  if (!video) return console.log(slug, "→ kein Video (Bildbeitrag oder gesperrt)");
  const vpath = join(dir, video);
  const dauer = Number(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", vpath]).trim());
  if (!(dauer > 3)) { rmSync(vpath, { force: true }); return console.log(slug, "→ zu kurz"); }
  let log = "";
  try { log = execFileSync("sh", ["-c", `ffmpeg -hide_banner -i "${vpath}" -vf "select='gt(scene,0.25)',showinfo" -f null - 2>&1`], { encoding: "utf8", maxBuffer: 64 << 20 }); } catch (e) { log = String(e.stdout ?? ""); }
  const start = Math.min(1.2, dauer * 0.1), teil = (dauer - start) / ANZAHL;
  const wechsel = [...log.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t > start && t < dauer - 0.3);
  for (let i = 0; i < ANZAHL; i++) {
    const a = start + i * teil, b = a + teil;
    const w = wechsel.find((t) => t >= a && t < b - 0.4);
    const t = Math.min(dauer - 0.15, w ? w + 0.35 : a + teil / 2);
    sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(2), "-i", vpath, "-frames:v", "1", "-q:v", "2", join(dir, `k-${String(i + 1).padStart(2, "0")}.jpg`)]);
  }
  rmSync(vpath, { force: true });
  // Nummerierter Bogen 5 × 2 (Pillow; dem Homebrew-ffmpeg fehlt drawtext)
  sh("python3", ["-c", BOGEN_PY, dir, String(ANZAHL)]);
  console.log(slug, `→ ${ANZAHL} Kandidaten (${dauer.toFixed(0)} s, ${wechsel.length} Schnitte)`);
}

async function hochladen(datei) {
  const auswahl = JSON.parse(readFileSync(datei, "utf8"));
  for (const [slug, a] of Object.entries(auswahl)) {
    const r = await holeRezept(slug);
    if (!r) { console.log(slug, "→ Rezept fehlt"); continue; }
    if (r.images.some((i) => /_szene-\d/i.test(i))) { console.log(slug, "→ hat schon Szenen, übersprungen"); continue; }
    const nummern = [...new Set([...(a.szenen ?? []), ...(a.karte ? [a.karte] : [])])];
    let n = 0;
    for (const k of a.szenen ?? []) {
      const f = join("szenen", slug, `k-${String(k).padStart(2, "0")}.jpg`);
      if (!existsSync(f)) continue;
      n++;
      const up = await fetch(`${APP}/api/admin/recipes/${encodeURIComponent(slug)}/bild`, {
        method: "POST",
        headers: { ...UA, "x-server-key": SERVER_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ base64: readFileSync(f).toString("base64"), rolle: "galerie", zusatz: `szene-${n}`, alsKarte: a.karte === k, herkunft: r.source }),
      });
      if (!up.ok) console.log("  Upload", k, up.status, (await up.text()).slice(0, 120));
    }
    // Kartenbild, das nicht unter den Szenen ist
    if (a.karte && !(a.szenen ?? []).includes(a.karte)) {
      const f = join("szenen", slug, `k-${String(a.karte).padStart(2, "0")}.jpg`);
      const up = await fetch(`${APP}/api/admin/recipes/${encodeURIComponent(slug)}/bild`, {
        method: "POST",
        headers: { ...UA, "x-server-key": SERVER_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ base64: readFileSync(f).toString("base64"), rolle: "galerie", zusatz: "fertig", alsKarte: true, herkunft: r.source }),
      });
      if (!up.ok) console.log("  Karte", up.status, (await up.text()).slice(0, 120));
    }
    console.log(slug, `→ ${n} Szenen${a.karte ? ", neues Kartenbild" : ""}`, nummern.length ? "" : "(nichts gewählt)");
  }
}

if (modus === "kandidaten") {
  let slugs = rest.filter((a) => !a.startsWith("--"));
  if (rest.includes("--alle")) {
    const alle = (await (await fetch(`${APP}/api/recipes?lite=1`, { headers: UA })).json()).recipes;
    slugs = alle.filter((r) => istVideo(r.source)).map((r) => r.slug);
    console.log(slugs.length, "Rezepte mit Video-Link");
  }
  for (const s of slugs) { try { await kandidaten(s); } catch (e) { console.log(s, "→ FEHLER", String(e.message ?? e).split("\n")[0].slice(0, 160)); } }
} else if (modus === "hochladen") {
  await hochladen(rest[0]);
} else {
  console.log("Aufruf: node tools/video-szenen.mjs kandidaten <slug …>|--alle  ·  hochladen auswahl.json");
}
