import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/main/index.ts',
      formats: ['es'],
      fileName: () => 'main.js',
    },
    outDir: '.vite/build',
    rollupOptions: {
      external: ['electron', 'better-sqlite3', 'node:fs', 'node:path', 'node:os', 'node:events'],
    },
    target: 'node22',
  },
})
