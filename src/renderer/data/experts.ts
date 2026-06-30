import type { ExpertPreset } from '../../shared/types.js'

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

export function buildExpertQuickList(summonedExpert?: ExpertPreset | null) {
  const base = [...DEFAULT_EXPERTS]
  if (summonedExpert && !base.some(expert => expert.id === summonedExpert.id || expert.name === summonedExpert.name)) {
    base.unshift(summonedExpert)
  }
  return base
}
