import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: 30000,
    // Every suite runs with the network blocked; see the file for why.
    setupFiles: ["./tests/setup/no-network.ts"],
    /**
     * One local PostgreSQL, and a queue that is global by design.
     *
     * `claimJob` takes the oldest due job in the table — it does not filter by
     * organization, because in production there is one queue and any consumer
     * may serve any tenant. Two suites running at once against the same
     * database therefore compete for each other's rows, and the failure looks
     * like flakiness rather than what it is: two real consumers.
     *
     * Files run one at a time so a suite can assert about the queue it built.
     * Tests inside a file were already sequential.
     */
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
