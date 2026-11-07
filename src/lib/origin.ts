/**
 * Herkunftsprüfung für ändernde Anfragen (CSRF-Bremse, zusätzlich zu SameSite=Lax).
 * - Kein Origin-Header (native Aufrufe, Server, curl): erlaubt.
 * - Gleiche Herkunft wie die Anfrage (Host bzw. x-forwarded-host): erlaubt.
 * - App-Hülle: capacitor://localhost, ionic://localhost und die server.url aus capacitor.config.ts.
 * - Weitere über ALLOWED_ORIGINS (Komma-getrennt).
 */

const STATIC_ALLOWED = ["capacitor://localhost", "ionic://localhost", "https://rezepte.christianarns.de"];
const CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isChangingMethod(method: string): boolean {
  return CHANGING.has(method.toUpperCase());
}

export function originAllowed(req: Request, extra = process.env.ALLOWED_ORIGINS ?? ""): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  if (origin === "null") return false;
  const allowed = [...STATIC_ALLOWED, ...extra.split(",").map((s) => s.trim()).filter(Boolean)];
  if (allowed.includes(origin)) return true;
  let host: string;
  try { host = new URL(origin).host; } catch { return false; }
  const mine = [req.headers.get("x-forwarded-host"), req.headers.get("host")].filter(Boolean) as string[];
  if (mine.some((h) => h.split(",")[0].trim() === host)) return true;
  try { return new URL(req.url).host === host; } catch { return false; }
}
