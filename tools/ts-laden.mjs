// Lässt Node (≥ 23.6, Typ-Stripping eingebaut) die TypeScript-Module aus src/ direkt laden,
// ohne tsx/ts-node: löst nur den Pfad-Alias „@/…“ auf (tsconfig paths) und hängt .ts an.
// So nutzen die Werkzeuge denselben Code wie die App (recipes.ts, recipeStore.ts …).
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = join(SRC, specifier.slice(2));
      if (/\.json$/.test(base) && existsSync(base)) return { url: pathToFileURL(base).href, shortCircuit: true };
      const cand = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((c) => existsSync(c));
      if (cand) return { url: pathToFileURL(cand).href, shortCircuit: true, format: "module-typescript" };
    }
    return nextResolve(specifier, context);
  },
  // JSON aus src/ (z. B. kartenbild.json) wie der Bundler laden: ohne `with { type: "json" }`
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".json") && url.includes("/src/")) {
      const text = readFileSync(fileURLToPath(url), "utf8");
      return { format: "module", source: `export default ${text};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
