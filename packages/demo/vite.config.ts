import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  optimizeDeps: {
    exclude: [
      "@georeferencing/core",
      "@georeferencing/plugins",
      "@georeferencing/react",
    ],
  },
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
});
