// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  root: "public",
  build: {
    outDir: "../dist",
    rollupOptions: {
      input: "public/index.html",
    },
  },
});
