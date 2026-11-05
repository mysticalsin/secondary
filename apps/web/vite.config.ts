/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The app's CSP allows fonts from 'self' only, not data: URLs, so a font is never inlined.
    assetsInlineLimit: (file) => (/\.(?:woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  server: { proxy: { "/v1": "http://localhost:8787" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    env: { VITE_MOCK: "1" },
  },
});
