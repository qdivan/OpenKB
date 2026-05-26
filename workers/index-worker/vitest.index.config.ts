import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.ts"],
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 120000
  }
});
