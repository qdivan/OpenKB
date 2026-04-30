import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts", "workers/**/*.test.ts"]
  }
});
