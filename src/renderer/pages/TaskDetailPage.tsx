import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckOutlined, CloseOutlined, EditOutlined, MessageOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Input, Modal, Tag } from 'antd';
import type { AgentRun, Message } from '../../shared/types.js';
import { createAnybuddyClients } from '../api/clients.js';
import TaskComposer from '../components/TaskComposer.js';
import { useAppStore } from '../stores/app-store.js';
import { buildRuntimeEventCard, buildRuntimeToolCards, summarizeRuntimeEvent } from '../stores/runtime-message-view.js';

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

function getRunThreadMessages(messages: Message[], run: AgentRun) {
  return messages.filter((message) => message.runId === run.id || message.metadata?.subagentRunId === run.id);
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
  const selectTask = useAppStore((state) => state.selectTask);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const saveDraft = useAppStore((state) => state.saveDraft);
  const clearDraft = useAppStore((state) => state.clearDraft);
  const resumeInterruptedRun = useAppStore((state) => state.resumeInterruptedRun);
  const sendSubagentMessage = useAppStore((state) => state.sendSubagentMessage);
  const stopSubagent = useAppStore((state) => state.stopSubagent);
  const workspaces = useAppStore((state) => state.workspaces);

  const [editApprovalId, setEditApprovalId] = useState<string | null>(null);
  const [editedArgsText, setEditedArgsText] = useState('');
  const [activeSubagentId, setActiveSubagentId] = useState<string | null>(null);
  const [subagentMessageText, setSubagentMessageText] = useState('');

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
  const subagentRuns = useMemo(() => agentRuns.filter((run) => run.kind === 'subagent'), [agentRuns]);

  useEffect(() => {
    if (!subagentRuns.length) {
      setActiveSubagentId(null);
      return;
    }
    setActiveSubagentId((current) => {
      if (current && subagentRuns.some((run) => run.id === current)) {
        return current;
      }
      return subagentRuns[0]?.id ?? null;
    });
  }, [subagentRuns]);

  const attachedWorkspaces = useMemo(() => taskWorkspaces.filter((workspace) => workspace.role === 'attached'), [taskWorkspaces]);

  const pendingInterrupts = useMemo(() => taskApprovals.filter((appr) => appr.decision === 'pending'), [taskApprovals]);

  const toolCards = useMemo(() => buildRuntimeToolCards(taskEvents), [taskEvents]);

  const timelineCards = useMemo(() => taskEvents.slice().reverse().slice(0, 16).map(buildRuntimeEventCard), [taskEvents]);

  const runtimeEventMessages = useMemo(() => taskEvents.map(summarizeRuntimeEvent).filter((message): message is Message => Boolean(message)), [taskEvents]);

  const activeSubagentRun = useMemo(() => subagentRuns.find((run) => run.id === activeSubagentId) ?? null, [activeSubagentId, subagentRuns]);

  const activeSubagentMessages = useMemo(() => (activeSubagentRun ? getRunThreadMessages(messages, activeSubagentRun) : []), [activeSubagentRun, messages]);

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

  const handleSendSubagentMessage = async () => {
    if (!activeSubagentId || !subagentMessageText.trim()) return;
    await sendSubagentMessage(activeSubagentId, subagentMessageText.trim());
    setSubagentMessageText('');
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
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px', padding: '0 4px' }}>{isUser ? '用户' : isAssistant ? (isStreamingAssistant ? 'AnyBuddy 正在输出' : 'AnyBuddy') : '工具调用'}</div>
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
              });
            }}
            onClearDraft={() => clearDraft(taskId ?? '')}
            onSend={async (content, options) => {
              const clients = createAnybuddyClients(window.anybuddy);
              await clients.task.update(taskId ?? '', {
                mode: options.mode,
                modelId: options.modelId,
                skillIds: options.skillIds,
                connectorIds: options.connectorIds,
                permissionMode: options.permissionMode,
              });
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
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>运行摘要</div>
          <div style={{ display: 'grid', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#64748b' }}>主运行状态</span>
              <Tag color={getStatusLabelAndColor(currentRun?.status ?? task.status).color}>{getStatusLabelAndColor(currentRun?.status ?? task.status).label}</Tag>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#64748b' }}>子 Agent 数量</span>
              <span style={{ color: '#0f172a', fontWeight: 600 }}>{subagentRuns.length}</span>
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
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>Agent Runs</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {agentRuns.map((run) => (
              <div
                key={run.id}
                style={{
                  border: activeSubagentId === run.id ? '1px solid #93c5fd' : '1px solid #f1f5f9',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  background: run.kind === 'main' ? '#f8fafc' : activeSubagentId === run.id ? '#eff6ff' : '#ffffff',
                  cursor: run.kind === 'subagent' ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (run.kind === 'subagent') {
                    setActiveSubagentId(run.id);
                  }
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{run.agentName}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      {run.kind === 'main' ? '主 Agent' : '子 Agent'} · {run.currentNode ?? 'idle'}
                    </div>
                  </div>
                  <Tag color={getStatusLabelAndColor(run.status).color}>{getStatusLabelAndColor(run.status).label}</Tag>
                </div>
                {run.kind === 'subagent' && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '8px' }}>线程消息数 {getRunThreadMessages(messages, run).length}</div>}
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '8px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>Subagent Threads</div>
            {activeSubagentRun && <Tag color={getStatusLabelAndColor(activeSubagentRun.status).color}>{getStatusLabelAndColor(activeSubagentRun.status).label}</Tag>}
          </div>

          {!activeSubagentRun && <div style={{ fontSize: '12px', color: '#94a3b8' }}>当前还没有子 Agent 线程。</div>}

          {activeSubagentRun && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{activeSubagentRun.agentName}</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                    节点: {activeSubagentRun.currentNode ?? 'idle'} · 创建于 {formatTimestamp(activeSubagentRun.createdAt)}
                  </div>
                </div>
                {activeSubagentRun.status !== 'cancelled' && activeSubagentRun.status !== 'completed' && activeSubagentRun.status !== 'failed' && (
                  <Button size="small" danger icon={<StopOutlined />} onClick={() => void stopSubagent(activeSubagentRun.id, 'stopped from task detail panel')}>
                    停止
                  </Button>
                )}
              </div>

              <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
                {activeSubagentMessages.map((message) => {
                  const isUser = message.role === 'user';
                  const isAssistant = message.role === 'assistant';
                  const isTool = message.role === 'tool';
                  const label = isUser ? '你发给子 Agent 的追加消息' : isAssistant ? '子 Agent' : isTool ? '工具' : '系统';

                  return (
                    <div key={message.id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px', background: isUser ? '#eff6ff' : '#f8fafc' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                        {label} · {formatTimestamp(message.createdAt)}
                      </div>
                      <div style={{ fontSize: '12px', color: '#0f172a', lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: isTool ? 'Consolas, Courier New, monospace' : 'inherit' }}>{message.content}</div>
                    </div>
                  );
                })}
                {activeSubagentMessages.length === 0 && <div style={{ fontSize: '12px', color: '#94a3b8' }}>这个子 Agent 线程还没有可展示的消息。</div>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>继续这个线程</div>
                <Input.TextArea rows={4} value={subagentMessageText} onChange={(event) => setSubagentMessageText(event.target.value)} placeholder="补充上下文、调整策略，或者要求子 Agent 继续追查。" />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="primary" icon={<MessageOutlined />} disabled={!subagentMessageText.trim()} onClick={() => void handleSendSubagentMessage()}>
                    发送到线程
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>运行时间线</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {timelineCards.map((card) => (
              <div key={card.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #eef2f7' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '999px', background: card.tone === 'warning' ? '#f59e0b' : card.tone === 'error' ? '#ef4444' : card.tone === 'success' ? '#10b981' : card.tone === 'info' ? '#0ea5e9' : '#94a3b8', marginTop: '6px', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>{card.title}</div>
                  {card.description && <div style={{ fontSize: '12px', color: '#475569', marginTop: '3px', whiteSpace: 'pre-wrap' }}>{card.description}</div>}
                  {card.detail && (
                    <pre style={{ margin: '8px 0 0 0', padding: '8px 10px', borderRadius: '8px', background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155', fontSize: '11px', whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: '140px', fontFamily: 'Consolas, Courier New, monospace' }}>
                      {card.detail}
                    </pre>
                  )}
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{card.createdAt}</div>
                </div>
              </div>
            ))}
            {timelineCards.length === 0 && <div style={{ fontSize: '12px', color: '#94a3b8' }}>暂无运行事件</div>}
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
