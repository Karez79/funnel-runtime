import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  // Never inline assets as data: URLs: the CSP allows fonts and images from 'self' only.
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
});
