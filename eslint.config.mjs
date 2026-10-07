// eslint-config-next 16 liefert fertige Flat-Configs. Der alte FlatCompat-Weg
// (compat.extends("next/…")) bricht mit „Converting circular structure to JSON“ ab.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // _-Präfix = bewusst ungenutzt; ...rest-Destructuring zum Weglassen von Feldern
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  { ignores: [".next/**", "node_modules/**", "data/**", "next-env.d.ts"] },
];

export default eslintConfig;
