import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  resolve: {
    alias: {
      '@': '/src/renderer',
      '@shared': '/src/shared',
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
