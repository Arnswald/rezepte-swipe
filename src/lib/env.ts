/**
 * Minimale Env-Konfiguration der Rezepte-App.
 *
 * Rezept-Quelle: bevorzugt absolute Pfade (OBSIDIAN_RECIPES_PATH /
 * OBSIDIAN_IMAGES_PATH) — im Container der read-only Mount. recipes.ts liest
 * diese direkt aus process.env; hier steht nur der Vault-Fallback.
 */
export const env = {
  /** Fallback, wenn statt der abs. Pfade der ganze Vault gemountet ist */
  OBSIDIAN_VAULT_PATH: process.env.OBSIDIAN_VAULT_PATH,
  /** Schreibbarer Datenordner: Bild-Cache (WebP) + eingegangene Vorschläge */
  DATA_DIR: process.env.DATA_DIR ?? "./data",
  /** Optional (Phase 2): Vorschläge zusätzlich an einen n8n-Webhook posten */
  N8N_SUGGEST_WEBHOOK: process.env.N8N_SUGGEST_WEBHOOK,
};
