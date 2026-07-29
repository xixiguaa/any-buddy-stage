/**
 * 全局应用品牌名称常量
 */
export const APP_NAME = 'CulClaw'

/**
 * 默认新建工作区在磁盘文件系统上的目录名称 (例如: ~/CulClaw)
 */
export const WORKSPACE_DIR_NAME = APP_NAME

/**
 * 默认自动新建工作区显示标签 (例如: 自动新建 (CulClaw/日期文件夹))
 */
export const DEFAULT_WORKSPACE_LABEL = `自动新建 (${APP_NAME}/日期文件夹)`

/**
 * 用户主目录下的全局配置文件夹名称 (例如: ~/.culclaw)
 */
export const CONFIG_DIR_NAME = `.${APP_NAME.toLowerCase()}`

/**
 * 主 SQLite 数据库文件名 (例如: culclaw.db)
 */
export const DB_FILE_NAME = `${APP_NAME.toLowerCase()}.db`
