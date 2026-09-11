/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ base: "/collections-copilot/", plugins: [react()], build: { outDir: "dist/app" }, test: { include: ["tests/**/*.test.ts"] } });
