import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    environment: "jsdom",
    globals    : true,
    setupFiles : ["./vitest.setup.ts"],
    include    : ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    coverage   : {
      provider: "v8",
      reporter: ["text", "html"],
      include : ["src/server/**/*.ts", "src/lib/**/*.ts"],
      exclude : ["**/*.test.ts", "**/*.d.ts", "src/server/db/migrate.ts"]
    }
  }
});
