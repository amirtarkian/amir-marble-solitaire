import { defineConfig } from "vite";

// GitHub Pages serves the site from /amir-marble-solitaire/.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/amir-marble-solitaire/" : "/",
  worker: { format: "es" },
}));
