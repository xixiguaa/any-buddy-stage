import type { ExpertTeamPreset } from '../../types.js'
import { SHORT_VIDEO_TEAM } from './short-video.js'
import { DOC_WRITING_TEAM } from './doc-writing.js'
import { DATA_ANALYSIS_TEAM } from './data-analysis.js'
import { SLIDE_PRESENTATION_TEAM } from './slide-presentation.js'
import { MEETING_ENABLEMENT_TEAM } from './meeting-enablement.js'
import { RESEARCH_TEAM } from './research.js'

/**
 * 汇总注册所有内置专家团队预设 (对应 WorkBuddy 6 大专家团队)
 * 将短视频专家制作团置于内置列表的首位
 */
export const DEFAULT_EXPERT_TEAMS: ExpertTeamPreset[] = [
  SHORT_VIDEO_TEAM,
  DOC_WRITING_TEAM,
  DATA_ANALYSIS_TEAM,
  SLIDE_PRESENTATION_TEAM,
  MEETING_ENABLEMENT_TEAM,
  RESEARCH_TEAM,
]

export {
  SHORT_VIDEO_TEAM,
  DOC_WRITING_TEAM,
  DATA_ANALYSIS_TEAM,
  SLIDE_PRESENTATION_TEAM,
  MEETING_ENABLEMENT_TEAM,
  RESEARCH_TEAM,
}
