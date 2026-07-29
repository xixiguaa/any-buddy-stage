import { defineConfig } from 'vite'
import { builtinModules } from 'node:module'
import path from 'node:path'

const builtins = [
  'electron',
  'better-sqlite3',
  // Node VFS 运行时会按包内相对路径读取 vendor/vfs-upstream，不能被 Vite 内联。
  '@langchain/node-vfs',
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
