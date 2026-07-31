import { app } from 'electron'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'

/** INI 配置键与通用配置项到 SANDBOX_* 规范名映射 */
const INI_ENVIRONMENT_KEYS: Record<string, string> = {
  'ssh.host': 'SANDBOX_SSH_HOST',
  'ssh.user': 'SANDBOX_SSH_USER',
  'ssh.username': 'SANDBOX_SSH_USER',
  'ssh.password': 'SANDBOX_SSH_PASSWORD',
  'ssh.port': 'SANDBOX_SSH_PORT',
  'ssh.key_path': 'SANDBOX_SSH_KEY_PATH',
  'ssh.key_passphrase': 'SANDBOX_SSH_KEY_PASSPHRASE',
  'ssh.host_fingerprint': 'SANDBOX_SSH_HOST_FINGERPRINT',
  'ssh.timeout_ms': 'SANDBOX_SSH_TIMEOUT_MS',
  'ssh.max_output_bytes': 'SANDBOX_SSH_MAX_OUTPUT_BYTES',
  'ssh.max_transfer_bytes': 'SANDBOX_SSH_MAX_TRANSFER_BYTES',
  'ssh.server_url': 'SANDBOX_SERVER_URL',
  'docker.image': 'SANDBOX_DOCKER_IMAGE',
  'docker.image_type': 'SANDBOX_DOCKER_IMAGE_TYPE',
  // 无 section 头的别名回退映射
  'host': 'SANDBOX_SSH_HOST',
  'user': 'SANDBOX_SSH_USER',
  'username': 'SANDBOX_SSH_USER',
  'password': 'SANDBOX_SSH_PASSWORD',
  'port': 'SANDBOX_SSH_PORT',
  'key_path': 'SANDBOX_SSH_KEY_PATH',
  'key_passphrase': 'SANDBOX_SSH_KEY_PASSPHRASE',
  'host_fingerprint': 'SANDBOX_SSH_HOST_FINGERPRINT',
  'timeout_ms': 'SANDBOX_SSH_TIMEOUT_MS',
  'max_output_bytes': 'SANDBOX_SSH_MAX_OUTPUT_BYTES',
  'max_transfer_bytes': 'SANDBOX_SSH_MAX_TRANSFER_BYTES',
  'server_url': 'SANDBOX_SERVER_URL',
  'image': 'SANDBOX_DOCKER_IMAGE',
  'image_type': 'SANDBOX_DOCKER_IMAGE_TYPE',
}

/** 获取默认 sandbox.ini 文件路径（开发环境为项目根目录，打包后为 exe 同级目录） */
export function getSandboxIniPath(): string {
  try {
    if (app?.isPackaged) {
      return join(dirname(process.execPath), 'sandbox.ini')
    }
  } catch {
    // 忽略非 Electron 环境错误
  }
  return join(process.cwd(), 'sandbox.ini')
}

/** 去除 INI 值两侧可能的单双引号 */
function normalizeIniValue(value: string) {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const quote = trimmed[0]
    if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

/**
 * 直接读取配置文件（优先读取 sandbox.ini，其次尝试 .env）解析为键值字典，不注入当前进程 process.env。
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
