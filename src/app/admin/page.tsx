"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Loader2, RefreshCw, LogOut, Heart, Star, X, ChevronDown, Lock, Trash2, Copy, Link2, Plus } from "lucide-react";
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
// Spiegel von AdminPerson aus /api/admin/persons
interface AdminPerson {
  guestId: string; name: string; friendCode: string | null;
  likes: number; supers: number; nopes: number; total: number;
  connections: number; connectedTo: { guestId: string; name: string }[];
  liked: string[]; lastActive: string | null; createdAt: string | null;
}
// Spiegel von AdminGroup aus /api/admin/groups
interface AdminGroup {
  id: string; name: string; code: string; createdAt: string;
  members: { guestId: string; name: string }[]; memberCount: number;
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
  const [persons, setPersons] = useState<AdminPerson[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
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
        // Personen + Gruppen fürs Verwaltungs-Panel nachladen
        const pRes = await fetch("/api/admin/persons", { headers: { "x-admin-pin": usePin }, cache: "no-store" });
        if (pRes.ok) setPersons(((await pRes.json()).persons ?? []) as AdminPerson[]);
        const gRes = await fetch("/api/admin/groups", { headers: { "x-admin-pin": usePin }, cache: "no-store" });
        if (gRes.ok) setGroups(((await gRes.json()).groups ?? []) as AdminGroup[]);
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

  // Person löschen (kaskadierend), danach neu laden
  const deletePerson = useCallback(async (guestId: string) => {
    const res = await fetch("/api/admin/persons", {
      method: "DELETE",
      headers: { "x-admin-pin": pin, "Content-Type": "application/json" },
      body: JSON.stringify({ guestId }),
    });
    if (res.ok) await load(pin);
  }, [pin, load]);

  // Zwei Personen verbinden / trennen (Admin), danach neu laden
  const setConnection = useCallback(async (a: string, b: string, connect: boolean) => {
    const res = await fetch("/api/admin/connections", {
      method: connect ? "POST" : "DELETE",
      headers: { "x-admin-pin": pin, "Content-Type": "application/json" },
      body: JSON.stringify({ a, b }),
    });
    if (res.ok) await load(pin);
  }, [pin, load]);

  // Gruppen-Aktionen (Admin), danach neu laden
  const groupApi = useCallback(async (method: string, body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/groups", {
      method,
      headers: { "x-admin-pin": pin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) await load(pin);
  }, [pin, load]);
  const createGroup = useCallback((name: string) => groupApi("POST", { action: "create", name }), [groupApi]);
  const deleteGroup = useCallback((groupId: string) => groupApi("DELETE", { groupId }), [groupApi]);
  const setGroupMember = useCallback((groupId: string, guestId: string, add: boolean) =>
    groupApi("POST", { action: add ? "addMember" : "removeMember", groupId, guestId }), [groupApi]);

  // Beim Öffnen: gespeicherten PIN probieren
  useEffect(() => {
    const saved = sessionStorage.getItem(PIN_KEY);
    if (saved) { setPin(saved); load(saved); }
  }, [load]);

  const logout = () => { sessionStorage.removeItem(PIN_KEY); setAuthed(false); setStats(null); setPersons([]); setGroups([]); setPin(""); };

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

          {/* Personen — Verwaltung (löschen etc.) */}
          {persons.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">
                Personen <span className="normal-case text-text-muted/60">({persons.length})</span>
              </h2>
              <div className="space-y-2">
                {persons.map((p) => (
                  <PersonAdminRow key={p.guestId} p={p} allPersons={persons} onDelete={deletePerson} onConnect={setConnection} />
                ))}
              </div>
            </section>
          )}

          {/* Gruppen — Verwaltung */}
          <section>
            <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">
              Gruppen <span className="normal-case text-text-muted/60">({groups.length})</span>
            </h2>
            <div className="flex items-center gap-2 mb-3">
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newGroupName.trim()) { createGroup(newGroupName.trim()); setNewGroupName(""); } }}
                placeholder="Neue Gruppe (Name)…"
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => { if (newGroupName.trim()) { createGroup(newGroupName.trim()); setNewGroupName(""); } }}
                disabled={!newGroupName.trim()}
                className="shrink-0 px-3.5 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-40 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> Gruppe
              </button>
            </div>
            {groups.length > 0 && (
              <div className="space-y-2">
                {groups.map((g) => (
                  <GroupAdminRow key={g.id} g={g} allPersons={persons} onSetMember={setGroupMember} onDelete={deleteGroup} />
                ))}
              </div>
            )}
          </section>

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

