import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const coreSource = (path: string) =>
  fileURLToPath(new URL(`packages/core/src/${path}`, import.meta.url));

export default defineConfig({
  // Tests import core from source; resolve the package entries (used by the adapter and
  // plugin packages) to the same modules, so a single copy of core is loaded.
  resolve: {
    alias: [
      {
        find: /^@georeferencing\/core(\/core)?$/,
        replacement: coreSource("core/index.ts"),
      },
      {
        find: /^@georeferencing\/core\/engine$/,
        replacement: coreSource("engine/index.ts"),
      },
      {
        find: /^@georeferencing\/core\/map$/,
        replacement: coreSource("map/index.ts"),
      },
    ],
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
