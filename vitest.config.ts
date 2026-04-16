import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60000,
    environment: "node",
    projects: [
      {
        test: {
          name: "default",
          include: ["tests/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["tests/acceptance/**/*.{test,spec}.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        test: {
          name: "acceptance",
          include: ["tests/acceptance/**/*.{test,spec}.{ts,tsx}"],
          environment: "node",
        },
      },
    ],
  },
});
