import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "node_modules/**", ".design/**", "coverage/**"]),
  {
    rules: {
      "@next/next/no-img-element": "off",
      // New React compiler diagnostics. These are legitimate external-system
      // synchronisation effects (localStorage hydration, route-driven state,
      // async archive loads), not render cascades.
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
