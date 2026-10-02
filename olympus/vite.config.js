import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { olympusApiPlugin } from "./server/olympus-api.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [olympusApiPlugin(), react(), tailwindcss()],
  build: {
    // The design-system gallery ships beside the app at /design.html.
    rollupOptions: {
      input: {
        main: path.join(here, "index.html"),
        design: path.join(here, "design.html"),
      },
    },
  },
});
