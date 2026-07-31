import { defineConfig } from 'vite'
import { builtinModules } from 'node:module'
import path from 'node:path'

const builtins = [
  'electron',
  'better-sqlite3',
  // ssh2 内部包含动态 require 和可选原生模块，保留为运行时依赖。
  'ssh2',
  // cpu-features 是 ssh2 的可选原生加速模块；未构建时由 ssh2 回退到纯 JS 实现。
  'cpu-features',
  'nan',
  // 任何原生 .node 文件都必须由 Node/Electron 在运行时加载，不能被 Rollup 解析。
  /\.node(?:\?.*)?$/,
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
