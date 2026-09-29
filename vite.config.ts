import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function githubPagesFallback() {
  return {
    name: "github-pages-fallback",
    closeBundle() {
      copyFileSync(resolve("dist/index.html"), resolve("dist/404.html"));
    },
  };
}

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/Procurement-Department/" : "/",
  plugins: [react(), githubPagesFallback()],
  server: {
    port: 5173,
  },
});
