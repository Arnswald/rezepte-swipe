"use client";

/**
 * Toast-System — leichtgewichtige Benachrichtigungen.
 * Context + useToast()-Hook. Ersetzt inline-Statusmeldungen und alert().
 *
 * Nutzung:
 *   const toast = useToast();
 *   toast.success("Gespeichert");
 *   toast.error("Fehlgeschlagen", "Details…");
 */

import { createContext, useContext, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastAPI {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastAPI | null>(null);

export function useToast(): ToastAPI {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast muss innerhalb von <ToastProvider> genutzt werden");
  return ctx;
}

const ICONS: Record<ToastKind, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const ACCENT: Record<ToastKind, string> = {
  success: "text-emerald-400",
  error: "text-red-400",
  info: "text-accent",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, title: string, description?: string) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, kind, title, description }]);
    // Auto-dismiss nach 4s (Fehler etwas länger)
    const ttl = kind === "error" ? 6000 : 4000;
    setTimeout(() => dismiss(id), ttl);
  }, [dismiss]);

  const api: ToastAPI = {
    success: (t, d) => push("success", t, d),
    error: (t, d) => push("error", t, d),
    info: (t, d) => push("info", t, d),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Toast-Stapel: unten mittig auf Mobile, unten rechts auf Desktop */}
      <div className="fixed z-[100] bottom-6 md:bottom-4 left-1/2 -translate-x-1/2 md:left-auto md:right-4 md:translate-x-0 flex flex-col items-center md:items-end gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none">
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const Icon = ICONS[t.kind];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                className="pointer-events-auto w-full flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-surface border border-border shadow-lg"
              >
                <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${ACCENT[t.kind]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary leading-tight">{t.title}</p>
                  {t.description && (
                    <p className="text-xs text-text-muted mt-0.5 leading-snug">{t.description}</p>
                  )}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  className="shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary transition-colors"
                  aria-label="Schließen"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
