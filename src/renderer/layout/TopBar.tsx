import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { Space, Tag, Badge } from 'antd'
import { useAppStore } from '../stores/app-store.js'

const TITLES: Record<string, string> = {
  '/tasks/new': '新建任务',
  '/experts': '专家与技能',
  '/settings': '系统设置',
}

const ACTIVE_RUN_STATUSES = new Set(['queued', 'running', 'paused', 'waiting_approval'])

export default function TopBar() {
  const location = useLocation()
  const tasks = useAppStore(state => state.tasks)
  const settings = useAppStore(state => state.settings)
  const agentRuns = useAppStore(state => state.agentRuns)

  const activeRunCount = useMemo(
    () => agentRuns.filter(run => ACTIVE_RUN_STATUSES.has(run.status)).length,
    [agentRuns],
  )

  const title = TITLES[location.pathname] ?? '任务工作空间'

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px 24px',
      background: '#f8fafc',
      borderBottom: '1px solid #f1f5f9'
    }}>
      <div>
        <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
          anybuddy 工作台
        </div>
        <h1 style={{ margin: '2px 0 0', fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
          {title}
        </h1>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{
          padding: '4px 12px',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          minWidth: '80px'
        }}>
          <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>任务总数</span>
          <strong style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginTop: '1px' }}>{tasks.length}</strong>
        </div>
        <div style={{
          padding: '4px 12px',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          minWidth: '80px'
        }}>
          <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>运行中</span>
          <strong style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginTop: '1px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {activeRunCount > 0 ? <Badge status="processing" /> : null}
            {activeRunCount}
          </strong>
        </div>
        <div style={{
          padding: '4px 12px',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          minWidth: '80px'
        }}>
          <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>联网搜索</span>
          <div style={{ marginTop: '2px' }}>
            {settings?.webSearchEnabled ? (
              <Tag color="success" style={{ margin: 0, fontSize: '11px', lineHeight: '1.4' }}>已开启</Tag>
            ) : (
              <Tag color="default" style={{ margin: 0, fontSize: '11px', lineHeight: '1.4' }}>已关闭</Tag>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
