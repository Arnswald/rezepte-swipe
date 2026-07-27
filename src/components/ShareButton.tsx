"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/**
 * Teilt ein Rezept. Auf dem iPhone öffnet `navigator.share` das native Share-Sheet
 * (→ WhatsApp direkt drin). Fallback: Link in die Zwischenablage + Toast.
 *
 * Die URL wird aus dem aktuellen Origin gebaut (`/rezept/[slug]`), damit sie immer
 * zum laufenden Host passt — lokal wie live.
 */
export function ShareButton({
  slug,
  name,
  className,
  label = "Teilen",
}: {
  slug: string;
  name: string;
  className?: string;
  label?: string;
}) {
  const toast = useToast();
  const [done, setDone] = useState(false);

  const share = async () => {
    const url =
      (typeof window !== "undefined" ? window.location.origin : "") + `/rezept/${slug}`;
    const text = `${name} — schau dir dieses Rezept an:`;

    // 1) Natives Share-Sheet (iOS/Android)
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: name, text, url });
        return;
      } catch {
        // abgebrochen oder nicht erlaubt → still zum Fallback
      }
    }
    // 2) Fallback: Link kopieren
    try {
      await navigator.clipboard.writeText(url);
      setDone(true);
      toast.success("Link kopiert", "Füg ihn z.B. in WhatsApp ein 🍽️");
      setTimeout(() => setDone(false), 1800);
    } catch {
      toast.error("Hat nicht geklappt", "Kopiere den Link aus der Adresszeile.");
    }
  };

  return (
    <button
      onClick={share}
      className={
        className ??
        "flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-surface-elevated border border-border text-text-secondary text-sm font-semibold active:scale-[0.98] transition-transform"
      }
      aria-label={label}
    >
      {done ? <Check className="w-4 h-4 text-emerald-500" /> : <Share2 className="w-4 h-4" />}
      {label}
    </button>
  );
}
