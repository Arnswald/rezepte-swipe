"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Loader2, RefreshCw, LogOut, Heart, Star, X, ChevronDown, Lock } from "lucide-react";
import { AnimatedInput } from "@/components/ui/AnimatedInput";

// ── Types (Spiegel der Stats-API) ─────────────────────────────
interface Recipe { slug: string; name: string; category: string; like: number; super: number; nope: number; score: number }
interface Guest { guestId: string; name: string; like: number; super: number; nope: number; total: number; lastActive: string; liked: string[] }
interface Recent { name: string; recipeName: string; verdict: "like" | "nope" | "super"; updatedAt: string }
interface Stats {
  totals: { guests: number; verdicts: number; likes: number; supers: number; nopes: number };
  recipes: Recipe[];
  guests: Guest[];
  recent: Recent[];
}

const PIN_KEY = "rezepte-admin-pin";

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

const VERDICT_LABEL: Record<Recent["verdict"], { text: string; cls: string }> = {
  like: { text: "👍 lecker", cls: "text-[#3f6b43]" },
  super: { text: "⭐ superlike", cls: "text-[#d99a2b]" },
  nope: { text: "✕ nö", cls: "text-[#bd5138]" },
};

export default function AdminPage() {
  const [pin, setPin] = useState("");
  const [authed, setAuthed] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (usePin: string) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/admin/stats", { headers: { "x-admin-pin": usePin }, cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as Stats;
        setStats(d); setAuthed(true);
        sessionStorage.setItem(PIN_KEY, usePin);
      } else if (res.status === 401) {
        setError("Falscher PIN."); setAuthed(false); sessionStorage.removeItem(PIN_KEY);
      } else if (res.status === 503) {
        setError("Admin ist noch nicht konfiguriert — ADMIN_PIN in Portainer setzen.");
      } else {
        setError("Fehler beim Laden.");
      }
    } catch {
      setError("Keine Verbindung.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Beim Öffnen: gespeicherten PIN probieren
  useEffect(() => {
    const saved = sessionStorage.getItem(PIN_KEY);
    if (saved) { setPin(saved); load(saved); }
  }, [load]);

  const logout = () => { sessionStorage.removeItem(PIN_KEY); setAuthed(false); setStats(null); setPin(""); };

  // ── PIN-Gate ────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-surface border border-border rounded-3xl p-6 shadow-[0_10px_30px_rgba(70,50,30,0.10)]">
          <div className="w-12 h-12 rounded-2xl bg-accent/12 text-accent flex items-center justify-center mb-4">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-extrabold text-text-primary tracking-tight">Admin — Rezepte</h1>
          <p className="text-sm text-text-muted mt-1 mb-5">PIN eingeben, um die Auswertung zu sehen.</p>
          <AnimatedInput
            label="PIN" value={pin} onChange={setPin} type="password" inputMode="numeric"
            onKeyDown={(e) => { if (e.key === "Enter") load(pin); }}
          />
          {error && <p className="text-xs text-[#bd5138] mt-2">{error}</p>}
          <button
            onClick={() => load(pin)}
            disabled={loading || !pin}
            className="mt-4 w-full py-3 rounded-xl bg-accent text-white text-sm font-semibold active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Einloggen
          </button>
        </div>
      </div>
    );
  }

  // ── Dashboard ───────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-text-primary tracking-tight">Auswertung</h1>
          <p className="text-sm text-text-muted mt-0.5">Was den Gästen schmeckt.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load(pin)} aria-label="Aktualisieren" className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center text-text-secondary active:scale-90 transition-transform">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={logout} aria-label="Abmelden" className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center text-text-secondary active:scale-90 transition-transform">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {stats && (
        <>
          {/* Summary-Kacheln */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Gäste", value: stats.totals.guests, cls: "text-text-primary" },
              { label: "Bewertungen", value: stats.totals.verdicts, cls: "text-text-primary" },
              { label: "Likes", value: stats.totals.likes, cls: "text-[#3f6b43]" },
              { label: "Superlikes", value: stats.totals.supers, cls: "text-[#d99a2b]" },
            ].map((t) => (
              <div key={t.label} className="bg-surface border border-border rounded-2xl p-4">
                <div className={`text-2xl font-extrabold tabular-nums ${t.cls}`}>{t.value}</div>
                <div className="text-xs text-text-muted mt-0.5">{t.label}</div>
              </div>
            ))}
          </div>

          {stats.totals.verdicts === 0 && (
            <div className="bg-surface border border-border rounded-2xl p-8 text-center text-text-muted text-sm">
              Noch keine Bewertungen. Sobald jemand wischt, erscheint es hier.
            </div>
          )}

          {/* Beliebteste Gerichte */}
          {stats.recipes.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">Beliebteste Gerichte</h2>
              <div className="space-y-2">
                {stats.recipes.map((r, i) => (
                  <motion.div
                    key={r.slug}
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                    className="flex items-center gap-3 bg-surface border border-border rounded-xl px-4 py-3"
                  >
                    <span className="text-sm font-bold text-text-muted tabular-nums w-5">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-text-primary truncate">{r.name}</p>
                      <p className="text-[11px] text-text-muted">{r.category}</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs font-semibold tabular-nums shrink-0">
                      <span className="flex items-center gap-1 text-[#3f6b43]"><Heart className="w-3.5 h-3.5" />{r.like}</span>
                      <span className="flex items-center gap-1 text-[#d99a2b]"><Star className="w-3.5 h-3.5" />{r.super}</span>
                      <span className="flex items-center gap-1 text-[#bd5138]"><X className="w-3.5 h-3.5" />{r.nope}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {/* Gäste */}
          {stats.guests.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">Gäste</h2>
              <div className="space-y-2">
                {stats.guests.map((g) => <GuestRow key={g.guestId} g={g} />)}
              </div>
            </section>
          )}

          {/* Zuletzt */}
          {stats.recent.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">Zuletzt</h2>
              <div className="space-y-1.5">
                {stats.recent.map((r, i) => {
                  const v = VERDICT_LABEL[r.verdict];
                  return (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="font-semibold text-text-primary">{r.name}</span>
                      <span className={`${v.cls} font-medium`}>{v.text}</span>
                      <span className="text-text-secondary truncate">{r.recipeName}</span>
                      <span className="text-text-muted text-[11px] ml-auto shrink-0 tabular-nums">{fmtTime(r.updatedAt)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// Einzelne Gast-Zeile (aufklappbar: was mochte diese Person)
function GuestRow({ g }: { g: Guest }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <div className="w-9 h-9 rounded-full bg-accent/12 text-accent flex items-center justify-center text-sm font-bold shrink-0">
          {g.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary truncate">{g.name}</p>
          <p className="text-[11px] text-text-muted tabular-nums">
            {g.like + g.super} mögen · {g.nope} nö · {g.total} gesamt
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-text-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-3 -mt-1">
          {g.liked.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {g.liked.map((r, i) => (
                <span key={i} className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#3f6b43]/10 text-[#3f6b43] border border-[#3f6b43]/15">{r}</span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">Noch nichts gemocht.</p>
          )}
        </div>
      )}
    </div>
  );
}
