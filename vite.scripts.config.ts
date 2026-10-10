import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: {
        content: resolve(__dirname, 'src/content/content.ts'),
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        // Inline all dependencies so content.js and service-worker.js have zero external imports
        manualChunks: undefined,
      },
    },
  },
});
