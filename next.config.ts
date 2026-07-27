import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone-Output → schlankes Docker-Image (nur die nötigen node_modules)
  output: "standalone",
  // Native-Pakete: sharp (Bilder → WebP), better-sqlite3 (Verdict-Speicher)
  serverExternalPackages: ["sharp", "better-sqlite3"],
};

export default nextConfig;
