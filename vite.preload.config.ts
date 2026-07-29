import { defineConfig } from 'vite'
import { builtinModules } from 'node:module'
import path from 'node:path'

const builtins = [
  'electron',
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
]

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/preload/index.ts',
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    outDir: '.vite/build',
    rollupOptions: {
      external: builtins,
      output: {
        entryFileNames: 'preload.cjs',
      },
    },
    target: 'node22',
  },
})

