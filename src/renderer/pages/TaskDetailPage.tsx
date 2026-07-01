import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Input, Modal, Tag } from 'antd';
import { Play, Edit2, XCircle, AlertCircle, Terminal, ShieldAlert } from 'lucide-react';
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
function parseInlineMarkdown(text: string): React.ReactNode[] {
  const regex = /(\*\*.*?\*\*|`.*?`)/g;
  const splitParts = text.split(regex);

  return splitParts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ fontWeight: 600, color: '#1e293b' }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          style={{
            background: '#f1f5f9',
            color: '#e11d48',
            padding: '2px 6px',
            borderRadius: '4px',
            fontFamily: `Consolas, 'Fira Code', monospace`,
            fontSize: '12px',
            border: '1px solid #e2e8f0',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function renderMarkdown(content: string) {
  const lines = content.split('\n');
  return lines.map((line, index) => {
    if (line.startsWith('### ')) {
      return <h3 key={index} style={{ margin: '8px 0 4px 0', fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>{parseInlineMarkdown(line.slice(4))}</h3>;
    }
    if (line.startsWith('## ')) {
      return <h2 key={index} style={{ margin: '12px 0 6px 0', fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>{parseInlineMarkdown(line.slice(3))}</h2>;
    }
    if (line.startsWith('# ')) {
      return <h1 key={index} style={{ margin: '14px 0 8px 0', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>{parseInlineMarkdown(line.slice(2))}</h1>;
    }

    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const indent = line.search(/\S/);
      return (
        <div key={index} style={{ display: 'flex', gap: '6px', paddingLeft: `${indent * 8 + 8}px`, margin: '4px 0', alignItems: 'flex-start' }}>
          <span style={{ color: '#6366f1', userSelect: 'none' }}>•</span>
          <span style={{ flex: 1 }}>{parseInlineMarkdown(line.trim().slice(2))}</span>
        </div>
      );
    }

    if (line.trim().startsWith('> ')) {
      return (
        <blockquote key={index} style={{ borderLeft: '4px solid #cbd5e1', paddingLeft: '12px', margin: '8px 0', color: '#64748b', fontStyle: 'italic' }}>
          {parseInlineMarkdown(line.trim().slice(2))}
        </blockquote>
      );
    }

    if (!line.trim()) {
      return <div key={index} style={{ height: '8px' }} />;
    }

    return (
      <p key={index} style={{ margin: '4px 0', minHeight: '1.2em' }}>
        {parseInlineMarkdown(line)}
      </p>
    );
  });
}

function CollapsibleToolMessage({ message }: { message: Message }) {
  const [collapsed, setCollapsed] = useState(true);
  const eventType = message.metadata?.eventType;
  const isResult = message.content.startsWith('工具结果:') || eventType === 'tool_result';

  const payload = message.metadata?.payload as Record<string, unknown> | undefined;
  const toolName = String(payload?.toolName ?? 'unknown');

  // Extract key args for display on the title bar
  let argContext = '';
  if (eventType === 'tool_called' && payload?.arguments) {
    const args = payload.arguments as Record<string, unknown>;
    const pathVal = args.path ?? args.filePath ?? args.file_path ?? args.filename;
    if (typeof pathVal === 'string' && pathVal) {
      argContext = pathVal;
    } else if (typeof args.command === 'string' && args.command) {
      argContext = args.command;
    } else if (typeof args.query === 'string' && args.query) {
      argContext = `"${args.query}"`;
    }
  }

  // Determine beautiful title
  let displayTitle = '';
  if (eventType === 'tool_called') {
    displayTitle = `调用工具 · ${toolName}${argContext ? ` (${argContext})` : ''}`;
  } else if (eventType === 'tool_result') {
    const summary = String(payload?.summary || '执行成功');
    displayTitle = `工具结果 · ${toolName} : ${summary}`;
  } else {
    displayTitle = message.content;
  }

  let detailText = '';
  if (payload) {
    if (eventType === 'tool_called' && payload.arguments) {
      detailText = typeof payload.arguments === 'string'
        ? payload.arguments
        : JSON.stringify(payload.arguments, null, 2);
    } else if (eventType === 'tool_result' && payload.result) {
      const resultObj = payload.result as Record<string, unknown>;
      detailText = JSON.stringify(resultObj, null, 2);
    } else {
      detailText = JSON.stringify(payload, null, 2);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', margin: '6px 0' }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 14px',
          borderRadius: '10px',
          background: isResult
            ? 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)'
            : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          border: isResult
            ? '1px solid #bbf7d0'
            : '1px solid #e2e8f0',
          cursor: 'pointer',
          fontSize: '12px',
          color: isResult ? '#166534' : '#334155',
          userSelect: 'none',
          transition: 'all 0.2s',
          boxShadow: '0 2px 6px rgba(0,0,0,0.01)',
          width: '100%',
          boxSizing: 'border-box',
          justifyContent: 'space-between',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = isResult ? '#86efac' : '#cbd5e1';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.03)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = isResult ? '#bbf7d0' : '#e2e8f0';
          e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.01)';
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px',
            borderRadius: '6px',
            background: isResult ? '#dcfce7' : '#e2e8f0',
            fontSize: '11px',
          }}>
            {isResult ? '✅' : '🔧'}
          </span>
          <span style={{ fontWeight: 600, fontFamily: `Consolas, 'Fira Code', monospace` }}>{displayTitle}</span>
        </div>
        <span style={{ fontSize: '11px', color: isResult ? '#15803d' : '#64748b', whiteSpace: 'nowrap' }}>
          {collapsed ? '展开参数' : '收起参数'}
        </span>
      </div>
      {!collapsed && (
        <div
          style={{
            marginTop: '6px',
            width: '100%',
            padding: '12px 16px',
            borderRadius: '12px',
            background: '#0f172a',
            color: '#38bdf8',
            boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.15)',
            border: '1px solid #1e293b',
            fontSize: '12px',
            lineHeight: '1.6',
            whiteSpace: 'pre-wrap',
            fontFamily: `'Fira Code', 'Consolas', 'Courier New', monospace`,
            overflowX: 'auto',
            boxSizing: 'border-box',
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

  const isAgentWorking = useMemo(() => {
    return currentRun && ['queued', 'running', 'planning'].includes(currentRun.status);
  }, [currentRun]);

  const handleClearRuns = () => {
    Modal.confirm({
      title: '确认清除运行记录？',
      content: '清除运行记录将清空该任务的所有历史执行信息和中间步骤事件，此操作不可撤销。',
      okText: '确认清除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const clients = createAnybuddyClients(window.anybuddy);
        const result = await clients.agentRun.clearByTask(taskId ?? '');
        if (result.ok) {
          await selectTask(taskId ?? '');
        }
      }
    });
  };



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
          <div style={{
            padding: '12px 24px',
            background: 'linear-gradient(90deg, #fffbeb 0%, #fef3c7 100%)',
            borderBottom: '1px solid #fde68a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: 'inset 0 -2px 4px rgba(251, 191, 36, 0.03)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: '#fffdf5',
                border: '1px solid #fbbf24',
                color: '#d97706',
                boxShadow: '0 2px 4px rgba(217, 119, 6, 0.06)'
              }}>
                <AlertCircle size={15} />
              </span>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#78350f' }}>
                  运行已暂停
                </div>
                <div style={{ fontSize: '11px', color: '#92400e', marginTop: '1px' }}>
                  Agent 触发了中断点，正在等待您确认或调整恢复参数。
                </div>
              </div>
            </div>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                const element = document.getElementById('runtime-interrupts-panel');
                element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              style={{
                background: '#d97706',
                borderColor: '#d97706',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                boxShadow: '0 2px 6px rgba(217, 119, 6, 0.15)',
                display: 'flex',
                alignItems: 'center',
                height: '28px'
              }}
            >
              查看恢复点
            </Button>
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
              const isError = message.metadata?.eventType === 'run_failed';
              if (isError) {
                return (
                  <div key={message.id} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    margin: '12px 0',
                    padding: '16px',
                    background: 'linear-gradient(180deg, #fef2f2 0%, #fff1f1 100%)',
                    border: '1px solid #fca5a5',
                    borderRadius: '12px',
                    boxShadow: '0 4px 12px rgba(239, 68, 68, 0.05)',
                    width: '100%',
                    boxSizing: 'border-box'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#dc2626', fontWeight: 700, fontSize: '13px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '50%', background: '#fee2e2', fontSize: '12px' }}>
                        ❌
                      </span>
                      运行失败
                    </div>
                    <div style={{ fontSize: '12px', color: '#991b1b', lineHeight: 1.6, fontFamily: `Consolas, 'Fira Code', monospace`, background: 'rgba(239, 68, 68, 0.03)', padding: '10px 12px', borderRadius: '6px', border: '1px dashed #fca5a5', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {message.content}
                    </div>
                  </div>
                );
              }
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
                    fontFamily: isTool ? 'Consolas, Courier New, monospace' : 'inherit',
                  }}
                >
                  {isUser || isTool ? (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {renderMarkdown(message.content)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isAgentWorking && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 18px',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.02)',
              width: 'fit-content',
              animation: 'pulseBorder 2s infinite alternate',
              margin: '8px 0',
              alignSelf: 'flex-start'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="pulsing-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#6366f1' }}></span>
                <span className="pulsing-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#3b82f6', animationDelay: '0.2s' }}></span>
                <span className="pulsing-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', animationDelay: '0.4s' }}></span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {activeExpert?.name ?? 'AnyBuddy'} 正在执行中
                </span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  {(() => {
                    const node = currentRun?.currentNode;
                    if (node === 'plan' || node === 'planning') return '正在规划方案...';
                    if (node === 'execute' || node === 'execution') return '正在执行操作步骤...';
                    if (node === 'call_tool' || node === 'tool') return '正在调用工具...';
                    return '正在思考并执行任务中，请稍候...';
                  })()}
                </span>
              </div>
            </div>
          )}

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', position: 'relative' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Runtime</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>{currentRun?.agentName ?? '暂无运行'}</div>
            {isAgentWorking && (
              <span className="status-glow" style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#3b82f6',
                boxShadow: '0 0 8px #3b82f6',
                animation: 'pulseGlow 1.5s infinite alternate'
              }} />
            )}
          </div>
          <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
            当前节点: <Tag color="blue" style={{ margin: 0, fontSize: '10px', lineHeight: '1.4' }}>{currentRun?.currentNode ?? 'idle'}</Tag>
          </div>
          {isAgentWorking && (
            <div style={{
              position: 'absolute',
              bottom: '-10px',
              left: 0,
              right: 0,
              height: '2px',
              background: '#e2e8f0',
              borderRadius: '1px',
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                width: '40%',
                background: 'linear-gradient(90deg, #6366f1, #3b82f6)',
                borderRadius: '1px',
                animation: 'loadingBar 1.5s infinite ease-in-out'
              }} />
            </div>
          )}
        </div>

        {currentRun?.status === 'failed' && (
          <div style={{
            background: 'linear-gradient(180deg, #fef2f2 0%, #fff1f1 100%)',
            border: '1px solid #fca5a5',
            borderRadius: '14px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 4px 12px rgba(239, 68, 68, 0.03)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#dc2626', fontWeight: 700, fontSize: '13px' }}>
              <span style={{ fontSize: '14px' }}>⚠️</span> 运行失败原因
            </div>
            <div style={{ fontSize: '12px', color: '#991b1b', lineHeight: 1.5, fontFamily: `Consolas, 'Fira Code', monospace`, wordBreak: 'break-all', background: 'rgba(239, 68, 68, 0.02)', padding: '8px 10px', borderRadius: '6px', border: '1px dashed #fca5a5', whiteSpace: 'pre-wrap' }}>
              {(() => {
                const failedEvent = taskEvents.find(e => e.type === 'run_failed');
                return String(failedEvent?.payload?.message || '未知运行错误');
              })()}
            </div>
          </div>
        )}

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

        <div id="runtime-interrupts-panel" style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '16px',
          padding: '16px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.01)',
          position: 'relative',
          minHeight: '120px',
          maxHeight: '340px',
          overflowY: 'auto'
        }}>
          {pendingInterrupts.length > 0 && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '3px',
              background: 'linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%)'
            }} />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '24px',
              height: '24px',
              borderRadius: '6px',
              background: pendingInterrupts.length > 0 ? '#fffbeb' : '#f1f5f9',
              color: pendingInterrupts.length > 0 ? '#d97706' : '#64748b'
            }}>
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
                  boxShadow: '0 2px 8px rgba(245, 158, 11, 0.03)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{
                      display: 'inline-block',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: '#f59e0b',
                      boxShadow: '0 0 6px #f59e0b',
                    }} />
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#78350f' }}>运行暂停点</span>
                  </div>
                  <span style={{ fontSize: '10px', color: '#b45309' }}>{formatTimestamp(interrupt.createdAt)}</span>
                </div>
                
                <div style={{
                  fontSize: '12px',
                  color: '#451a03',
                  lineHeight: 1.6,
                  padding: '8px 12px',
                  background: 'rgba(251, 191, 36, 0.06)',
                  borderRadius: '8px',
                  borderLeft: '3px solid #fbbf24'
                }}>
                  {interrupt.reason}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ fontSize: '11px', color: '#92400e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Terminal size={11} />
                    恢复参数预览 (Args)
                  </div>
                  <pre style={{
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
                    boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.15)'
                  }}>
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
                      height: '36px'
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
                        height: '36px'
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
                        height: '36px'
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

        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '14px',
          padding: '14px',
          minHeight: '120px',
          maxHeight: '300px',
          overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>运行记录</span>
            {agentRuns.filter((run) => run.kind === 'main').length > 0 && (
              <Button
                type="link"
                size="small"
                danger
                onClick={handleClearRuns}
                style={{ padding: 0, height: 'auto', fontSize: '11px', fontWeight: 600 }}
              >
                清除记录
              </Button>
            )}
          </div>
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
            {agentRuns.filter((run) => run.kind === 'main').length === 0 && (
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>暂无运行记录。</div>
            )}
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

      <Modal
        open={editApprovalId !== null}
        onCancel={() => setEditApprovalId(null)}
        onOk={() => void handleResumeWithEditedArgs()}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#0f172a' }}>
            <span style={{ color: '#4f46e5', display: 'flex', alignItems: 'center' }}>
              <Edit2 size={16} />
            </span>
            <span style={{ fontWeight: 700 }}>编辑参数并恢复执行</span>
          </div>
        }
        okText="按编辑参数恢复"
        cancelText="取消"
        okButtonProps={{
          style: {
            background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
            borderColor: '#4f46e5',
            borderRadius: '6px',
            fontWeight: 600,
          }
        }}
        cancelButtonProps={{
          style: {
            borderRadius: '6px',
          }
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 0 4px 0' }}>
          <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
            您可以修改以下 JSON 格式的参数，修改后的参数将在恢复执行时传递给 Agent 节点：
          </div>
          <div style={{
            position: 'relative',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid #1e293b',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)'
          }}>
            <div style={{
              background: '#1e293b',
              padding: '6px 12px',
              borderBottom: '1px solid #334155',
              fontSize: '11px',
              color: '#94a3b8',
              fontFamily: 'Consolas, Courier New, monospace',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <Terminal size={12} style={{ color: '#38bdf8' }} />
              arguments.json
            </div>
            <Input.TextArea
              rows={12}
              value={editedArgsText}
              onChange={(event) => setEditedArgsText(event.target.value)}
              style={{
                fontFamily: `'Fira Code', 'Consolas', 'Courier New', monospace`,
                fontSize: '12px',
                background: '#0f172a',
                color: '#38bdf8',
                border: 'none',
                padding: '12px',
                resize: 'none',
                overflowY: 'auto',
                outline: 'none',
                boxShadow: 'none'
              }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
