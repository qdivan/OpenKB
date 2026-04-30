import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/auth.integration.ts"],
    fileParallelism: false,
    testTimeout: 30000
  }
});