// Einzelne Person (aufklappbar). Löschen (zweistufig) + Verbindungen verwalten.
function PersonAdminRow({
  p, allPersons, onDelete, onConnect,
}: {
  p: AdminPerson;
  allPersons: AdminPerson[];
  onDelete: (guestId: string) => Promise<void>;
  onConnect: (a: string, b: string, connect: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const del = async () => {
    setDeleting(true);
    try { await onDelete(p.guestId); } finally { setDeleting(false); }
  };

  const copyCode = async () => {
    if (!p.friendCode) return;
    try { await navigator.clipboard.writeText(p.friendCode); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  // Kandidaten zum Verbinden: andere Personen mit Code, noch nicht verbunden
  const connectedIds = new Set(p.connectedTo.map((c) => c.guestId));
  const candidates = allPersons.filter((o) => o.guestId !== p.guestId && o.friendCode && !connectedIds.has(o.guestId));

  const connect = async (otherId: string) => {
    setBusy(true);
    try { await onConnect(p.guestId, otherId, true); setPicking(false); } finally { setBusy(false); }
  };
  const disconnect = async (otherId: string) => {
    setBusy(true);
    try { await onConnect(p.guestId, otherId, false); } finally { setBusy(false); }
  };

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
          <div className="w-9 h-9 rounded-full bg-accent/12 text-accent flex items-center justify-center text-sm font-bold shrink-0">
            {p.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary truncate">{p.name}</p>
            <p className="text-[11px] text-text-muted tabular-nums">
              {p.likes + p.supers} mögen · {p.nopes} nö · {p.connections} verbunden
            </p>
          </div>
          {p.friendCode && (
            <span className="shrink-0 text-[11px] font-mono font-semibold text-accent bg-accent/10 border border-accent/15 rounded-md px-1.5 py-0.5">
              {p.friendCode}
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-text-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {!confirm ? (
          <button
            onClick={() => setConfirm(true)}
            aria-label={`${p.name} löschen`}
            className="shrink-0 w-8 h-8 rounded-lg text-text-muted hover:text-[#bd5138] hover:bg-[#bd5138]/10 flex items-center justify-center transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        ) : (
          <div className="shrink-0 flex items-center gap-1">
            <button
              onClick={del}
              disabled={deleting}
              className="px-2.5 py-1.5 rounded-lg bg-[#bd5138] text-white text-xs font-semibold flex items-center gap-1 active:scale-95 transition-transform disabled:opacity-60"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Löschen
            </button>
            <button
              onClick={() => setConfirm(false)}
              disabled={deleting}
              className="px-2 py-1.5 rounded-lg bg-surface-elevated border border-border text-text-muted text-xs"
            >
              Abbr.
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="px-4 pb-3 -mt-1 space-y-3">
          {/* Code kopieren */}
          {p.friendCode && (
            <button
              onClick={copyCode}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold text-text-secondary bg-surface-elevated border border-border rounded-md px-2 py-1 active:scale-95 transition-transform"
            >
              {copied ? "Kopiert ✓" : <><Copy className="w-3 h-3" /> {p.friendCode}</>}
            </button>
          )}

          {/* Verbindungen verwalten */}
          <div>
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1.5 flex items-center gap-1">
              <Link2 className="w-3 h-3" /> Verbunden mit
            </p>
            {p.connectedTo.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {p.connectedTo.map((c) => (
                  <span key={c.guestId} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-[11px] font-medium bg-accent/10 text-accent border border-accent/15">
                    {c.name}
                    <button onClick={() => disconnect(c.guestId)} disabled={busy} aria-label="Verbindung trennen" className="w-4 h-4 rounded-full hover:bg-[#bd5138]/15 hover:text-[#bd5138] flex items-center justify-center">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted">Noch mit niemandem verbunden.</p>
            )}

            {!picking ? (
              candidates.length > 0 && (
                <button onClick={() => setPicking(true)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent">
                  <Plus className="w-3.5 h-3.5" /> verbinden
                </button>
              )
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {candidates.map((o) => (
                  <button
                    key={o.guestId}
                    onClick={() => connect(o.guestId)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-surface-elevated border border-border text-text-secondary active:scale-95 transition-transform disabled:opacity-50"
                  >
                    {o.name} <span className="font-mono text-text-muted">{o.friendCode}</span>
                  </button>
                ))}
                <button onClick={() => setPicking(false)} className="px-2 py-1 text-[11px] text-text-muted">Abbr.</button>
              </div>
            )}
          </div>

          {/* Zusatz-Infos + Favoriten */}
          <p className="text-[11px] text-text-muted tabular-nums">
            {p.total} Bewertungen{p.lastActive ? ` · zuletzt ${fmtTime(p.lastActive)}` : ""}
          </p>
          {p.liked.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.liked.map((r, i) => (
                <span key={i} className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#3f6b43]/10 text-[#3f6b43] border border-[#3f6b43]/15">{r}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Eine Gruppe im Admin: Mitglieder verwalten (hinzufügen/entfernen) + löschen.
function GroupAdminRow({
  g, allPersons, onSetMember, onDelete,
}: {
  g: AdminGroup;
  allPersons: AdminPerson[];
  onSetMember: (groupId: string, guestId: string, add: boolean) => Promise<void>;
  onDelete: (groupId: string) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const memberIds = new Set(g.members.map((m) => m.guestId));
  const candidates = allPersons.filter((p) => !memberIds.has(p.guestId));

  const del = async () => { setDeleting(true); try { await onDelete(g.id); } finally { setDeleting(false); } };
  const add = async (guestId: string) => { setBusy(true); try { await onSetMember(g.id, guestId, true); setPicking(false); } finally { setBusy(false); } };
  const remove = async (guestId: string) => { setBusy(true); try { await onSetMember(g.id, guestId, false); } finally { setBusy(false); } };

  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-text-primary truncate">{g.name}</p>
          <p className="text-[11px] text-text-muted tabular-nums">{g.memberCount} {g.memberCount === 1 ? "Mitglied" : "Mitglieder"}</p>
        </div>
        <span className="shrink-0 text-[11px] font-mono font-semibold text-accent bg-accent/10 border border-accent/15 rounded-md px-1.5 py-0.5">{g.code}</span>
        {!confirm ? (
          <button onClick={() => setConfirm(true)} aria-label="Gruppe löschen" className="shrink-0 w-8 h-8 rounded-lg text-text-muted hover:text-[#bd5138] hover:bg-[#bd5138]/10 flex items-center justify-center">
            <Trash2 className="w-4 h-4" />
          </button>
        ) : (
          <div className="shrink-0 flex items-center gap-1">
            <button onClick={del} disabled={deleting} className="px-2.5 py-1.5 rounded-lg bg-[#bd5138] text-white text-xs font-semibold flex items-center gap-1 disabled:opacity-60">
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Löschen
            </button>
            <button onClick={() => setConfirm(false)} disabled={deleting} className="px-2 py-1.5 rounded-lg bg-surface-elevated border border-border text-text-muted text-xs">Abbr.</button>
          </div>
        )}
      </div>
      {g.members.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {g.members.map((m) => (
            <span key={m.guestId} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-[11px] font-medium bg-accent/10 text-accent border border-accent/15">
              {m.name}
              <button onClick={() => remove(m.guestId)} disabled={busy} aria-label="Aus Gruppe entfernen" className="w-4 h-4 rounded-full hover:bg-[#bd5138]/15 hover:text-[#bd5138] flex items-center justify-center">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-muted">Noch keine Mitglieder.</p>
      )}
      {!picking ? (
        candidates.length > 0 && (
          <button onClick={() => setPicking(true)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent">
            <Plus className="w-3.5 h-3.5" /> Mitglied
          </button>
        )
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {candidates.map((p) => (
            <button key={p.guestId} onClick={() => add(p.guestId)} disabled={busy} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-surface-elevated border border-border text-text-secondary disabled:opacity-50">
              {p.name}{p.friendCode && <span className="font-mono text-text-muted">{p.friendCode}</span>}
            </button>
          ))}
          <button onClick={() => setPicking(false)} className="px-2 py-1 text-[11px] text-text-muted">Abbr.</button>
        </div>
      )}
    </div>
  );
}
