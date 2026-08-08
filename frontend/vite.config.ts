import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// Builds the side panel UI (dist/sidepanel.html + assets).
// Run alongside vite.background.config.ts and vite.content.config.ts — see `npm run build`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // All three extension bundles share dist/. Production builds opt into
    // cleaning via the CLI; watch builds must preserve sibling bundles.
    emptyOutDir: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
        calibration: resolve(import.meta.dirname, 'calibration.html'),
      },
    },
  },
})
