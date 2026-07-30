/**
 * POST /api/recipes/submit   (multipart/form-data)
 * Gäste reichen ein vollständiges Rezept ein (Essentials + optional Bild).
 *
 * Die App erzeugt daraus eine **fertige Rezept-Markdown im Vault-Template** und
 * konvertiert das Bild zu WebP. Beides wird:
 *   1) lokal in DATA_DIR/einreichungen/ als Backup abgelegt (schreibbares Volume),
 *   2) an den n8n-Webhook (N8N_SUGGEST_WEBHOOK) geschickt — Bild als Base64.
 *
 * WICHTIG: Die App schreibt NIE in den Vault (read-only). Das Einsortieren nach
 * Obsidian macht n8n auf dem Server. Diese Route fasst nur DATA_DIR an.
 *
 * Felder: name (Pflicht), description, category, ingredients, steps, tips,
 *         source, submittedBy, image (File, optional)
 */

import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB Rohbild

// Vault-tauglicher Slug aus dem Namen (keine Pfad-Tricks möglich).
function slugify(name: string): string {
  const umlaut: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };
  let s = name.toLowerCase().replace(/[äöüß]/g, (c) => umlaut[c] ?? c);
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return s || "rezept";
}

// Sicherer Frontmatter-String (quotet + einzeilig, kein YAML-Ausbruch).
function yamlStr(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ").trim()}"`;
}

// Freitext (mehrzeilig) → Liste. kind: check = "- [ ] ", num = "1. ", dash = "- ".
function toList(text: string, kind: "check" | "num" | "dash"): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  if (kind === "num") return lines.map((l, i) => `${i + 1}. ${l.replace(/^\d+[.)]\s*/, "")}`).join("\n");
  const prefix = kind === "check" ? "- [ ] " : "- ";
  return lines.map((l) => `${prefix}${l.replace(/^[-*]\s*/, "").replace(/^\[.\]\s*/, "")}`).join("\n");
}

function buildMarkdown(r: {
  name: string; description: string; category: string; source: string;
  ingredients: string; steps: string; tips: string; imageName: string | null;
}): string {
  const created = new Date().toISOString().slice(0, 10);
  const fm = [
    `name: ${yamlStr(r.name)}`,
    `Kurzbeschreibung: ${yamlStr(r.description)}`,
    `kategorie: ${yamlStr(r.category || "Hauptgericht")}`,
    `kalorien: `,
    `protein: `,
    `kohlenhydrate: `,
    `fette: `,
    `Profilbild: ${r.imageName ?? ""}`,
    `erstellt: ${created}`,
    ...(r.source ? [`quelle: ${yamlStr(r.source)}`] : []),
  ].join("\n");

  const zutaten = toList(r.ingredients, "check") || "- [ ] ";
  const zubereitung = toList(r.steps, "num") || "1. ";
  const tippsBlock = r.tips.trim() ? `\n\n## 💡 Tipps\n\n${toList(r.tips, "dash")}` : "";

  return `---\n${fm}\n---\n\n## 📋 Überblick\n\n| | |\n|---|---|\n| ⏳ Gesamtzeit |  |\n| 🍽️ Portionen |  |\n| 📊 Schwierigkeit |  |\n\n## 🛒 Zutaten\n\n${zutaten}\n\n## 👨‍🍳 Zubereitung\n\n${zubereitung}${tippsBlock}\n`;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const get = (k: string) => String(form.get(k) ?? "").trim();

    const name = get("name").slice(0, 120);
    const description = get("description").slice(0, 400);
    const category = get("category").slice(0, 40) || "Hauptgericht";
    const ingredients = get("ingredients").slice(0, 4000);
    const steps = get("steps").slice(0, 6000);
    const tips = get("tips").slice(0, 2000);
    const source = get("source").slice(0, 400);
    const submittedBy = get("submittedBy").slice(0, 80) || "Anonym";

    if (!name) return NextResponse.json({ error: "Bitte gib dem Rezept einen Namen." }, { status: 400 });
    if (!ingredients && !steps) {
      return NextResponse.json({ error: "Bitte Zutaten oder Zubereitung angeben." }, { status: 400 });
    }

    const slug = slugify(name);

    // ── Bild (optional) → WebP ────────────────────────────────
    let image: { filename: string; buffer: Buffer; mimetype: string } | null = null;
    const file = form.get("image");
    if (file && typeof file === "object" && "arrayBuffer" in file && (file as File).size > 0) {
      const f = file as File;
      if (f.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "Bild ist zu groß (max. 12 MB)." }, { status: 400 });
      }
      const input = Buffer.from(await f.arrayBuffer());
      try {
        const webp = await sharp(input)
          .rotate() // EXIF-Orientierung anwenden
          .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        image = { filename: `${slug}.webp`, buffer: webp, mimetype: "image/webp" };
      } catch {
        // Kein gültiges Bild → Einreichung trotzdem ohne Bild annehmen
        image = null;
      }
    }

    const markdown = buildMarkdown({
      name, description, category, source, ingredients, steps, tips,
      imageName: image?.filename ?? null,
    });

    // ── 1) Lokales Backup in DATA_DIR/einreichungen/ ──────────
    const dir = join(env.DATA_DIR, "einreichungen");
    await mkdir(dir, { recursive: true });
    const base = `${slug}-${Date.now().toString(36)}`;
    await writeFile(join(dir, `${base}.md`), markdown, "utf-8");
    if (image) await writeFile(join(dir, `${base}.webp`), image.buffer);

    // ── 2) An n8n weiterreichen (formatiert dann in Obsidian) ──
    let forwarded = false;
    if (env.N8N_SUGGEST_WEBHOOK) {
      try {
        await fetch(env.N8N_SUGGEST_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "recipe-submission",
            submittedBy,
            submittedAt: new Date().toISOString(),
            recipe: { name, slug, description, category, source, ingredients, steps, tips },
            markdown,
            image: image ? { filename: image.filename, mimetype: image.mimetype, base64: image.buffer.toString("base64") } : null,
          }),
        });
        forwarded = true;
      } catch (hookErr) {
        console.warn("[submit] n8n-Webhook fehlgeschlagen:", hookErr);
      }
    }

    return NextResponse.json({ ok: true, slug, forwarded, hadImage: !!image });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
