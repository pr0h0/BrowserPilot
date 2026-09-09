import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), crx({ manifest: manifest as any })],
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
  build: { target: "esnext", emptyOutDir: true },
  // Stamped into the popup so you can tell a freshly-loaded build from a cached one.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")) },
});
