import { defineConfig } from 'vite'
import { builtinModules } from 'node:module'

const builtins = [
  'electron',
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
]

export default defineConfig({
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

