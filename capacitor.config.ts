import type { CapacitorConfig } from "@capacitor/cli";

/**
 * iOS-Hülle der Rezepte-App (Entscheidung 03.11.2026, siehe docs/APP_STORE_SCHRITTE.md).
 * Ansatz: Die Hülle lädt die Live-Seite (server.url). Die Next-App hat API-Routen, SQLite und
 * Bild-Optimierung; ein statischer Export hieße alles an eine Basis-URL umzubauen. Updates der
 * Web-App kommen ohne neuen Store-Build an. Gegen Guideline 4.2 ("nur eine Webseite") stehen die
 * nativen Funktionen (Haptik, Bildschirm-wach, natives Teilen). app-shell/ ist nur Fallback.
 */
const config: CapacitorConfig = {
  appId: "de.christianarns.rezepte",
  appName: "Rezepte",
  webDir: "app-shell",
  server: {
    url: "https://rezepte.christianarns.de",
    cleartext: false,
    errorPath: "offline.html",
    allowNavigation: ["rezepte.christianarns.de"],
  },
  ios: {
    // Safe-Area regelt die Web-App selbst (viewport-fit=cover)
    contentInset: "never",
    backgroundColor: "#f4eee3",
    appendUserAgent: "RezepteApp",
  },
};

export default config;
