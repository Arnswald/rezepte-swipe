// App-Icon v3 (Entwurf 3-01, Herzteller mit Besteck auf Terrakotta, 08.11.2026).
// Quelle: tools/icon/3-01.svg (Kopie aus assets/icon-entwuerfe-261107/runde3/, gebaut mit _werkzeug/bauen_runde3.mjs).
// Baut: public/icon-v3.svg (Favicon, abgerundet), icon-192-v3.png, icon-512-v3.png,
// icon-maskable-512-v3.png (Motiv auf 80 %, Sicherheitsrand), apple-touch-icon-v3.png (180, randlos),
// favicon-32-v3.png und tools/icon/ios-symbol-1024-v3.png (für die iOS-Hülle, ohne Transparenz).
// Neue Namen, weil iOS und Browser Symbole festhalten. Alte Dateien bleiben liegen.
// Aufruf: node tools/icon/bauen_v3.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "tools/icon/3-01.svg");
const PUB = path.join(ROOT, "public");
// IDs im Entwurf beginnen mit einer Ziffer («3-01-bg»): als XML-ID ungültig, darum Präfix.
const src = fs.readFileSync(SRC, "utf8").replaceAll('id="3-01-', 'id="i301-').replaceAll("#3-01-", "#i301-");

// Hintergrund = die ersten beiden <rect width="1024" ...> nach </defs>; alles danach ist Motiv.
const cut = src.indexOf("</defs>") + "</defs>".length;
const rest = src.slice(cut, src.lastIndexOf("</svg>"));
const bgEnd = rest.indexOf("/>", rest.indexOf("/>") + 2) + 2;
const head = src.slice(0, cut);
const bg = rest.slice(0, bgEnd);
const motif = rest.slice(bgEnd);
if (!bg.startsWith("<rect") || !motif.trim()) throw new Error("3-01.svg hat einen unerwarteten Aufbau");

// Maskable: Motiv auf 80 % um die Mitte (Sicherheitskreis r = 410 px bei 1024)
const maskable = `${head}${bg}<g transform="translate(512 512) scale(0.8) translate(-512 -512)">${motif}</g></svg>`;
// Favicon: abgerundete Ecken (22 %), damit es im Tab nicht als hartes Quadrat steht
const rounded = head.replace("<defs>", `<defs><clipPath id="v3-rund"><rect width="1024" height="1024" rx="225"/></clipPath>`) +
  `<g clip-path="url(#v3-rund)">${bg}${motif}</g></svg>`;

const png = (svg, size, file) => sharp(Buffer.from(svg), { density: 72 * Math.max(1, size / 1024) })
  .resize(size, size, { kernel: "lanczos3" }).flatten({ background: "#a9432d" }).png().toFile(file);

fs.writeFileSync(path.join(PUB, "icon-v3.svg"), rounded);
await png(src, 512, path.join(PUB, "icon-512-v3.png"));
await png(src, 192, path.join(PUB, "icon-192-v3.png"));
await png(src, 180, path.join(PUB, "apple-touch-icon-v3.png"));
await png(maskable, 512, path.join(PUB, "icon-maskable-512-v3.png"));
await sharp(Buffer.from(rounded)).resize(32, 32, { kernel: "lanczos3" }).png().toFile(path.join(PUB, "favicon-32-v3.png"));
await png(src, 1024, path.join(ROOT, "tools/icon/ios-symbol-1024-v3.png"));
console.log("fertig: icon-v3.svg, icon-192/512-v3, icon-maskable-512-v3, apple-touch-icon-v3, favicon-32-v3, ios-symbol-1024-v3");
