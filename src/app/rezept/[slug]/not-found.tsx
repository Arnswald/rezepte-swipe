import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** 404 für /rezept/<unbekannt>: echter Statuscode statt 200 mit Hinweistext. */
export default function RezeptNichtGefunden() {
  return (
    <main className="min-h-[100dvh] flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-4">🤔</div>
        <h1 className="text-xl font-extrabold text-text-primary">Rezept nicht gefunden</h1>
        <p className="text-sm text-text-secondary mt-2">
          Vielleicht wurde es umbenannt. Schau in der App vorbei:
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-1 px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold"
        >
          Zur Rezepte-App <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </main>
  );
}
