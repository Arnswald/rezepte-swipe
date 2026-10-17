/**
 * „Heute“ in der Rezepte-App: ein Tag beginnt um 4:00 Uhr Europe/Berlin
 * (Mitternacht schnitt mitten in die Couch-Zeit). Gilt für Server UND Browser,
 * deshalb ohne Abhängigkeiten. Immer ein konkretes Date übergeben — im Test
 * wird Date im Browser ersetzt, ein `Intl…format()` ohne Argument sähe das nicht.
 */

export const DAY_START_HOUR = 4;
const TZ = "Europe/Berlin";

const fmtDate = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtHour = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" });

/** Tag als YYYY-MM-DD: Berliner Datum von (Zeitpunkt − 4 h). */
export function dayKey(at: Date | string | number = new Date()): string {
  const t = new Date(at).getTime();
  return fmtDate.format(new Date(t - DAY_START_HOUR * 3600_000));
}

/** Tag um n Tage verschoben (YYYY-MM-DD, kalendarisch). */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Stunde (0–23) in Berlin. */
export function berlinHour(at: Date = new Date()): number {
  return Number(fmtHour.format(at)) % 24;
}

/** „Gestern gemerkt“ bleibt am Vormittag sichtbar: von 4:00 bis 12:00 Uhr. */
export function showYesterday(at: Date = new Date()): boolean {
  const h = berlinHour(at);
  return h >= DAY_START_HOUR && h < 12;
}

export function isDayKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
