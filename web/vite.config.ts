import { defineConfig } from "vite";

// GitHub Pages serves the site from /amir-marble-solitaire/.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/amir-marble-solitaire/" : "/",
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 800 }, // three.js alone is ~600 kB
}));
