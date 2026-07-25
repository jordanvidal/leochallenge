// Vitest ne sert que la logique métier pure de `lib/` — pas de rendu, pas
// de base, pas de DOM. Le seul réglage nécessaire est l'alias `@/` de
// tsconfig, que Vite ne lit pas tout seul.

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
