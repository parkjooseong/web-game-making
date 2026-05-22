import { defineConfig } from "vite";

export default defineConfig({
  base: "/web-game-making/",
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/phaser")) {
            return "vendor-phaser";
          }
          if (id.includes("node_modules/@mediapipe")) {
            return "vendor-mediapipe";
          }
          if (id.includes("node_modules")) {
            return "vendor";
          }
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  }
});
