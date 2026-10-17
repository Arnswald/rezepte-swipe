/**
 * Rezept aus der Datenbank → Kochbuch-Markdown (Template aus 00 System/config/Kochbuch-Struktur.md).
 * Für die Kopie nach Obsidian: der Mac-Runner holt /api/admin/recipes/export und schreibt
 * die Dateien nach 06 Research/Gerichte. Der Parser in recipes.ts liest sie verlustfrei zurück
 * (Rundreise geprüft: Felder gleich).
 *
 * `rezepte_app: true` im Frontmatter markiert Dateien, die der Export geschrieben hat. Nur die
 * darf er später überschreiben; Christians eigene Rezepte fasst er nie an.
 */

import type { StoredRecipe } from "@/lib/recipeStore";

const yaml = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ").trim()}"`;
const zahl = (v: number | null) => (v == null ? "" : String(Math.round(v)));

export function recipeMarkdown(r: StoredRecipe, opts: { titelbild: string | null; eingereichtVon?: string | null }): string {
  const fm = [
    `name: ${yaml(r.name)}`,
    `Kurzbeschreibung: ${yaml(r.description)}`,
    `kategorie: ${r.category}`,
    `kalorien: ${zahl(r.kcal)}`,
    `protein: ${zahl(r.protein)}`,
    `kohlenhydrate: ${zahl(r.carbs)}`,
    `fette: ${zahl(r.fat)}`,
    `Profilbild: ${opts.titelbild ?? ""}`,
    `erstellt: ${r.created}`,
    ...(r.source ? [`quelle: ${r.source}`] : []),
    ...(opts.eingereichtVon ? [`eingereicht_von: ${yaml(opts.eingereichtVon)}`] : []),
    `rezepte_app: true`,
  ].join("\n");

  const zutaten = r.ingredients
    .map((g) => [g.group ? `**${g.group}:**` : null, ...g.items.map((i) => `- [ ] ${i}`)].filter(Boolean).join("\n"))
    .join("\n\n");
  const schritte = r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const tipps = r.tips.map((t) => `- ${t}`).join("\n");

  return `---
${fm}
---
# ${r.name}

${opts.titelbild ? `![[${opts.titelbild}]]\n\n` : ""}> *${r.description}*

---

## 📋 Überblick

| | |
|---|---|
| ⏳ Gesamtzeit | ${r.totalTime ?? ""} |
| 👥 Portionen | ${r.portions ?? ""} |
| 📊 Schwierigkeit | ${r.difficulty ?? ""} |
| 🍽️ Kategorie | ${r.category} |
| 🔥 Kalorien | ${zahl(r.kcal)} kcal |
| 💪 Protein | ${zahl(r.protein)}g |
| 🌾 Kohlenhydrate | ${zahl(r.carbs)}g |
| 🧈 Fette | ${zahl(r.fat)}g |

---

## 🛒 Zutaten

${zutaten}

---

## 👨‍🍳 Zubereitung

${schritte}

---

## 💡 Tipps & Variationen

${tipps}

---

## 📝 Meine Notizen

*(Nach dem Kochen: Was war gut? Was würde ich ändern?)*
`;
}
