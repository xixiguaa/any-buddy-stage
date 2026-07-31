import { Tag } from 'antd'
import type { TaskMode } from '../../../shared/types.js'
import { useTaskDetail } from './TaskDetailContext.js'
import { getStatusLabelAndColor } from './task-detail-utils.js'

/**
 * 提取模式标签与样式映射
 */
function getModeBadgeInfo(mode: TaskMode) {
  switch (mode) {
    case 'plan':
      return { label: 'Plan (规划模式)', color: 'blue', desc: '生成分步方案，确认后继续执行' }
    case 'craft':
      return { label: 'Craft (执行模式)', color: 'green', desc: '完全自主的代码改写与写入' }
    case 'ask':
      return { label: 'Ask (问答模式)', color: 'purple', desc: '快速问答与检索，不改动代码' }
    default:
      return { label: String(mode).toUpperCase(), color: 'default', desc: '' }
  }
}

/**
 * 任务详情页头部组件
 * 展示任务标题、状态 Tag、运行模式与主工作区信息
 */
export default function TaskDetailHeader() {
  const { task, primaryWorkspace } = useTaskDetail()

  if (!task) return null

  const statusInfo = getStatusLabelAndColor(task.status)
  const modeInfo = getModeBadgeInfo(task.mode)

  return (
    <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>{task.title}</h2>
          <Tag color={statusInfo.color}>{statusInfo.label}</Tag>
          <Tag color={modeInfo.color} title={modeInfo.desc}>⚡ {modeInfo.label}</Tag>
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
          主空间: <span style={{ fontWeight: 600, color: '#475569' }}>{primaryWorkspace?.name ?? '无主空间'}</span>
        </div>
      </div>
    </div>
  )
}
