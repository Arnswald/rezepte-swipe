import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone-Output → schlankes Docker-Image (nur die nötigen node_modules)
  output: "standalone",
  // sharp läuft als externes Native-Paket (Rezept-Bilder: PNG → WebP)
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
