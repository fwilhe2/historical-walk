/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build loads from file:// as well.
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['tests/*.test.ts'], testTimeout: 60000 },
  server: { port: Number(process.env.PORT) || 5173 },
});
