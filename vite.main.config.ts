import { defineConfig } from 'vite'
import { builtinModules } from 'node:module'

const builtins = [
  'electron',
  'better-sqlite3',
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
]

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/main/index.ts',
      formats: ['cjs'],
      fileName: () => 'main.cjs',
    },
    outDir: '.vite/build',
    rollupOptions: {
      external: builtins,
      output: {
        entryFileNames: 'main.cjs',
      },
    },
    target: 'node22',
  },
})
