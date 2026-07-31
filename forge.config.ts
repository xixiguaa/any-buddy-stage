import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { VitePlugin } from '@electron-forge/plugin-vite'
import type { ForgeConfig } from '@electron-forge/shared-types'

const shouldIgnorePackagedFile = (file: string) => {
  if (!file) return false

  if (file === '/node_modules') return false
  if (file.startsWith('/node_modules/')) {
    return file.startsWith('/node_modules/.')
  }

  return !file.startsWith('/.vite')
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: '**/*.node',
    },
    // Keep runtime dependencies available for Packager's production dependency pruning.
    ignore: shouldIgnorePackagedFile,
  },
  // ssh2 的 cpu-features 是可选原生加速模块，不参与 Electron 重编译；保留项目必需的 better-sqlite3。
  rebuildConfig: {
    onlyModules: ['better-sqlite3'],
  },
  makers: [
    new MakerSquirrel({
      authors: 'ymx',
      description: 'Desktop AI assistant application.',
    }),
    new MakerZIP({}, ['win32']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
}

export default config
