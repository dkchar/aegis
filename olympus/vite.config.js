import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { olympusApiPlugin } from "./server/olympus-api.js";

export default defineConfig({
  plugins: [olympusApiPlugin(), react(), tailwindcss()],
});
