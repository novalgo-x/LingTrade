import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    port: 26680,
    proxy: {
      "/api": {
        target: "http://localhost:26681",
        changeOrigin: true,
      },
    },
  },
});
