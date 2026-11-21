import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live checks run outside Next.js, so load the same local credentials that
// `next dev` would load. process.loadEnvFile is available on the supported Node runtime.
const envFile = fileURLToPath(new URL("./.env.local", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** Live integration checks. Never treated as unit verification. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/live/**/*.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
});
