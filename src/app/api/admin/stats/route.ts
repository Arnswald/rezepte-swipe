/**
 * GET /api/admin/stats   (Header: x-admin-pin)
 * Aggregierte Auswertung der Verdicts für Christian.
 *
 * Schutz: PIN-Vergleich gegen ADMIN_PIN (env). Ohne gesetzten PIN → 503.
 */

import { NextResponse } from "next/server";
import { getAllVerdicts, type Verdict } from "@/lib/db";
import { checkAdminPin } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const bad = checkAdminPin(req);
  if (bad) return bad;

  const rows = getAllVerdicts();

  const count = (v: Verdict) => rows.filter((r) => r.verdict === v).length;

  // Pro Gericht
  const recipeMap = new Map<string, { slug: string; name: string; category: string; like: number; super: number; nope: number }>();
  for (const r of rows) {
    const e = recipeMap.get(r.slug) ?? { slug: r.slug, name: r.recipe_name || r.slug, category: r.category, like: 0, super: 0, nope: 0 };
    e[r.verdict] += 1;
    if (r.recipe_name) e.name = r.recipe_name;
    if (r.category) e.category = r.category;
    recipeMap.set(r.slug, e);
  }
  const recipes = [...recipeMap.values()]
    .map((e) => ({ ...e, score: e.super * 2 + e.like - e.nope }))
    .sort((a, b) => b.score - a.score || b.super - a.super);

  // Pro Person (guest_id ist der Schlüssel, Anzeige über name)
  const guestMap = new Map<string, { guestId: string; name: string; like: number; super: number; nope: number; lastActive: string; liked: string[] }>();
  for (const r of rows) {
    const e = guestMap.get(r.guest_id) ?? { guestId: r.guest_id, name: r.name, like: 0, super: 0, nope: 0, lastActive: r.updated_at, liked: [] };
    e[r.verdict] += 1;
    e.name = r.name;
    if (r.updated_at > e.lastActive) e.lastActive = r.updated_at;
    if (r.verdict === "like" || r.verdict === "super") e.liked.push(r.recipe_name || r.slug);
    guestMap.set(r.guest_id, e);
  }
  const guests = [...guestMap.values()]
    .map((e) => ({ ...e, total: e.like + e.super + e.nope }))
    .sort((a, b) => b.lastActive.localeCompare(a.lastActive));

  const recent = rows.slice(0, 30).map((r) => ({
    name: r.name, recipeName: r.recipe_name || r.slug, verdict: r.verdict, updatedAt: r.updated_at,
  }));

  return NextResponse.json({
    totals: {
      guests: guestMap.size,
      verdicts: rows.length,
      likes: count("like"),
      supers: count("super"),
      nopes: count("nope"),
    },
    recipes,
    guests,
    recent,
  });
}
