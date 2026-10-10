import { build } from 'vite';
import path from 'node:path';

async function buildExtensionScripts() {
  console.log('[Handsfree Build] Bundling content.js as standalone IIFE...');
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: path.resolve('src/content/content.ts'),
        output: {
          entryFileNames: 'content.js',
          format: 'iife',
          name: 'HandsfreeContentScript',
          inlineDynamicImports: true,
        },
      },
    },
  });

  console.log('[Handsfree Build] Bundling service-worker.js as standalone ES module...');
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: path.resolve('src/background/service-worker.ts'),
        output: {
          entryFileNames: 'service-worker.js',
          format: 'es',
          inlineDynamicImports: true,
        },
      },
    },
  });

  console.log('[Handsfree Build] Standalone extension scripts successfully built!');
}

buildExtensionScripts().catch((err) => {
  console.error('[Handsfree Build] Error bundling extension scripts:', err);
  process.exit(1);
});
