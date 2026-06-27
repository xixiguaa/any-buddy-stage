import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { 
  CheckOutlined, 
  CloseOutlined, 
  EditOutlined,
  ClockCircleOutlined,
  FolderOutlined,
  SettingOutlined,
  DatabaseOutlined,
  InfoCircleOutlined,
  InteractionOutlined
} from '@ant-design/icons'
import { 
  Tag, 
  Button, 
  Badge, 
  Collapse, 
  Space, 
  Alert, 
  Timeline, 
  Empty, 
  Card,
  Tooltip,
  Modal,
  Input
} from 'antd'
import TaskComposer from '../components/TaskComposer.js'
import { useAppStore } from '../stores/app-store.js'
import { createAnybuddyClients } from '../api/clients.js'

function formatAccessMode(value: 'read_only' | 'read_write') {
  return value === 'read_only' ? '只读' : '读写'
}

export default function TaskDetailPage() {
  const { taskId } = useParams()
  const selectedTaskId = useAppStore(state => state.selectedTaskId)
  const task = useAppStore(state => state.taskDetail)
  const messages = useAppStore(state => state.messages)
  const drafts = useAppStore(state => state.drafts)
  const taskWorkspaces = useAppStore(state => state.taskWorkspaces)
  const allAgentRuns = useAppStore(state => state.agentRuns)
  const taskEvents = useAppStore(state => state.taskEvents)
  const taskApprovals = useAppStore(state => state.taskApprovals)
  const selectTask = useAppStore(state => state.selectTask)
  const sendMessage = useAppStore(state => state.sendMessage)
  const saveDraft = useAppStore(state => state.saveDraft)
  const clearDraft = useAppStore(state => state.clearDraft)
  const approveTask = useAppStore(state => state.approveTask)
  const workspaces = useAppStore(state => state.workspaces)

  const [editApprovalId, setEditApprovalId] = useState<string | null>(null)
  const [editedArgsText, setEditedArgsText] = useState('')

  useEffect(() => {
    if (taskId && selectedTaskId !== taskId) {
      selectTask(taskId).catch(error => console.error(error))
    }
  }, [selectTask, selectedTaskId, taskId])

  const agentRuns = useMemo(
    () => allAgentRuns.filter(run => run.taskId === taskId),
    [allAgentRuns, taskId],
  )

  const primaryWorkspace = useMemo(() => {
    if (!task?.primaryWorkspaceId) return undefined
    return workspaces.find(workspace => workspace.id === task.primaryWorkspaceId)
  }, [task?.primaryWorkspaceId, workspaces])

  const currentRun = agentRuns[0]
  const attachedWorkspaces = useMemo(
    () => taskWorkspaces.filter(workspace => workspace.role === 'attached'),
    [taskWorkspaces],
  )

  const pendingApprovals = useMemo(
    () => taskApprovals.filter(appr => appr.decision === 'pending'),
    [taskApprovals],
  )

  if (!task) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '48px' }}>
        <Empty description="选择一个任务以检查对话和运行状态。" />
      </div>
    )
  }

  const getStatusLabelAndColor = (status: string) => {
    switch (status) {
      case 'idle':
      case 'queued':
      case 'planning':
        return { label: '规划中', color: 'blue' }
      case 'running':
        return { label: '进行中', color: 'geekblue' }
      case 'completed':
        return { label: '已完成', color: 'success' }
      case 'failed':
        return { label: '失败', color: 'error' }
      case 'paused':
      case 'waiting_approval':
        return { label: '待处理', color: 'warning' }
      case 'archived':
        return { label: '已归档', color: 'default' }
      default:
        return { label: status, color: 'default' }
    }
  }

  const handleOpenEditApproval = (approvalId: string, args: any) => {
    setEditApprovalId(approvalId)
    setEditedArgsText(JSON.stringify(args, null, 2))
  }

  const handleSaveEditApproval = async () => {
    if (!editApprovalId) return
    try {
      const editedArgs = JSON.parse(editedArgsText)
      await approveTask(editApprovalId, 'edited', editedArgs)
      setEditApprovalId(null)
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#ffffff', width: '100%' }}>
      {/* Left Chat Column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
        {/* Chat Header */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid #f1f5f9',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#ffffff'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>{task.title}</h2>
              {(() => {
                const statusInfo = getStatusLabelAndColor(task.status)
                return <Tag color={statusInfo.color}>{statusInfo.label}</Tag>
              })()}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              模式: <span style={{ fontWeight: 600, color: '#475569' }}>{task.mode.toUpperCase()}</span> · 
              主空间: <span style={{ fontWeight: 600, color: '#475569' }}>{primaryWorkspace?.name ?? '无主空间'}</span>
            </div>
          </div>
        </div>

        {/* Pending Approval Sticky Warning */}
        {pendingApprovals.length > 0 && (
          <div style={{ padding: '8px 16px', background: '#fffbeb', borderBottom: '1px solid #fef3c7' }}>
            <Alert
              message="任务已暂停，等待用户审批敏感操作。"
              type="warning"
              showIcon
              action={
                <Space>
                  {pendingApprovals.map(appr => (
                    <Button key={appr.id} size="small" type="primary" onClick={() => {
                      const element = document.getElementById(`approval-${appr.id}`)
                      element?.scrollIntoView({ behavior: 'smooth' })
                    }}>
                      去审批
                    </Button>
                  ))}
                </Space>
              }
            />
          </div>
        )}

        {/* Message Stream */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {messages.map(message => {
            const isUser = message.role === 'user'
            const isAssistant = message.role === 'assistant'
            const isSystem = message.role === 'system'
            const isTool = message.role === 'tool'
            const isStreamingAssistant = isAssistant && Boolean(message.metadata?.streaming)

            if (isSystem) {
              return (
                <div key={message.id} style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
                  <div style={{ background: '#e2e8f0', color: '#475569', padding: '4px 12px', borderRadius: '12px', fontSize: '11px', fontWeight: 500 }}>
                    {message.content}
                  </div>
                </div>
              )
            }

            return (
              <div 
                key={message.id} 
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start',
                  width: '100%'
                }}
              >
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px', padding: '0 4px' }}>
                  {isUser ? '用户' : isAssistant ? (isStreamingAssistant ? 'WorkBuddy 正在输出' : 'WorkBuddy') : '工具调用'}
                </div>
                <div style={{
                  maxWidth: '85%',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  background: isUser ? '#0f172a' : isTool ? '#1e293b' : '#ffffff',
                  color: isUser ? '#ffffff' : isTool ? '#38bdf8' : '#334155',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                  border: isUser ? 'none' : isStreamingAssistant ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
                  fontSize: '14px',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                  fontFamily: isTool ? 'Consolas, Courier New, monospace' : 'inherit'
                }}>
                  {message.content}
                </div>
              </div>
            )
          })}

          {pendingApprovals.map(approval => (
            <div 
              key={approval.id} 
              id={`approval-${approval.id}`}
              style={{
                alignSelf: 'flex-start',
                maxWidth: '600px',
                width: '100%',
                padding: '16px',
                background: '#fffbeb',
                border: '1px solid #fef3c7',
                borderRadius: '12px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.02)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                margin: '8px 0'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#b45309' }}>🙋 需要授权的操作</span>
                <Tag color="warning">待审批</Tag>
              </div>
              <div style={{ fontSize: '14px', color: '#451a03', fontWeight: 500 }}>
                {approval.reason}
              </div>
              
              {approval.originalArgs && (
                <pre style={{
                  background: '#ffffff',
                  padding: '10px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  overflow: 'auto',
                  maxHeight: '120px',
                  margin: 0,
                  border: '1px solid #fef3c7',
                  fontFamily: 'Consolas, Courier New, monospace'
                }}>
                  {JSON.stringify(approval.originalArgs, null, 2)}
                </pre>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <Button 
                  type="primary"
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={() => approveTask(approval.id, 'approved')}
                  style={{ flex: 1, height: '32px', fontSize: '12px', background: '#10b981', borderColor: '#10b981', fontWeight: 600 }}
                >
                  确认同意
                </Button>
                <Button 
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => handleOpenEditApproval(approval.id, approval.originalArgs)}
                  style={{ flex: 1, height: '32px', fontSize: '12px', fontWeight: 500 }}
                >
                  修改参数
                </Button>
                <Button 
                  danger
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={() => approveTask(approval.id, 'rejected')}
                  style={{ flex: 1, height: '32px', fontSize: '12px', fontWeight: 600 }}
                >
                  拒绝执行
                </Button>
              </div>
            </div>
          ))}

          {messages.length === 0 && (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#94a3b8' }}>
              暂无对话记录，发送一条消息开始。
            </div>
          )}
        </div>

        {/* Message Composer Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #f1f5f9', background: '#ffffff' }}>
          <TaskComposer
            key={taskId}
            workspaces={workspaces}
            draft={drafts[taskId ?? '']}
            hideTitle={true}
            hideWorkspacePicker={true}
            buttonLabel="发送"
            onDraftChange={draft => {
              void saveDraft(taskId ?? '', {
                content: draft.content,
                selectedSkillIds: draft.selectedSkillIds,
                selectedConnectorIds: draft.selectedConnectorIds,
              })
            }}
            onClearDraft={() => clearDraft(taskId ?? '')}
            onSend={async (content, options) => {
              const clients = createAnybuddyClients(window.anybuddy)
              await clients.task.update(taskId ?? '', {
                mode: options.mode,
                modelId: options.modelId,
                skillIds: options.skillIds,
                connectorIds: options.connectorIds,
                permissionMode: options.permissionMode
              })
              await sendMessage(taskId ?? '', content)
              await clearDraft(taskId ?? '')
            }}
          />
        </div>
      </div>

      {/* Edit Approval Arguments Modal */}
      <Modal
        open={editApprovalId !== null}
        onCancel={() => setEditApprovalId(null)}
        onOk={handleSaveEditApproval}
        title="修改工具参数并审批"
        okText="确认并同意"
        cancelText="取消"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 0' }}>
          <span style={{ fontSize: '12px', color: '#475569' }}>
            请以 JSON 格式修改参数：
          </span>
          <Input.TextArea
            rows={8}
            value={editedArgsText}
            onChange={e => setEditedArgsText(e.target.value)}
            style={{ fontFamily: 'Consolas, monospace', fontSize: '12px' }}
          />
        </div>
      </Modal>
    </div>
  )
}
