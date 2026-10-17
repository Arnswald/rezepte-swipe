/**
 * Bildfokus — wo im Foto das Gericht sitzt (in Prozent, [x, y]).
 *
 * Warum: Die Quellbilder sind teils Hochformat 9:16 (Instagram-Standbilder, Teller
 * oft unten, Gesicht oder Schrift oben), teils Querformat 16:9 (KI-Bilder). Jede
 * Ansicht schneidet anders zu (Karte 4:5, Raster 8:7, Detail 16:10). Mittig
 * zugeschnitten landete im Raster/Detail oft das Gesicht oder der Tellerrand im Bild.
 *
 * Verfahren (Kontaktbogen aller 186 Titelbilder, 17.10.2026): drei Schätzer, davon der
 * Median — jeder allein lag zu oft daneben:
 *   1. sharp „attention“ (Sättigung, Kontrast, Hauttöne) → mag Gesichter
 *   2. sharp „entropy“ (Detailreichtum) → mag eingeblendete Schrift
 *   3. eigener „Essens-Score“: Sättigung × Helligkeit, Hauttöne und weiße Schrift gedämpft,
 *      leichter Mittel-Vorzug → mag Rasen, Zitronen, bunte Schrift
 * Bei Hochformat (Instagram-Standbilder) sitzt oben fast immer Gesicht oder Schrift, das
 * Gericht in der Mitte oder unten. Deshalb wandert der Fokus dort nur nach unten (50–80 %).
 * Ergebnis: von 186 Bildern verschieben sich 44, davon ~20 klar besser (Gericht statt
 * Gesicht), ~3 schlechter — die lassen sich per `bildfokus` korrigieren.
 * Gesucht wird nur entlang der Achse, die überhaupt beschnitten wird.
 *
 * Ergebnis wird in DATA_DIR/image-cache/focus-v1.json gemerkt (Schlüssel: Größe +
 * Änderungszeit der Datei), sharp läuft also einmal pro Bild. Von Hand übersteuern
 * lässt es sich mit `bildfokus:` im Frontmatter (siehe recipes.ts → parseFocus).
 */

import { readFile, writeFile, mkdir, stat, rename } from "fs/promises";
import { join, dirname } from "path";
import { env } from "@/lib/env";

export type Focus = [number, number];

const FOCUS_FILE = join(env.DATA_DIR, "image-cache", "focus-v1.json");

type Entry = { k: string; f: Focus };
let store: Record<string, Entry> | null = null;
let loading: Promise<void> | null = null;
const inflight = new Map<string, Promise<Focus>>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function load(): Promise<void> {
  if (store) return;
  loading ??= readFile(FOCUS_FILE, "utf8")
    .then((t) => { store = JSON.parse(t); })
    .catch(() => { store = {}; });
  await loading;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await mkdir(dirname(FOCUS_FILE), { recursive: true });
      await writeFile(FOCUS_FILE + ".tmp", JSON.stringify(store));
      await rename(FOCUS_FILE + ".tmp", FOCUS_FILE);
    } catch (err) {
      console.warn("[imageFocus] Speichern fehlgeschlagen:", err);
    }
  }, 1500);
}

/** Fokus eines Bildes berechnen (sharp, ~20–40 ms auf einem 256-px-Vorschaubild). */
async function computeFocus(filePath: string): Promise<Focus> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(filePath, { failOn: "none" })
    .rotate()
    .resize(256, 256, { fit: "inside" })
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const ratio = w / h;
  if (ratio > 0.9 && ratio < 1.1) return [50, 50]; // quadratisch: nichts zu beschneiden

  const along = async (position: "attention" | "entropy"): Promise<number> => {
    if (w > h) {
      const cw = Math.round(h * 0.8);
      const r = await sharp(data).resize(cw, h, { fit: "cover", position }).toBuffer({ resolveWithObject: true });
      return (-(r.info.cropOffsetLeft ?? 0) + cw / 2) / w;
    }
    const ch = Math.round(w * 0.8);
    const r = await sharp(data).resize(w, ch, { fit: "cover", position }).toBuffer({ resolveWithObject: true });
    return (-(r.info.cropOffsetTop ?? 0) + ch / 2) / h;
  };
  const [a, e, f] = await Promise.all([along("attention"), along("entropy"), foodScore(sharp, data, w > h)]);
  const med = [a, e, f].sort((x, y) => x - y)[1];
  const p = Math.round(med * 100);
  return w > h ? [Math.min(80, Math.max(20, p)), 50] : [50, Math.min(80, Math.max(50, p))];
}

/** RGB → [Farbton °, Sättigung, Helligkeit] (0..1) */
function hsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}

/** „Essens-Score“ entlang der beschnittenen Achse: bester Streifen (16:10 bei Hochformat,
 *  4:5 bei Querformat) nach Sättigung × Helligkeit, Haut und weiße Schrift gedämpft. */
async function foodScore(sharp: typeof import("sharp"), input: Buffer, landscape: boolean): Promise<number> {
  const { data, info } = await sharp(input).resize(72, 72, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const line = new Float64Array(landscape ? W : H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const [h, s, v] = hsv(data[i], data[i + 1], data[i + 2]);
      let sc = s * v;
      if (h <= 45 && s > 0.15 && s < 0.6 && v > 0.3) sc *= 0.35; // Hautton
      if (s < 0.12 && v > 0.85) sc = 0;                          // Weiß / Schrift
      line[landscape ? x : y] += sc;
    }
  }
  const N = line.length;
  const win = Math.max(1, Math.round(landscape ? H * 0.8 : W / 1.6));
  let best = -1, bestC = N / 2;
  for (let a = 0; a + win <= N; a++) {
    let sum = 0;
    for (let k = a; k < a + win; k++) sum += line[k];
    const c = a + win / 2;
    const prior = 1 - 0.35 * Math.pow((c - N / 2) / (N / 2), 2);
    if (sum * prior > best) { best = sum * prior; bestC = c; }
  }
  return bestC / N;
}

/** Bekannter Fokus ohne Rechnen (oder null). */
export function peekFocus(name: string): Focus | null {
  return store?.[name]?.f ?? null;
}

/** Fokus eines Bildes im Bilder-Ordner — gemerkt oder frisch berechnet. */
export async function getFocus(dir: string, name: string): Promise<Focus> {
  await load();
  const filePath = join(dir, name);
  let key = "";
  try {
    const s = await stat(filePath);
    key = `${s.size}-${Math.round(s.mtimeMs)}`;
  } catch {
    return [50, 50];
  }
  const hit = store![name];
  if (hit && hit.k === key) return hit.f;

  const running = inflight.get(name);
  if (running) return running;
  const job = computeFocus(filePath)
    .catch((err) => { console.warn("[imageFocus] Berechnung fehlgeschlagen:", name, err); return [50, 50] as Focus; })
    .then((f) => {
      store![name] = { k: key, f };
      scheduleSave();
      inflight.delete(name);
      return f;
    });
  inflight.set(name, job);
  return job;
}
