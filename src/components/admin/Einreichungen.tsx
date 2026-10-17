"use client";

// Admin: eingereichte Rezepte prüfen und mit einem Tipp freigeben oder ablehnen.
// Daten: GET /api/admin/recipes?status=…, Aktion: POST /api/admin/recipes/<slug>/status.

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, ExternalLink, Loader2, X } from "lucide-react";

interface Pruefung {
  ok: boolean;
  phase?: "auslesen" | "fertig" | "fehlgeschlagen";
  fehler: string[];
  hinweise: string[];
  dubletten: { slug: string; name: string; grund: string }[];
}
interface Einreichung {
  slug: string; name: string; description: string; category: string;
  kcal: number | null; protein: number | null; carbs: number | null; fat: number | null;
  image: string | null; imageFocus: [number, number] | null;
  source: string | null; platform: string | null;
  totalTime: string | null; portions: string | null;
  ingredients: { group: string; items: string[] }[]; steps: string[];
  status: "veroeffentlicht" | "eingereicht" | "abgelehnt";
  submittedName: string | null; herkunft: string; statusGrund: string | null; erstelltAm: string;
  pruefung: Pruefung | null;
}

const HERKUNFT: Record<string, string> = { link: "Link", formular: "Formular", sprache: "Sprachnachricht", obsidian: "Obsidian", admin: "Admin" };

