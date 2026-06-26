import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/preload/index.ts',
      formats: ['es'],
      fileName: () => 'preload.js',
    },
    outDir: '.vite/build',
    rollupOptions: {
      external: ['electron'],
    },
    target: 'node22',
  },
})
