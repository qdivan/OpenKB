import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.import-test.ts"],
    fileParallelism: false,
    testTimeout: 60000
  }
});
