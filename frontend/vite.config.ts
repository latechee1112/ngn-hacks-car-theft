import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Builds the side panel UI (dist/sidepanel.html + assets).
// Run alongside vite.background.config.ts and vite.content.config.ts — see `npm run build`.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
      },
    },
  },
})
