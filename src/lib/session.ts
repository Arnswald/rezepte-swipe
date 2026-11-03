/**
 * Sitzungen: ein zufälliges Token statt der nackten guestId als Passwort-Ersatz.
 *
 * - Token kommt als httpOnly-Cookie `rezepte-session` (Web und App-Hülle, die die
 *   Live-Seite lädt) ODER als Header `Authorization: Bearer <token>` (falls die App
 *   später gebündelt wird). Serverseitig liegt nur der SHA-256 (Tabelle `sessions`).
 * - Sanfte Migration: Alte Geräte kennen nur die guestId. Solange `SESSION_ENFORCE`
 *   nicht auf "1" steht, gilt die guestId aus dem Body weiter, und `/api/me`
 *   (das die App beim Öffnen ruft) stellt dem Gerät beim nächsten Besuch ein Token aus.
 * - Mit Token gewinnt immer die Identität des Tokens, nie die guestId aus dem Body.
 */

import { NextResponse } from "next/server";
import { createSession, guestForToken } from "@/lib/db";

export const SESSION_COOKIE = "rezepte-session";
const MAX_AGE = 365 * 86400;

export function sessionEnforced(): boolean {
  return process.env.SESSION_ENFORCE === "1";
}

export function tokenFromRequest(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (m) return m[1];
  const cookie = req.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return "";
}

/** Identität der Anfrage laut Token, sonst null. */
export function sessionGuest(req: Request): string | null {
  const t = tokenFromRequest(req);
  return t ? guestForToken(t) : null;
}

/**
 * Die Identität, für die eine Anfrage gilt. Token vor Body-guestId.
 * Leerer String = nicht angemeldet (Aufrufer antworten wie bei fehlender guestId).
 */
export function resolveGuestId(req: Request, bodyGuestId: string | null | undefined): string {
  const fromToken = sessionGuest(req);
  if (fromToken) return fromToken;
  if (sessionEnforced()) return "";
  return (bodyGuestId ?? "").trim().slice(0, 64);
}

/** Setzt das Sitzungs-Cookie an einer Antwort. */
export function attachSession(res: NextResponse, token: string): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.SESSION_INSECURE !== "1",
    path: "/",
    maxAge: MAX_AGE,
  });
  return res;
}

export function clearSession(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}

/** Neue Sitzung ausstellen und ans Ergebnis hängen. `token` steht zusätzlich im Body (für Bearer-Betrieb). */
export function issueSession(res: NextResponse, guestId: string): { res: NextResponse; token: string } {
  const { token } = createSession(guestId);
  return { res: attachSession(res, token), token };
}
