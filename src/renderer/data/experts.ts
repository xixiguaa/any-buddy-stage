import type { ExpertPreset, ExpertTeamPreset } from '../../shared/types.js'

const defaultTimestamp = '2026-01-01T00:00:00.000Z'

export const DEFAULT_EXPERTS: ExpertPreset[] = [
  {
    id: 'expert-design',
    name: '设计专家 (Design Agent)',
    description: '专注于应用结构布局、UI 交互语言、高保真组件形态及整体艺术风格重构。',
    skills: ['frontend-design', 'ui-ux-pro-max', 'design-taste-frontend'],
    systemPrompt: 'You are a principal designer expert. Guide the user in UI/UX and styling decisions.',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
  {
    id: 'expert-doc',
    name: '文档助手 (Doc Agent)',
    description: '撰写各种详尽的产品规格说明书、设计提案草案、开发排期计划书及长期沉淀文档。',
    skills: ['doc-coauthoring', 'writing-plans'],
    systemPrompt: 'You are a technical writer. Focus on grammar, structure, clarity and concise specs.',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
  {
    id: 'expert-research',
    name: '搜索与调试 (Research Agent)',
    description: '聚合多维网络搜索源，精准对比不同的系统架构方案，并辅助排除后台代码缺陷。',
    skills: ['web-search', 'systematic-debugging'],
    systemPrompt: 'You are a research engineer. Write shell commands, search the web and extract raw technical facts.',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
]

export const DEFAULT_EXPERT_TEAMS: ExpertTeamPreset[] = [
  {
    id: 'team-software-dev',
    name: '软件开发团队',
    description: '包含架构师、前端专家、后端专家的全栈敏捷开发团队。',
    members: [
      {
        id: 'member-architect',
        name: '架构师',
        role: '系统架构设计',
        specialty: '擅长底层架构设计、技术选型、模块拆解与数据模型规划',
        skills: ['writing-plans', 'doc-coauthoring'],
        systemPrompt: '你是软件架构师。负责把控技术架构、进行方案设计与模块划分，指导前后端实现。',
      },
      {
        id: 'member-frontend-expert',
        name: '前端专家',
        role: '前端界面与交互',
        specialty: '擅长 React/TypeScript 界面设计、高审美重构、UI 动效与组件开发',
        skills: ['frontend-design', 'design-taste-frontend', 'ui-ux-pro-max'],
        systemPrompt: '你是前端专家。专注于前端组件开发、页面排版、交互动效与视觉表现重构。',
      },
      {
        id: 'member-backend-expert',
        name: '后端专家',
        role: '服务端与持久化',
        specialty: '擅长 Node.js、SQLite 数据库仓储、系统调试与 API 接口逻辑设计',
        skills: ['systematic-debugging', 'web-search'],
        systemPrompt: '你是后端专家。专注于服务端架构、数据库表结构设计、API 逻辑实现与系统调试。',
      },
    ],
    systemPrompt: '你作为软件开发团队的主协调 Leader，协调架构师、前端专家和后端专家分工合作解决问题。',
    isCustom: false,
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
]

export function buildExpertQuickList(summonedExpert?: ExpertPreset | null) {
  const base = [...DEFAULT_EXPERTS]
  if (summonedExpert && !base.some(expert => expert.id === summonedExpert.id || expert.name === summonedExpert.name)) {
    base.unshift(summonedExpert)
  }
  return base
}
