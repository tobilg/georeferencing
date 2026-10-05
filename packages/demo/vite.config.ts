import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// Built workspace packages are linked and excluded from pre-bundling (their workers
// resolve relative to their own modules). Scan their dist files as extra entries so
// Vite discovers their third-party imports, including lazy ones such as pdf-lib, at
// startup. Otherwise the dev server optimizes them on first use and reloads the page,
// discarding the editor session (for example on the first PDF export).
const workspaceDist = [
  "core",
  "plugins",
  "react",
  "openlayers",
  "maplibre",
  "leaflet",
].map((name) =>
  fileURLToPath(new URL(`../${name}/dist/**/*.js`, import.meta.url)),
);

export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  optimizeDeps: {
    entries: ["index.html", ...workspaceDist],
    exclude: [
      "@georeferencing/core",
      "@georeferencing/plugins",
      "@georeferencing/react",
      "@georeferencing/openlayers",
      "@georeferencing/maplibre",
      "@georeferencing/leaflet",
    ],
  },
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
});
