import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/content/**/*.integration.ts"],
    fileParallelism: false,
    hookTimeout: 45000,
    testTimeout: 45000
  }
});
