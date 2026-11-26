import { defineConfig } from "vite";

// Separate from the application config: no .env, API proxy or production state.
export default defineConfig({ envDir: false, server: { host: "127.0.0.1", port: 5186, strictPort: true }, publicDir: "public" });
