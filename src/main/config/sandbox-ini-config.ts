import electron from 'electron'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'

const app = electron?.app || (electron as unknown as { app?: typeof electron.app })?.app

/** INI 配置键与通用配置项到 SANDBOX_* 规范名映射 */
const INI_ENVIRONMENT_KEYS: Record<string, string> = {
  'docker.image': 'SANDBOX_DOCKER_IMAGE',
  'docker.image_type': 'SANDBOX_DOCKER_IMAGE_TYPE',
  'docker.timeout_ms': 'SANDBOX_DOCKER_TIMEOUT_MS',
  'docker.max_output_bytes': 'SANDBOX_DOCKER_MAX_OUTPUT_BYTES',
  'docker.max_transfer_bytes': 'SANDBOX_DOCKER_MAX_TRANSFER_BYTES',
  'sandbox.image': 'SANDBOX_DOCKER_IMAGE',
  'sandbox.image_type': 'SANDBOX_DOCKER_IMAGE_TYPE',
  'sandbox.timeout_ms': 'SANDBOX_DOCKER_TIMEOUT_MS',
  'sandbox.max_output_bytes': 'SANDBOX_DOCKER_MAX_OUTPUT_BYTES',
  'sandbox.max_transfer_bytes': 'SANDBOX_DOCKER_MAX_TRANSFER_BYTES',
  // 无 section 头时仅识别本地 Docker 配置。
  'image': 'SANDBOX_DOCKER_IMAGE',
  'image_type': 'SANDBOX_DOCKER_IMAGE_TYPE',
  'timeout_ms': 'SANDBOX_DOCKER_TIMEOUT_MS',
  'max_output_bytes': 'SANDBOX_DOCKER_MAX_OUTPUT_BYTES',
  'max_transfer_bytes': 'SANDBOX_DOCKER_MAX_TRANSFER_BYTES',
}

/** 获取默认 culclaw.ini 文件路径（开发环境为项目根目录，打包后为 exe 同级目录） */
export function getSandboxIniPath(): string {
  try {
    if (app?.isPackaged) {
      return join(dirname(process.execPath), 'culclaw.ini')
    }
  } catch {
    // 忽略非 Electron 环境错误
  }
  return join(process.cwd(), 'culclaw.ini')
}

/** 去除 INI 值两侧可能的单双引号及尾部行内注释 */
function normalizeIniValue(value: string) {
  let trimmed = value.trim()
  const commentIndex = trimmed.search(/\s+[#;]/)
  if (commentIndex !== -1) {
    trimmed = trimmed.slice(0, commentIndex).trim()
  }
  if (trimmed.length >= 2) {
    const quote = trimmed[0]
    if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

/**
 * 直接读取配置文件（优先读取 culclaw.ini，其次尝试 .env）解析为键值字典，不注入当前进程 process.env。
 */
export async function readSandboxIni(filePath?: string): Promise<Record<string, string>> {
  const primaryPath = filePath || getSandboxIniPath()
  const candidates = [primaryPath]

  // 若未手动传入路径，在开发环境下同时支持 .env 文件回退
  if (!filePath) {
    const envPath = join(process.cwd(), '.env')
    if (envPath !== primaryPath) {
      candidates.push(envPath)
    }
  }

  const result: Record<string, string> = {}

  for (const targetPath of candidates) {
    let content: string
    try {
      content = await readFile(targetPath, 'utf8')
    } catch {
      continue
    }

    let section = ''
    content.split(/\r?\n/u).forEach(sourceLine => {
      const line = sourceLine.trim()
      if (!line || line.startsWith(';') || line.startsWith('#')) return

      const sectionMatch = /^\[(.+)\]$/u.exec(line)
      if (sectionMatch) {
        section = sectionMatch[1].trim().toLowerCase()
        return
      }

      const separatorIndex = line.indexOf('=')
      if (separatorIndex <= 0) return

      const key = line.slice(0, separatorIndex).trim()
      const value = normalizeIniValue(line.slice(separatorIndex + 1))
      const directKey = key.toUpperCase()

      // 优先匹配 SANDBOX_* 全名，其次匹配 [section] 下配置项，最后回退至无 section 别名
      const mappedKey = directKey.startsWith('SANDBOX_')
        ? directKey
        : INI_ENVIRONMENT_KEYS[`${section}.${key.toLowerCase()}`] || INI_ENVIRONMENT_KEYS[key.toLowerCase()]

      // 先读到的文件配置项优先，后读到的文件不覆盖已有配置
      if (mappedKey && !result[mappedKey]) {
        result[mappedKey] = value
      }
    })
  }

  return result
}

/**
 * 兼容旧版的全局注入函数，不推荐高版本新功能直接使用。
 */
export async function loadSandboxIni(
  filePath: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const iniConfig = await readSandboxIni(filePath)
  Object.assign(environment, iniConfig)
  return true
}
