import type { ExpertTeamPreset } from '../../types.js'

const defaultTimestamp = '2026-01-01T00:00:00.000Z'

/**
 * 软件开发团队预设与流水线调度提示词
 */
export const SOFTWARE_DEV_TEAM: ExpertTeamPreset = {
  id: 'team-software-dev',
  name: '软件开发团队',
  description: '包含后端专家、前端专家和架构师的全栈敏捷开发流水线团队。',
  members: [
    {
      id: 'member-backend-expert',
      name: '后端专家',
      role: '服务端与持久化',
      specialty: '擅长 Node.js、SQLite 数据库仓储、系统调试与 API 接口逻辑设计',
      skills: ['systematic-debugging', 'web-search'],
      systemPrompt: '你是后端专家。专注于服务端架构、数据库表结构设计、API 逻辑实现与系统调试。',
    },
    {
      id: 'member-frontend-expert',
      name: '前端专家',
      role: '前端界面与交互',
      specialty: '擅长 React/TypeScript 界面设计、高审美重构、UI 动效与组件开发',
      skills: ['frontend-design', 'design-taste-frontend', 'ui-ux-pro-max'],
      systemPrompt: '你是前端专家。基于后端接口与数据结构，专注于前端组件开发、页面排版、交互动效与视觉表现重构。',
    },
    {
      id: 'member-architect',
      name: '架构师',
      role: '系统架构设计与总审',
      specialty: '擅长底层架构设计、技术选型、模块拆解与数据模型规划',
      skills: ['writing-plans', 'doc-coauthoring'],
      systemPrompt: '你是软件架构师。负责把控技术架构、对前后端完成的方案进行整体审视与评估，指导技术优化。',
    },
  ],
  // 团队 Leader 核心调度指令：强制【后端 -> 前端 -> 架构师】流水线顺序
  systemPrompt: `【团队三阶段流水线协作规范】
本团队必须采取流水线机制，严格按照以下 1 -> 2 -> 3 的顺序串行依次调度，上一阶段专家的成果必须作为下一阶段专家的背景输入：

第一阶段（后端先行）：
- 优先调用 task 工具，将 subagent_type 设置为 "后端专家"。
- 委派任务：设计/分析后端数据库表结构、API 接口规格及业务逻辑。

第二阶段（前端衔接）：
- 必须在收到【后端专家】的 Markdown 输出后，再调用 task 工具，将 subagent_type 设置为 "前端专家"。
- 委派任务：基于【后端专家】产出的接口与数据结构，完成前端页面组件、UI 交互与数据对接设计。

第三阶段（架构汇总）：
- 必须在收到【前端专家】的 Markdown 输出后，调用 task 工具，将 subagent_type 设置为 "架构师专家"。
- 委派任务：针对前后端的完整方案进行全栈架构复盘、评估安全性与性能，并给出最终系统架构总结报告。`,
  isCustom: false,
  createdAt: defaultTimestamp,
  updatedAt: defaultTimestamp,
}
