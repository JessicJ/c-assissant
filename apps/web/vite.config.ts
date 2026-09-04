import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const workspaceRoot = new URL("../..", import.meta.url).pathname;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, "");
  const serverPort = Number(process.env.C_ASSISTANT_PORT ?? env.C_ASSISTANT_PORT ?? 8787);
  const googleMapsApiKey = env.VITE_GOOGLE_MAPS_API_KEY ?? env.GOOGLE_MAPS_API_KEY ?? "";
  return {
    envDir: workspaceRoot,
    define: {
      __LANDI_GOOGLE_MAPS_API_KEY__: JSON.stringify(googleMapsApiKey)
    },
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": `http://127.0.0.1:${serverPort}`,
        "/health": `http://127.0.0.1:${serverPort}`
      }
    }
  };
});