function fmt(iso: string) {
  try { return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}

export function Einreichungen({ pin }: { pin: string }) {
  const [filter, setFilter] = useState<"eingereicht" | "abgelehnt">("eingereicht");
  const [items, setItems] = useState<Einreichung[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/recipes?status=${filter}`, { headers: { "x-admin-pin": pin }, cache: "no-store" });
    if (!res.ok) { setItems([]); return; }
    const d = await res.json();
    setItems(d.recipes ?? []);
    setCounts(d.counts ?? {});
  }, [filter, pin]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const setStatus = async (e: Einreichung, status: "veroeffentlicht" | "abgelehnt" | "eingereicht") => {
    let grund: string | undefined;
    if (status === "abgelehnt") {
      const g = window.prompt(`„${e.name}“ ablehnen. Grund (sieht der Einreicher, optional):`, "");
      if (g === null) return;
      grund = g.trim() || undefined;
    }
    setBusy(e.slug); setFehler(null);
    const res = await fetch(`/api/admin/recipes/${encodeURIComponent(e.slug)}/status`, {
      method: "POST",
      headers: { "x-admin-pin": pin, "Content-Type": "application/json" },
      body: JSON.stringify({ status, grund }),
    });
    setBusy(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setFehler(d.error === "noch_nicht_ausgelesen" ? "Das Rezept wird noch ausgelesen." : `Hat nicht geklappt (${d.error ?? res.status}).`);
      return;
    }
    await load();
  };

  return (
    <section id="einreichungen">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Einreichungen</h2>
        <div className="flex items-center rounded-full bg-surface-elevated p-1 border border-border text-xs font-semibold">
          {(["eingereicht", "abgelehnt"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`min-h-9 px-3 rounded-full transition-colors ${filter === f ? "bg-surface text-text-primary border border-border" : "text-text-muted"}`}
            >
              {f === "eingereicht" ? "Offen" : "Abgelehnt"} {counts[f] ? `(${counts[f]})` : ""}
            </button>
          ))}
        </div>
      </div>
      {fehler && <p className="text-xs text-[#bd5138] mb-2">{fehler}</p>}
      {items === null ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-text-muted" /></div>
      ) : items.length === 0 ? (
        <div className="bg-surface border border-border rounded-2xl p-6 text-center text-text-muted text-sm">
          {filter === "eingereicht" ? "Nichts offen. Neue Einreichungen meldet Telegram." : "Keine abgelehnten Rezepte."}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((e) => {
            const p = e.pruefung;
            const auslesen = p?.phase === "auslesen";
            const isOpen = open === e.slug;
            return (
              <div key={e.slug} className="bg-surface border border-border rounded-2xl overflow-hidden">
                <div className="flex gap-3 p-3">
                  <div className="w-20 h-20 shrink-0 rounded-xl overflow-hidden bg-surface-elevated">
                    {e.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/recipes/image/${encodeURIComponent(e.image)}?w=160&ar=1x1&fmt=webp&v=2`} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-text-primary leading-tight">{auslesen ? "Wird ausgelesen …" : e.name}</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {HERKUNFT[e.herkunft] ?? e.herkunft}{e.platform ? ` · ${e.platform}` : ""} · {e.submittedName ?? "Christian"} · {fmt(e.erstelltAm)}
                    </p>
                    {e.source && (
                      <a href={e.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent mt-1 max-w-full">
                        <ExternalLink className="w-3 h-3 shrink-0" /> <span className="truncate">{e.source.replace(/^https?:\/\/(www\.)?/, "")}</span>
                      </a>
                    )}
                    {!auslesen && (
                      <p className="text-xs text-text-secondary mt-1 tabular-nums">
                        {e.category} · {e.kcal ?? "?"} kcal · P {e.protein ?? "?"} · K {e.carbs ?? "?"} · F {e.fat ?? "?"}
                      </p>
                    )}
                  </div>
                </div>

                {p && (p.fehler.length > 0 || p.hinweise.length > 0 || p.dubletten.length > 0) && (
                  <div className="px-3 pb-2 space-y-1">
                    {p.fehler.map((f) => <p key={f} className="text-xs text-[#bd5138]">✕ {f}</p>)}
                    {p.hinweise.map((h) => <p key={h} className="text-xs text-[#a8741a]">! {h}</p>)}
                    {p.dubletten.map((d) => (
                      <a key={d.slug} href={`/rezept/${d.slug}`} target="_blank" rel="noreferrer" className="block text-xs text-text-secondary underline">
                        ↔ {d.name} ({d.grund})
                      </a>
                    ))}
                  </div>
                )}
                {e.statusGrund && <p className="px-3 pb-2 text-xs text-text-muted">Grund: {e.statusGrund}</p>}

                {!auslesen && (
                  <>
                    <button
                      onClick={() => setOpen(isOpen ? null : e.slug)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-text-secondary border-t border-border"
                    >
                      Zutaten und Schritte <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 text-sm text-text-primary space-y-2">
                        {e.description && <p className="text-text-secondary italic">{e.description}</p>}
                        {e.ingredients.map((g, i) => (
                          <div key={i}>
                            {g.group && <p className="font-semibold text-xs mt-1">{g.group}</p>}
                            <ul className="list-disc pl-5">{g.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
                          </div>
                        ))}
                        <ol className="list-decimal pl-5 space-y-1">{e.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                      </div>
                    )}
                  </>
                )}

                <div className="flex border-t border-border">
                  {filter === "eingereicht" ? (
                    <>
                      <button
                        onClick={() => setStatus(e, "abgelehnt")}
                        disabled={busy === e.slug}
                        className="flex-1 min-h-12 flex items-center justify-center gap-1.5 text-sm font-semibold text-[#bd5138] active:bg-surface-elevated disabled:opacity-50"
                      >
                        <X className="w-4 h-4" /> Ablehnen
                      </button>
                      <button
                        onClick={() => setStatus(e, "veroeffentlicht")}
                        disabled={busy === e.slug || auslesen}
                        className="flex-1 min-h-12 flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-accent active:opacity-90 disabled:opacity-50"
                      >
                        {busy === e.slug ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Freigeben
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setStatus(e, "eingereicht")}
                      disabled={busy === e.slug}
                      className="flex-1 min-h-12 text-sm font-semibold text-text-secondary active:bg-surface-elevated disabled:opacity-50"
                    >
                      Wieder öffnen
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
