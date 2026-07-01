import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Input, Modal, Tag } from 'antd';
import type { AgentRun, ExpertPreset, Message } from '../../shared/types.js';
import { createAnybuddyClients } from '../api/clients.js';
import TaskComposer from '../components/TaskComposer.js';
import { useAppStore } from '../stores/app-store.js';
import { buildRuntimeToolCards, summarizeRuntimeEvent } from '../stores/runtime-message-view.js';

function formatAccessMode(value: 'read_only' | 'read_write') {
  return value === 'read_only' ? '只读' : '读写';
}

function formatTimestamp(value?: string) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}



function CollapsibleToolMessage({ message }: { message: Message }) {
  const [collapsed, setCollapsed] = useState(true);
  const eventType = message.metadata?.eventType;
  const isResult = message.content.startsWith('工具结果:') || eventType === 'tool_result';
  const prefix = isResult ? '✅' : '🔧';
  const displayTitle = message.content;

  let detailText = '';
  const payload = message.metadata?.payload as Record<string, unknown> | undefined;
  if (payload) {
    if (eventType === 'tool_called' && payload.arguments) {
      detailText = typeof payload.arguments === 'string'
        ? payload.arguments
        : JSON.stringify(payload.arguments, null, 2);
    } else if (eventType === 'tool_result' && payload.result) {
      detailText = typeof payload.result === 'string'
        ? payload.result
        : JSON.stringify(payload.result, null, 2);
    } else {
      detailText = JSON.stringify(payload, null, 2);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', margin: '4px 0' }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          borderRadius: '8px',
          background: '#f1f5f9',
          border: '1px solid #e2e8f0',
          cursor: 'pointer',
          fontSize: '12px',
          color: '#475569',
          userSelect: 'none',
          transition: 'all 0.2s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = '#e2e8f0';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = '#f1f5f9';
        }}
      >
        <span>{prefix}</span>
        <span style={{ fontWeight: 500, fontFamily: 'monospace' }}>{displayTitle}</span>
        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
          {collapsed ? '▶ 展开' : '▼ 折叠'}
        </span>
      </div>
      {!collapsed && (
        <div
          style={{
            marginTop: '6px',
            maxWidth: '85%',
            width: '100%',
            padding: '12px 16px',
            borderRadius: '12px',
            background: '#1e293b',
            color: '#38bdf8',
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
            border: '1px solid #0f172a',
            fontSize: '13px',
            lineHeight: '1.6',
            whiteSpace: 'pre-wrap',
            fontFamily: 'Consolas, Courier New, monospace',
            overflowX: 'auto',
          }}
        >
          {detailText || message.content}
        </div>
      )}
    </div>
  );
}

