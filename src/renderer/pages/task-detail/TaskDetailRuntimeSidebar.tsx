import { AlertCircle, Edit2, Play, ShieldAlert, Terminal, XCircle } from 'lucide-react'
import { Button, Tag } from 'antd'
import { getPlanApprovalText, getStatusLabelAndColor, useTaskDetail } from './TaskDetailContext.js'
import { renderMarkdown } from './TaskDetailMessageList.js'

function formatAccessMode(value: 'read_only' | 'read_write') {
  return value === 'read_only' ? '只读' : '读写'
}

function formatTimestamp(value?: string) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return value
  }
}

/**
 * 任务详情页右侧 Runtime 侧边栏组件
 * 展示当前运行状态、代理节点、依赖专家、中断恢复点及运行日志列表
 */
export default function TaskDetailRuntimeSidebar() {
  const {
    task,
    currentRun,
    isAgentWorking,
    taskEvents,
    activeExpert,
    availableExperts,
    pendingApprovalCount,
    pendingPlanApprovals,
    pendingInterrupts,
    agentRuns,
    attachedWorkspaces,
    handleClearRuns,
    handleSwitchExpert,
    handleApprovePlanWithFeedback,
    handleRejectPlanWithFeedback,
    resumeInterruptedRun,
    handleOpenEditInterrupt,
  } = useTaskDetail()

  if (!task) return null

  return (
    <div
      style={{
        width: '420px',
        borderLeft: '1px solid #f1f5f9',
        background: '#fcfcfd',
        padding: '20px 16px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      {/* 运行时节点卡片 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', position: 'relative' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Runtime</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>{currentRun?.agentName ?? '暂无运行'}</div>
          {isAgentWorking && (
            <span
              className="status-glow"
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#3b82f6',
                boxShadow: '0 0 8px #3b82f6',
                animation: 'pulseGlow 1.5s infinite alternate',
              }}
            />
          )}
        </div>
        <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
          当前节点:{' '}
          <Tag color="blue" style={{ margin: 0, fontSize: '10px', lineHeight: '1.4' }}>
            {currentRun?.currentNode ?? 'idle'}
          </Tag>
        </div>
        {isAgentWorking && (
          <div
            style={{
              position: 'absolute',
              bottom: '-10px',
              left: 0,
              right: 0,
              height: '2px',
              background: '#e2e8f0',
              borderRadius: '1px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: '40%',
                background: 'linear-gradient(90deg, #6366f1, #3b82f6)',
                borderRadius: '1px',
                animation: 'loadingBar 1.5s infinite ease-in-out',
              }}
            />
          </div>
        )}
      </div>

      {/* 运行失败提示 */}
      {currentRun?.status === 'failed' && (
        <div
          style={{
            background: 'linear-gradient(180deg, #fef2f2 0%, #fff1f1 100%)',
            border: '1px solid #fca5a5',
            borderRadius: '14px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 4px 12px rgba(239, 68, 68, 0.03)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#dc2626', fontWeight: 700, fontSize: '13px' }}>
            <span style={{ fontSize: '14px' }}>⚠️</span> 运行失败原因
          </div>
          <div
            style={{
              fontSize: '12px',
              color: '#991b1b',
              lineHeight: 1.5,
              fontFamily: `Consolas, 'Fira Code', monospace`,
              wordBreak: 'break-all',
              background: 'rgba(239, 68, 68, 0.02)',
              padding: '8px 10px',
              borderRadius: '6px',
              border: '1px dashed #fca5a5',
              whiteSpace: 'pre-wrap',
            }}
          >
            {(() => {
              const failedEvent = taskEvents.find((e) => e.type === 'run_failed')
              return String(failedEvent?.payload?.message || '未知运行错误')
            })()}
          </div>
        </div>
      )}

      {/* 当前专家卡片 */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>当前专家</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{activeExpert?.name ?? '通用助手'}</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', lineHeight: 1.6 }}>
              {activeExpert?.description ?? '当前未指定专家，使用默认 AnyBuddy persona。'}
            </div>
          </div>
          {availableExperts.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {availableExperts.map((expert) => {
                const isActive = expert.id === task.activeExpertId
                return (
                  <Button
                    key={expert.id}
                    size="small"
                    type={isActive ? 'primary' : 'default'}
                    onClick={() => void handleSwitchExpert(expert)}
                    style={isActive ? { background: '#0f172a', borderColor: '#0f172a' } : undefined}
                  >
                    {expert.name}
                  </Button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 运行摘要 */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>运行摘要</div>
        <div style={{ display: 'grid', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#64748b' }}>主运行状态</span>
            <Tag color={getStatusLabelAndColor(currentRun?.status ?? task.status).color}>
              {getStatusLabelAndColor(currentRun?.status ?? task.status).label}
            </Tag>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#64748b' }}>已注册专家</span>
            <span style={{ color: '#0f172a', fontWeight: 600 }}>{availableExperts.length}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#64748b' }}>待恢复中断</span>
            <span style={{ color: '#b45309', fontWeight: 600 }}>{pendingApprovalCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#64748b' }}>最近事件</span>
            <span style={{ color: '#0f172a', fontWeight: 600 }}>{taskEvents.length}</span>
          </div>
        </div>
      </div>

      {/* 方案确认侧边卡片 */}
      {pendingPlanApprovals.length > 0 && (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #bfdbfe',
            borderRadius: '16px',
            padding: '16px',
            boxShadow: '0 6px 20px rgba(37, 99, 235, 0.06)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '24px',
                height: '24px',
                borderRadius: '6px',
                background: '#eff6ff',
                color: '#2563eb',
              }}
            >
              <AlertCircle size={14} />
            </span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>方案确认</div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>同意后将切换到 Craft 模式继续执行</div>
            </div>
          </div>

          {pendingPlanApprovals.map((approval) => {
            const planText = getPlanApprovalText(approval)
            return (
              <div key={approval.id} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div
                  style={{
                    maxHeight: '220px',
                    overflowY: 'auto',
                    padding: '12px',
                    borderRadius: '10px',
                    border: '1px solid #dbeafe',
                    background: '#f8fbff',
                    color: '#334155',
                    fontSize: '12px',
                    lineHeight: 1.6,
                  }}
                >
                  {planText ? renderMarkdown(planText) : approval.reason}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button
                    type="primary"
                    size="middle"
                    icon={<Play size={14} style={{ marginRight: '4px' }} />}
                    onClick={() => void handleApprovePlanWithFeedback(approval.id)}
                    style={{
                      flex: 1,
                      background: '#0f172a',
                      borderColor: '#0f172a',
                      borderRadius: '8px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '36px',
                    }}
                  >
                    同意方案并执行
                  </Button>
                  <Button
                    danger
                    size="middle"
                    icon={<XCircle size={13} style={{ marginRight: '2px' }} />}
                    onClick={() => void handleRejectPlanWithFeedback(approval.id)}
                    style={{
                      borderRadius: '8px',
                      fontWeight: 600,
                      height: '36px',
                    }}
                  >
                    取消
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 中断恢复点卡片列表 */}
      <div
        id="runtime-interrupts-panel"
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '16px',
          padding: '16px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.01)',
          position: 'relative',
          minHeight: '120px',
          maxHeight: '340px',
          overflowY: 'auto',
        }}
      >
        {pendingInterrupts.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '3px',
              background: 'linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%)',
            }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '24px',
              height: '24px',
              borderRadius: '6px',
              background: pendingInterrupts.length > 0 ? '#fffbeb' : '#f1f5f9',
              color: pendingInterrupts.length > 0 ? '#d97706' : '#64748b',
            }}
          >
            <ShieldAlert size={14} />
          </span>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>中断恢复</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {pendingInterrupts.map((interrupt) => (
            <div
              key={interrupt.id}
              style={{
                border: '1px solid #fde68a',
                background: 'linear-gradient(180deg, #fffdf5 0%, #fffbeb 100%)',
                borderRadius: '12px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                boxShadow: '0 2px 8px rgba(245, 158, 11, 0.03)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: '#f59e0b',
                      boxShadow: '0 0 6px #f59e0b',
                    }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#78350f' }}>运行暂停点</span>
                </div>
                <span style={{ fontSize: '10px', color: '#b45309' }}>{formatTimestamp(interrupt.createdAt)}</span>
              </div>

              <div
                style={{
                  fontSize: '12px',
                  color: '#451a03',
                  lineHeight: 1.6,
                  padding: '8px 12px',
                  background: 'rgba(251, 191, 36, 0.06)',
                  borderRadius: '8px',
                  borderLeft: '3px solid #fbbf24',
                }}
              >
                {interrupt.reason}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '11px', color: '#92400e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Terminal size={11} />
                  恢复参数预览 (Args)
                </div>
                <pre
                  style={{
                    background: '#0f172a',
                    color: '#38bdf8',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '11px',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    maxHeight: '140px',
                    margin: 0,
                    border: '1px solid #1e293b',
                    fontFamily: `'Fira Code', 'Consolas', monospace`,
                    whiteSpace: 'pre-wrap',
                    boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.15)',
                  }}
                >
                  {JSON.stringify(interrupt.originalArgs ?? {}, null, 2)}
                </pre>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                <Button
                  type="primary"
                  size="middle"
                  icon={<Play size={14} style={{ marginRight: '4px' }} />}
                  onClick={() => void resumeInterruptedRun(interrupt.id, 'resume')}
                  style={{
                    width: '100%',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    borderColor: '#10b981',
                    borderRadius: '8px',
                    fontWeight: 600,
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '36px',
                  }}
                >
                  按原参数恢复执行
                </Button>
                <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                  <Button
                    size="middle"
                    icon={<Edit2 size={13} style={{ marginRight: '2px' }} />}
                    onClick={() => handleOpenEditInterrupt(interrupt.id, interrupt.originalArgs)}
                    style={{
                      flex: 1,
                      borderRadius: '8px',
                      fontWeight: 600,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#334155',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '36px',
                    }}
                  >
                    编辑参数
                  </Button>
                  <Button
                    danger
                    size="middle"
                    icon={<XCircle size={13} style={{ marginRight: '2px' }} />}
                    onClick={() => void resumeInterruptedRun(interrupt.id, 'cancel')}
                    style={{
                      flex: 1,
                      borderRadius: '8px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '36px',
                    }}
                  >
                    取消执行
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {pendingInterrupts.length === 0 && <div style={{ fontSize: '12px', color: '#94a3b8' }}>当前没有待恢复的中断点。</div>}
        </div>
      </div>

      {/* 历史运行记录 */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '14px',
          padding: '14px',
          minHeight: '120px',
          maxHeight: '300px',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>运行记录</span>
          {agentRuns.filter((run) => run.kind === 'main').length > 0 && (
            <Button type="link" size="small" danger onClick={handleClearRuns} style={{ padding: 0, height: 'auto', fontSize: '11px', fontWeight: 600 }}>
              清除记录
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {agentRuns
            .filter((run) => run.kind === 'main')
            .map((run) => (
              <div
                key={run.id}
                style={{
                  border: '1px solid #f1f5f9',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  background: run.kind === 'main' ? '#f8fafc' : '#ffffff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{run.agentName}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      主运行 · {run.currentNode ?? 'idle'}
                    </div>
                  </div>
                  <Tag color={getStatusLabelAndColor(run.status).color}>{getStatusLabelAndColor(run.status).label}</Tag>
                </div>
              </div>
            ))}
          {agentRuns.filter((run) => run.kind === 'main').length === 0 && <div style={{ fontSize: '12px', color: '#94a3b8' }}>暂无运行记录。</div>}
        </div>
      </div>

      {/* 关联工作区 */}
      {attachedWorkspaces.length > 0 && (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>关联工作区</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {attachedWorkspaces.map((item) => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '12px' }}>
                <span style={{ color: '#0f172a' }}>{item.workspace.name}</span>
                <span style={{ color: '#64748b' }}>{formatAccessMode(item.accessMode)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
