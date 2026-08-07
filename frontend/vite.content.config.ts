import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Builds the content script as a single IIFE bundle (dist/content.js).
// Content scripts are injected as classic scripts, so no ES module imports allowed.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/content/content.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
      },
    },
  },
})
