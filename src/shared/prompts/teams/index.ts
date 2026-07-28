import type { ExpertTeamPreset } from '../../types.js'
import { SOFTWARE_DEV_TEAM } from './software-dev.js'

/**
 * 汇总注册所有内置专家团队预设
 * 后续增加新的专家团队时，只需在此模块中引入并注册到数组即可
 */
export const DEFAULT_EXPERT_TEAMS: ExpertTeamPreset[] = [
  SOFTWARE_DEV_TEAM,
]

export { SOFTWARE_DEV_TEAM }
