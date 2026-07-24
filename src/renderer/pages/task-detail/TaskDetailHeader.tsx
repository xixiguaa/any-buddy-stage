import { Tag } from 'antd'
import { getStatusLabelAndColor, useTaskDetail } from './TaskDetailContext.js'

/**
 * 任务详情页头部组件
 * 展示任务标题、状态 Tag、运行模式与主工作区信息
 */
export default function TaskDetailHeader() {
  const { task, primaryWorkspace } = useTaskDetail()

  if (!task) return null

  const statusInfo = getStatusLabelAndColor(task.status)

  return (
    <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>{task.title}</h2>
          <Tag color={statusInfo.color}>{statusInfo.label}</Tag>
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
          模式: <span style={{ fontWeight: 600, color: '#475569' }}>{task.mode.toUpperCase()}</span> · 主空间{' '}
          <span style={{ fontWeight: 600, color: '#475569' }}>{primaryWorkspace?.name ?? '无主空间'}</span>
        </div>
      </div>
    </div>
  )
}
