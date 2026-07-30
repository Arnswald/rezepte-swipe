import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone-Output → schlankes Docker-Image (nur die nötigen node_modules)
  output: "standalone",
  // Native-Pakete: sharp (Bilder → WebP), better-sqlite3 (Verdict-Speicher)
  serverExternalPackages: ["sharp", "better-sqlite3"],
  // HTML-Seiten IMMER revalidieren, damit neue Deploys beim nächsten Laden ankommen
  // (kein Service Worker im Spiel). Gehashte Assets unter /_next/static bleiben
  // unberührt → weiterhin immutable gecacht, kein Performance-Verlust.
  async headers() {
    const noCache = [{ key: "Cache-Control", value: "no-cache, must-revalidate" }];
    return [
      { source: "/", headers: noCache },
      { source: "/admin", headers: noCache },
      { source: "/rezept/:slug*", headers: noCache },
    ];
  },
};

export default nextConfig;
