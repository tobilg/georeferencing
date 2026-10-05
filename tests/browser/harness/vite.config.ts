import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// As in the demo: scan the excluded workspace packages' dist files so their
// third-party imports (including lazy pdf-lib) are optimized at startup instead of
// triggering a full page reload in the middle of a test.
const workspaceDist = [
  "core",
  "plugins",
  "react",
  "openlayers",
  "maplibre",
  "leaflet",
].map((name) =>
  fileURLToPath(
    new URL(`../../../packages/${name}/dist/**/*.js`, import.meta.url),
  ),
);

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: false,
  worker: { format: "es" },
  optimizeDeps: {
    entries: ["*.html", ...workspaceDist],
    exclude: [
      "@georeferencing/core",
      "@georeferencing/plugins",
      "@georeferencing/react",
      "@georeferencing/openlayers",
      "@georeferencing/maplibre",
      "@georeferencing/leaflet",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] },
  },
});