export default function TaskDetailPage() {
  const { taskId } = useParams();
  const selectedTaskId = useAppStore((state) => state.selectedTaskId);
  const task = useAppStore((state) => state.taskDetail);
  const messages = useAppStore((state) => state.messages);
  const drafts = useAppStore((state) => state.drafts);
  const taskWorkspaces = useAppStore((state) => state.taskWorkspaces);
  const allAgentRuns = useAppStore((state) => state.agentRuns);
  const taskEvents = useAppStore((state) => state.taskEvents);
  const taskApprovals = useAppStore((state) => state.taskApprovals);
  const experts = useAppStore((state) => state.experts);
  const selectTask = useAppStore((state) => state.selectTask);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const saveDraft = useAppStore((state) => state.saveDraft);
  const clearDraft = useAppStore((state) => state.clearDraft);
  const resumeInterruptedRun = useAppStore((state) => state.resumeInterruptedRun);
  const workspaces = useAppStore((state) => state.workspaces);

  const [editApprovalId, setEditApprovalId] = useState<string | null>(null);
  const [editedArgsText, setEditedArgsText] = useState('');

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages, taskEvents, taskId]);

  useEffect(() => {
    if (taskId && selectedTaskId !== taskId) {
      selectTask(taskId).catch((error) => console.error(error));
    }
  }, [selectTask, selectedTaskId, taskId]);

  const agentRuns = useMemo(() => allAgentRuns.filter((run) => run.taskId === taskId), [allAgentRuns, taskId]);

  const primaryWorkspace = useMemo(() => {
    if (!task?.primaryWorkspaceId) return undefined;
    return workspaces.find((workspace) => workspace.id === task.primaryWorkspaceId);
  }, [task?.primaryWorkspaceId, workspaces]);

  const currentRun = agentRuns[0];
  const activeExpert = useMemo(() => experts.find((expert) => expert.id === task?.activeExpertId), [experts, task?.activeExpertId]);
  const availableExperts = useMemo(() => experts.filter((expert) => task?.expertIds.includes(expert.id)), [experts, task?.expertIds]);



  const attachedWorkspaces = useMemo(() => taskWorkspaces.filter((workspace) => workspace.role === 'attached'), [taskWorkspaces]);

  const pendingInterrupts = useMemo(() => taskApprovals.filter((appr) => appr.decision === 'pending'), [taskApprovals]);



  if (!task) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '48px' }}>
        <Empty description="选择一个任务查看对话和运行状态。" />
      </div>
    );
  }

  const getStatusLabelAndColor = (status: string) => {
    switch (status) {
      case 'idle':
      case 'queued':
      case 'planning':
        return { label: '规划中', color: 'blue' };
      case 'running':
        return { label: '进行中', color: 'geekblue' };
      case 'completed':
        return { label: '已完成', color: 'success' };
      case 'failed':
        return { label: '失败', color: 'error' };
      case 'paused':
      case 'waiting_approval':
        return { label: '待恢复', color: 'warning' };
      case 'archived':
        return { label: '已归档', color: 'default' };
      case 'cancelled':
        return { label: '已取消', color: 'default' };
      default:
        return { label: status, color: 'default' };
    }
  };

  const handleOpenEditInterrupt = (approvalId: string, args: unknown) => {
    setEditApprovalId(approvalId);
    setEditedArgsText(JSON.stringify(args ?? {}, null, 2));
  };

  const handleResumeWithEditedArgs = async () => {
    if (!editApprovalId) return;
    try {
      const editedArgs = JSON.parse(editedArgsText);
      await resumeInterruptedRun(editApprovalId, 'resume_with_edits', editedArgs);
      setEditApprovalId(null);
    } catch (error) {
      console.error(error);
    }
  };

  const handleSwitchExpert = async (expert: ExpertPreset) => {
    if (!taskId) return;
    if (expert.id === task?.activeExpertId) return;
    const clients = createAnybuddyClients(window.anybuddy);
    const updateResult = await clients.task.update(taskId, {
      activeExpertId: expert.id,
      expertIds: task?.expertIds.includes(expert.id) ? task.expertIds : [...(task?.expertIds ?? []), expert.id],
    });
    if (!updateResult.ok) {
      throw new Error(updateResult.error.message);
    }
    const messageResult = await clients.message.create(taskId, {
      role: 'system',
      content: `已切换到 ${expert.name}`,
      metadata: {
        eventType: 'expert_switched',
        expertId: expert.id,
        expertName: expert.name,
      },
    });
    if (!messageResult.ok) {
      throw new Error(messageResult.error.message);
    }
    await selectTask(taskId);
  };



  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#ffffff', width: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>{task.title}</h2>
              {(() => {
                const statusInfo = getStatusLabelAndColor(task.status);
                return <Tag color={statusInfo.color}>{statusInfo.label}</Tag>;
              })()}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              模式: <span style={{ fontWeight: 600, color: '#475569' }}>{task.mode.toUpperCase()}</span> · 主空间 <span style={{ fontWeight: 600, color: '#475569' }}>{primaryWorkspace?.name ?? '无主空间'}</span>
            </div>
          </div>
        </div>

        {pendingInterrupts.length > 0 && (
          <div style={{ padding: '8px 16px', background: '#fffbeb', borderBottom: '1px solid #fef3c7' }}>
            <Alert
              message="运行已暂停，等待你确认或调整这次中断的执行参数。"
              type="warning"
              showIcon
              action={
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    const element = document.getElementById('runtime-interrupts-panel');
                    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  查看恢复点
                </Button>
              }
            />
          </div>
        )}

        <div ref={scrollContainerRef} style={{ flex: 1, overflowY: 'auto', padding: '24px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {messages.map((message) => {
            const isUser = message.role === 'user';
            const isAssistant = message.role === 'assistant';
            const isSystem = message.role === 'system';
            const isTool = message.role === 'tool';
            const isStreamingAssistant = isAssistant && Boolean(message.metadata?.streaming);

            if (isSystem) {
              return (
                <div key={message.id} style={{ display: 'flex', justifyContent: 'center', margin: '8px 0', width: '100%' }}>
                  <div style={{ background: '#f1f5f9', color: '#64748b', padding: '6px 16px', borderRadius: '12px', fontSize: '12px', fontWeight: 500, border: '1px solid #e2e8f0' }}>{message.content}</div>
                </div>
              );
            }

            if (isTool) {
              return <CollapsibleToolMessage key={message.id} message={message} />;
            }

            return (
              <div key={message.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', width: '100%' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px', padding: '0 4px' }}>
                  {isUser
                    ? '用户'
                    : isAssistant
                      ? (isStreamingAssistant
                          ? `${String(message.metadata?.expertName ?? 'AnyBuddy')} 正在输出`
                          : String(message.metadata?.expertName ?? 'AnyBuddy'))
                      : '工具调用'}
                </div>
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '12px 16px',
                    background: isUser ? '#0f172a' : isTool ? '#1e293b' : '#ffffff',
                    color: isUser ? '#ffffff' : isTool ? '#38bdf8' : '#334155',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                    border: isUser ? 'none' : isStreamingAssistant ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    whiteSpace: 'pre-wrap',
                    fontFamily: isTool ? 'Consolas, Courier New, monospace' : 'inherit',
                  }}
                >
                  {message.content}
                </div>
              </div>
            );
          })}

          {messages.length === 0 && <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#94a3b8' }}>暂无对话记录，发送一条消息开始。</div>}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #f1f5f9', background: '#ffffff' }}>
          <TaskComposer
            workspaces={workspaces}
            draft={drafts[taskId ?? '']}
            hideTitle={true}
            hideWorkspacePicker={true}
            buttonLabel="发送"
            onDraftChange={(draft) => {
              void saveDraft(taskId ?? '', {
                content: draft.content,
                selectedSkillIds: draft.selectedSkillIds,
                selectedConnectorIds: draft.selectedConnectorIds,
                selectedExpertIds: draft.selectedExpertIds,
                selectedExpertId: draft.selectedExpertId,
              });
            }}
            onClearDraft={() => clearDraft(taskId ?? '')}
            onSend={async (content, options) => {
              const clients = createAnybuddyClients(window.anybuddy);
              const updateResult = await clients.task.update(taskId ?? '', {
                mode: options.mode,
                modelId: options.modelId,
                skillIds: options.skillIds,
                connectorIds: options.connectorIds,
                expertIds: options.expertIds ?? [],
                activeExpertId: options.activeExpertId,
                permissionMode: options.permissionMode,
              });
              if (!updateResult.ok) {
                throw new Error(updateResult.error.message);
              }
              await sendMessage(taskId ?? '', content);
              await clearDraft(taskId ?? '');
            }}
          />
        </div>
      </div>

      <div style={{ width: '420px', borderLeft: '1px solid #f1f5f9', background: '#fcfcfd', padding: '20px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Runtime</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>{currentRun?.agentName ?? '暂无运行'}</div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>当前节点: {currentRun?.currentNode ?? 'idle'}</div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>当前专家</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{activeExpert?.name ?? '通用助手'}</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', lineHeight: 1.6 }}>{activeExpert?.description ?? '当前未指定专家，使用默认 AnyBuddy persona。'}</div>
            </div>
            {availableExperts.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {availableExperts.map((expert) => {
                  const isActive = expert.id === task.activeExpertId;
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
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>运行摘要</div>
          <div style={{ display: 'grid', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#64748b' }}>主运行状态</span>
              <Tag color={getStatusLabelAndColor(currentRun?.status ?? task.status).color}>{getStatusLabelAndColor(currentRun?.status ?? task.status).label}</Tag>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#64748b' }}>已注册专家</span>
              <span style={{ color: '#0f172a', fontWeight: 600 }}>{availableExperts.length}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#64748b' }}>待恢复中断</span>
              <span style={{ color: '#b45309', fontWeight: 600 }}>{pendingInterrupts.length}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#64748b' }}>最近事件</span>
              <span style={{ color: '#0f172a', fontWeight: 600 }}>{taskEvents.length}</span>
            </div>
          </div>
        </div>

        <div id="runtime-interrupts-panel" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>中断恢复</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {pendingInterrupts.map((interrupt) => (
              <div key={interrupt.id} style={{ border: '1px solid #fef3c7', background: '#fffbeb', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#92400e' }}>运行暂停点</div>
                    <div style={{ fontSize: '11px', color: '#b45309', marginTop: '2px' }}>{formatTimestamp(interrupt.createdAt)}</div>
                  </div>
                  <Tag color="warning">等待恢复</Tag>
                </div>
                <div style={{ fontSize: '13px', color: '#451a03', lineHeight: 1.6 }}>{interrupt.reason}</div>
                <div style={{ fontSize: '11px', color: '#92400e', fontWeight: 600 }}>将要恢复执行的参数</div>
                <pre style={{ background: '#ffffff', padding: '10px', borderRadius: '8px', fontSize: '11px', overflow: 'auto', maxHeight: '140px', margin: 0, border: '1px solid #fef3c7', fontFamily: 'Consolas, Courier New, monospace', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(interrupt.originalArgs ?? {}, null, 2)}
                </pre>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => void resumeInterruptedRun(interrupt.id, 'resume')} style={{ flex: 1, background: '#10b981', borderColor: '#10b981', fontWeight: 600 }}>
                    按原参数恢复
                  </Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => handleOpenEditInterrupt(interrupt.id, interrupt.originalArgs)} style={{ flex: 1, fontWeight: 500 }}>
                    编辑参数
                  </Button>
                  <Button danger size="small" icon={<CloseOutlined />} onClick={() => void resumeInterruptedRun(interrupt.id, 'cancel')} style={{ flex: 1, fontWeight: 600 }}>
                    取消本次执行
                  </Button>
                </div>
              </div>
            ))}
            {pendingInterrupts.length === 0 && <div style={{ fontSize: '12px', color: '#94a3b8' }}>当前没有待恢复的中断点。</div>}
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>运行记录</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {agentRuns.filter((run) => run.kind === 'main').map((run) => (
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
          </div>
        </div>



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

      <Modal open={editApprovalId !== null} onCancel={() => setEditApprovalId(null)} onOk={() => void handleResumeWithEditedArgs()} title="编辑参数并恢复执行" okText="按编辑参数恢复" cancelText="取消">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 0' }}>
          <span style={{ fontSize: '12px', color: '#475569' }}>请以 JSON 格式调整这次恢复执行要使用的参数。</span>
          <Input.TextArea rows={8} value={editedArgsText} onChange={(event) => setEditedArgsText(event.target.value)} style={{ fontFamily: 'Consolas, monospace', fontSize: '12px' }} />
        </div>
      </Modal>
    </div>
  );
}
