import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // In dev the API Worker (apps/api) runs separately; proxy /api to it so the
  // browser sees one origin, matching production (app.relayrunner.dev/api).
  const apiOrigin = env.API_DEV_ORIGIN ?? "http://localhost:8787";

  return {
    plugins: [
      // Must run before the React plugin.
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
      tailwindcss(),
      cloudflare(),
    ],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 5179,
      proxy: {
        "/api": { target: apiOrigin, changeOrigin: true },
      },
    },
  };
});
