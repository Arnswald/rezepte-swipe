// KI-Kartenbild fürs fertige Gericht (21.10.2026): nimmt das vorhandene Kartenbild (Reel-Standbild,
// oft mit Person/Text/Zwischenschritt) als Vorlage und lässt fal.ai (nano-banana/edit, ~0,04 USD)
// das FERTIGE Gericht daraus machen.
//   node tools/ki-kartenbild.mjs <slug> [--hochladen] [--aus datei.jpg]
// Ohne --hochladen landet das Bild nur in ./ki-vorschau/<slug>.png zum Ansehen.
// Mit --hochladen: POST /api/admin/recipes/<slug>/bild (rolle ki, wird Kartenbild).
// Schlüssel: FAL_KEY aus der .env im Vault, Server-Schlüssel aus ~/.config/second-brain/rezepte-server.key.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const H = homedir();
const VAULT_ENV = join(H, "Library/Mobile Documents/iCloud~md~obsidian/Documents/Arns Obsidian Vault/.env");
const FAL_KEY = readFileSync(VAULT_ENV, "utf8").match(/^FAL_KEY=(.+)$/m)?.[1]?.trim();
const SERVER_KEY = readFileSync(join(H, ".config/second-brain/rezepte-server.key"), "utf8").trim();
const APP = "https://rezepte.christianarns.de";
const UA = { "User-Agent": "curl/8.7.1" };

const args = process.argv.slice(2);
const slug = args[0];
const hochladen = args.includes("--hochladen");
const ausDatei = args.includes("--aus") ? args[args.indexOf("--aus") + 1] : null;
if (!slug || !FAL_KEY) { console.error("Aufruf: node tools/ki-kartenbild.mjs <slug> [--hochladen]"); process.exit(2); }

const r = (await (await fetch(`${APP}/api/recipes?slug=${encodeURIComponent(slug)}`, { headers: UA })).json()).recipe;
if (!r) throw new Error("Rezept nicht gefunden: " + slug);

let vorlage;
if (ausDatei) vorlage = readFileSync(ausDatei);
else {
  // Original des Profilbilds (nicht das KI-Kartenbild), sonst das Kartenbild
  const orig = r.images.find((i) => !/_ki[.-]/i.test(i)) ?? r.image;
  const res = await fetch(`${APP}/api/admin/bild/${encodeURIComponent(orig)}`, { headers: { ...UA, "x-server-key": SERVER_KEY } });
  if (!res.ok) throw new Error(`Vorlage ${orig}: HTTP ${res.status}`);
  vorlage = Buffer.from(await res.arrayBuffer());
}
const zutaten = r.ingredients.flatMap((g) => g.items).slice(0, 12).join("; ");
const prompt = [
  `Professional food photograph of the FINISHED, ready-to-eat dish "${r.name}".`,
  r.description ? `Dish description (German): ${r.description}` : "",
  zutaten ? `Main ingredients (German): ${zutaten}.` : "",
  "Use the reference image only to match how this real dish, its ingredients, cookware and plating look.",
  "Show only the finished, plated dish. No people, no hands, no faces, no text, no captions, no logos, no watermarks.",
  "Natural soft daylight, appetizing, realistic home-cooked look, shallow depth of field, portrait 4:5 framing, dish centered and filling the frame.",
].filter(Boolean).join(" ");

const typ = vorlage[0] === 0x89 ? "image/png" : vorlage.slice(0, 4).toString("hex") === "52494646" ? "image/webp" : "image/jpeg";
const res = await fetch("https://fal.run/fal-ai/nano-banana/edit", {
  method: "POST",
  headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt, image_urls: [`data:${typ};base64,${vorlage.toString("base64")}`], num_images: 1, output_format: "png" }),
});
const out = await res.json();
if (!res.ok) throw new Error(`fal ${res.status}: ${JSON.stringify(out).slice(0, 300)}`);
const url = out.images?.[0]?.url;
const bild = Buffer.from(await (await fetch(url)).arrayBuffer());
mkdirSync("ki-vorschau", { recursive: true });
writeFileSync(join("ki-vorschau", `${slug}.png`), bild);
console.log("Vorschau:", join("ki-vorschau", `${slug}.png`));

if (hochladen) {
  const up = await fetch(`${APP}/api/admin/recipes/${encodeURIComponent(slug)}/bild`, {
    method: "POST",
    headers: { ...UA, "x-server-key": SERVER_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ base64: bild.toString("base64"), rolle: "ki", alsKarte: true, herkunft: "fal-ai/nano-banana/edit" }),
  });
  console.log("Hochgeladen:", up.status, (await up.text()).slice(0, 200));
}
