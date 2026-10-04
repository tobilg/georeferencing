import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: false,
  worker: { format: "es" },
  optimizeDeps: {
    exclude: [
      "@georeferencing/core",
      "@georeferencing/plugins",
      "@georeferencing/react",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] },
  },
});
