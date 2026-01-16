import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["summarize.sciencegpt.ca"],
    port: 3000,
    open: true,
    watch: {
      ignored: [
        "**/backend/**",
        "**/node_modules/**",
        "**/.git/**",
        "**/venv/**",
      ],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
  },
});
