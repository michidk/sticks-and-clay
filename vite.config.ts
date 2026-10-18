import { defineConfig, type Plugin } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const edition = process.env.STUDIO_EDITION ?? "standard";
if (edition !== "standard" && edition !== "demo") throw new Error("STUDIO_EDITION must be standard or demo");
const demo = edition === "demo";
const src = (path: string) => new URL("./src/" + path, import.meta.url).pathname;

// Imports of the database client are relative, so swap the resolved module rather than an alias.
const demoDatabase: Plugin = {
  name: "studio-demo-database",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (!source.endsWith("db/client")) return;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    if (resolved?.id === src("db/client.ts")) return src("db/demo.ts");
  },
};

export default defineConfig({
  define: { __STUDIO_DEMO_MODE__: JSON.stringify(demo) },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: {
    allowedHosts: true,
    watch: {
      ignored: [
        "**/data/**",
        "**/eve/**",
        "**/blender/**",
        "**/scripts/**",
        "**/drizzle/**",
        "**/.venv/**",
      ],
    },
  },
  plugins: [
    ...(demo ? [demoDatabase] : []),
    tailwind(),
    tanstackStart(),
    nitro(demo ? { preset: "vercel" } : { preset: "bun", entry: "./src/serve.server.ts" }),
    react(),
  ],
});
