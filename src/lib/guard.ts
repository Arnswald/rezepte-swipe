/**
 * Bremse gegen Durchprobieren (Login, Admin-PIN, Freundes-/Gruppencodes).
 * Zählt nur FEHLversuche je IP und Zweck im Speicher; nach `max` Fehlern in
 * `windowMs` ist für den Rest des Fensters zu (429). Ein Neustart des
 * Containers setzt alles zurück, für eine kleine App reicht das.
 */

import { NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "crypto";
import { env } from "@/lib/env";

type Bucket = { fails: number; since: number };
const buckets = new Map<string, Bucket>();

/** Echte Client-IP hinter dem Cloudflare-Tunnel. */
export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    ?? "lokal";
}

function bucket(key: string, windowMs: number): Bucket {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.since > windowMs) { b = { fails: 0, since: now }; buckets.set(key, b); }
  if (buckets.size > 5000) { for (const [k, v] of buckets) if (now - v.since > windowMs) buckets.delete(k); }
  return b;
}

export interface Limit { scope: string; max: number; windowMs: number }
export const LIMITS = {
  login: { scope: "login", max: 10, windowMs: 15 * 60_000 },
  admin: { scope: "admin", max: 5, windowMs: 30 * 60_000 },
  code: { scope: "code", max: 15, windowMs: 15 * 60_000 },
} satisfies Record<string, Limit>;

/** 429-Antwort, falls diese IP für den Zweck gesperrt ist, sonst null. */
export function blocked(req: Request, l: Limit): NextResponse | null {
  const b = bucket(`${l.scope}:${clientIp(req)}`, l.windowMs);
  if (b.fails < l.max) return null;
  const min = Math.ceil((b.since + l.windowMs - Date.now()) / 60_000);
  return NextResponse.json({ error: `Zu viele Versuche. Bitte in ${min} Min. nochmal.` }, { status: 429 });
}
export function fail(req: Request, l: Limit) { bucket(`${l.scope}:${clientIp(req)}`, l.windowMs).fails++; }
export function succeed(req: Request, l: Limit) { buckets.delete(`${l.scope}:${clientIp(req)}`); }

/** Admin-PIN prüfen: zeitkonstant und mit Sperre nach Fehlversuchen. null = ok. */
export function checkAdminPin(req: Request): NextResponse | null {
  if (!env.ADMIN_PIN) return NextResponse.json({ error: "Admin nicht konfiguriert (ADMIN_PIN fehlt)" }, { status: 503 });
  const stop = blocked(req, LIMITS.admin);
  if (stop) return stop;
  const h = (s: string) => createHash("sha256").update(s).digest();
  if (!timingSafeEqual(h(req.headers.get("x-admin-pin") ?? ""), h(env.ADMIN_PIN))) {
    fail(req, LIMITS.admin);
    return NextResponse.json({ error: "Falscher PIN" }, { status: 401 });
  }
  succeed(req, LIMITS.admin);
  return null;
}
