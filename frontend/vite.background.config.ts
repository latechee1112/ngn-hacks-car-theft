import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Builds the MV3 background service worker as a standalone ES module (dist/background.js).
// MV3 service workers support "type": "module", declared in public/manifest.json.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/background/background.ts'),
      output: {
        format: 'es',
        entryFileNames: 'background.js',
      },
    },
  },
})
