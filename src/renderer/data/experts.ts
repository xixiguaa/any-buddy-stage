import type { ExpertPreset } from '../../shared/types.js'
import { DEFAULT_EXPERTS, DEFAULT_EXPERT_TEAMS } from '../../shared/prompts/index.js'

export { DEFAULT_EXPERTS, DEFAULT_EXPERT_TEAMS }

/**
 * 构建界面供快捷选择的专家预设列表
 */
export function buildExpertQuickList(summonedExpert?: ExpertPreset | null) {
  const base = [...DEFAULT_EXPERTS]
  if (summonedExpert && !base.some(expert => expert.id === summonedExpert.id || expert.name === summonedExpert.name)) {
    base.unshift(summonedExpert)
  }
  return base
}
