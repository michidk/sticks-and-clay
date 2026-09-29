import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
export default defineConfig({
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
  plugins: [tailwind(), tanstackStart(), nitro({ preset: "bun" }), react()],
});
