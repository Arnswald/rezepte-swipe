import { NextResponse, type NextRequest } from "next/server";
import { isChangingMethod, originAllowed } from "@/lib/origin";

/** Ändernde API-Aufrufe mit fremdem Origin-Header werden abgewiesen (403). */
export function proxy(req: NextRequest) {
  if (isChangingMethod(req.method) && !originAllowed(req)) {
    return NextResponse.json({ error: "Herkunft nicht erlaubt." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
