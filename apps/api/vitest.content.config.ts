import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/content/**/*.integration.ts"],
    fileParallelism: false,
    testTimeout: 45000
  }
});
