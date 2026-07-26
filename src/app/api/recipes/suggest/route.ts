/**
 * POST /api/recipes/suggest
 * Gäste reichen einen Rezept-Vorschlag ein.
 *
 * Landet in DATA_DIR/rezept-vorschlaege.md (schreibbares Volume) — Christian
 * kann die Datei jederzeit einsehen. Der Rezept-Mount ist read-only; die App
 * schreibt NIE in den Vault.
 *
 * Optional (Phase 2): wenn N8N_SUGGEST_WEBHOOK gesetzt ist, wird der Vorschlag
 * zusätzlich dorthin gePOSTet → z.B. Telegram-Push + Obsidian-Inbox via n8n.
 *
 * Body: { name, idea, link?, note? }
 */

import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { appendFile, mkdir, writeFile, access } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

const SUGGEST_FILE = "rezept-vorschlaege.md";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string; idea?: string; link?: string; note?: string;
    };

    const name = (body.name ?? "").trim().slice(0, 80) || "Anonym";
    const idea = (body.idea ?? "").trim().slice(0, 200);
    const link = (body.link ?? "").trim().slice(0, 400);
    const note = (body.note ?? "").trim().slice(0, 500);

    if (!idea && !link) {
      return NextResponse.json({ error: "Idee oder Link fehlt" }, { status: 400 });
    }

    // Datum serverseitig bilden
    const now = new Date();
    const stamp = now.toLocaleString("de-DE", { timeZone: "Europe/Berlin" });

    const isInsta = /instagram\.com/i.test(link);
    const linkLine = link ? `\n  - ${isInsta ? "📸 Instagram" : "🔗 Link"}: ${link}` : "";
    const ideaLine = idea ? `\n  - Idee: ${idea}` : "";
    const noteLine = note ? `\n  - Notiz: ${note}` : "";
    const entry = `\n- **${name}** · ${stamp}${ideaLine}${linkLine}${noteLine}\n`;

    // 1) In die lokale Vorschlags-Datei schreiben
    const dir = env.DATA_DIR;
    const filePath = join(dir, SUGGEST_FILE);
    await mkdir(dir, { recursive: true });
    try {
      await access(filePath);
    } catch {
      await writeFile(
        filePath,
        "# 🍽️ Rezept-Vorschläge\n\n> Von Gästen über die Swipe-App eingereicht.\n\n",
        "utf-8",
      );
    }
    await appendFile(filePath, entry, "utf-8");

    // 2) Optional: an n8n weiterreichen (Telegram / Obsidian-Inbox)
    if (env.N8N_SUGGEST_WEBHOOK) {
      try {
        await fetch(env.N8N_SUGGEST_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, idea, link, note, stamp }),
        });
      } catch (hookErr) {
        console.warn("[suggest] n8n-Webhook fehlgeschlagen:", hookErr);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
