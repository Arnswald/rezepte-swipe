/**
 * Eigene Rezepte der Nutzer (07.11.2026), siehe lib/eigeneRezepte.ts.
 *
 * POST JSON { action, guestId, … }
 *   list                → { eigene: EigenesRezept[] }   meine + die meiner Verbundenen
 *   hide  { slug }      → { ok }                        ausblenden statt löschen (nur Ersteller)
 *   show  { slug }      → { ok }                        wieder einblenden
 *   parse { text }      → { vorschlag }                 Link oder eingefügter Text → Formularfelder
 * POST multipart (Speichern, neu oder mit `slug` bearbeiten):
 *   guestId, name (Anzeigename), slug?, title, description, category, totalTime, portions,
 *   ingredients / steps / tips (JSON-Arrays), source, image (Datei) oder imageUrl (aus „Link einfügen“)
 *   → { rezept }
 * Nur mit RECIPE_SOURCE=db. Identität über das Sitzungs-Token (wie alle Schreibrouten).
 */

import { NextResponse } from "next/server";
import sharp from "sharp";
import { RECIPE_SOURCE } from "@/lib/recipes";
import { denyForeignGuest, resolveGuestId } from "@/lib/session";
import {
  eigeneFuer, eigenesAusblenden, eigenesSpeichern, pruefeEigene, rezeptAusLink, rezeptAusText, sicherLaden,
} from "@/lib/eigeneRezepte";

export const dynamic = "force-dynamic";

const MAX_BILD = 12 * 1024 * 1024;

// Bremse je Gast: 40 Speichervorgänge und 30 Link-Abrufe je Stunde (im Speicher)
const zaehler = new Map<string, number[]>();
function zuViele(key: string, max: number): boolean {
  const jetzt = Date.now();
  const liste = (zaehler.get(key) ?? []).filter((t) => jetzt - t < 3_600_000);
  if (liste.length >= max) return true;
  liste.push(jetzt);
  zaehler.set(key, liste);
  return false;
}

const fehler = (error: string, status: number) => NextResponse.json({ error }, { status });

function liste(v: FormDataEntryValue | null): string[] {
  if (typeof v !== "string" || !v) return [];
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return v.split(/\r?\n/);
  }
}

async function bildAusForm(form: FormData): Promise<Buffer | null | "zu-gross" | "kaputt"> {
  const f = form.get("image");
  if (f && typeof f === "object" && "arrayBuffer" in f && (f as File).size > 0) {
    if ((f as File).size > MAX_BILD) return "zu-gross";
    const buf = Buffer.from(await (f as File).arrayBuffer());
    try { await sharp(buf).metadata(); return buf; } catch { return "kaputt"; }
  }
  const url = String(form.get("imageUrl") ?? "").trim();
  if (/^https?:\/\//i.test(url)) {
    try {
      const { body } = await sicherLaden(url, MAX_BILD, "image/*");
      await sharp(body).metadata();
      return body;
    } catch {
      return null; // Bild aus dem Link ist kein Muss
    }
  }
  return null;
}

export async function POST(req: Request) {
  if (RECIPE_SOURCE !== "db") return fehler("Eigene Rezepte gehen gerade nicht.", 503);
  const multipart = (req.headers.get("content-type") ?? "").includes("multipart/form-data");

  if (multipart) {
    const form = await req.formData();
    const bodyGuest = String(form.get("guestId") ?? "");
    const denied = denyForeignGuest(req, bodyGuest);
    if (denied) return denied;
    const guestId = resolveGuestId(req, bodyGuest);
    if (!guestId) return fehler("Nicht angemeldet.", 401);
    if (zuViele(`s:${guestId}`, 40)) return fehler("Das waren viele Änderungen. Bitte später nochmal.", 429);

    const p = pruefeEigene({
      name: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      category: String(form.get("category") ?? ""),
      totalTime: String(form.get("totalTime") ?? ""),
      portions: String(form.get("portions") ?? ""),
      ingredients: liste(form.get("ingredients")),
      steps: liste(form.get("steps")),
      tips: liste(form.get("tips")),
      source: String(form.get("source") ?? ""),
    });
    if ("fehler" in p) return fehler(p.fehler, 400);
    const bild = await bildAusForm(form);
    if (bild === "zu-gross") return fehler("Das Foto ist zu groß (höchstens 12 MB).", 400);
    if (bild === "kaputt") return fehler("Das Foto konnte nicht gelesen werden.", 400);

    try {
      const r = await eigenesSpeichern({
        guestId,
        name: String(form.get("name") ?? ""),
        slug: String(form.get("slug") ?? "") || null,
        felder: p.felder,
        bild,
      });
      if (r.status !== 200) return fehler(r.error, r.status);
      return NextResponse.json({ rezept: r.rezept });
    } catch (err) {
      console.error("[eigene] speichern", err);
      return fehler("Speichern hat nicht geklappt.", 500);
    }
  }

  const b = (await req.json().catch(() => ({}))) as { action?: string; guestId?: string; slug?: string; text?: string };
  const denied = denyForeignGuest(req, b.guestId);
  if (denied) return denied;
  const guestId = resolveGuestId(req, b.guestId);
  if (!guestId) return fehler("Nicht angemeldet.", 401);

  switch (b.action) {
    case "list":
      return NextResponse.json({ eigene: eigeneFuer(guestId) });
    case "hide":
    case "show": {
      const r = eigenesAusblenden(guestId, String(b.slug ?? ""), b.action === "hide");
      return r.status === 200 ? NextResponse.json({ ok: true }) : fehler(r.error ?? "Fehler", r.status);
    }
    case "parse": {
      const text = String(b.text ?? "").trim();
      if (!text) return fehler("Kein Text.", 400);
      const nurLink = /^https?:\/\/\S+$/i.test(text);
      if (!nurLink) return NextResponse.json({ vorschlag: rezeptAusText(text) });
      if (zuViele(`p:${guestId}`, 30)) return fehler("Das waren viele Links. Bitte später nochmal.", 429);
      try {
        return NextResponse.json({ vorschlag: await rezeptAusLink(text) });
      } catch (err) {
        return fehler(err instanceof Error && /erlaubt|http/.test(err.message) ? err.message : "Die Seite ließ sich nicht lesen. Kopier den Rezepttext und füg ihn ein.", 422);
      }
    }
    default:
      return fehler("Unbekannte Aktion.", 400);
  }
}
