import { defineConfig } from "vite";
// В режиме разработки API живёт на отдельном порту; changeOrigin выключен, чтобы Origin и Host совпадали (защита от чужих сайтов).
export default defineConfig({
  build: { target: "es2022" },
  server: { proxy: { "/api": { target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:4173", changeOrigin: false } } },
});
