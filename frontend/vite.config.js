import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: { input: { app: 'index.html', tv: 'tv/index.html' } },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2018'
  }
});
