import React, { memo, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Terminal,
  FileText,
  Eye,
  FilePlus,
  FileEdit,
  Search,
  Folder,
  Globe,
  Image as ImageIcon,
  Clock,
  Wrench,
  Bot,
  CheckCircle2,
  Check,
  Copy,
} from 'lucide-react'
import type { Message } from '../../../shared/types.js'
import { useAppStore } from '../../stores/app-store.js'
import { getStreamingEntriesForTask, sortTimelineMessages } from '../../stores/task-runtime-view.js'
import { useTaskDetail } from './TaskDetailContext.js'
import { renderMarkdown } from '../../utils/markdown.js'

/**
 * 提取文件扩展名 Badge 样式
 */
function getFileBadge(filename: string) {
  if (!filename) return null
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'tsx') {
    return <span style={{ fontSize: '10px', fontWeight: 700, color: '#06b6d4', background: '#ecfeff', border: '1px solid #a5f3fc', padding: '0px 5px', borderRadius: '4px', fontFamily: `Consolas, 'Fira Code', monospace`, lineHeight: '1.4' }}>TSX</span>
  }
  if (ext === 'ts') {
    return <span style={{ fontSize: '10px', fontWeight: 700, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '0px 5px', borderRadius: '4px', fontFamily: `Consolas, 'Fira Code', monospace`, lineHeight: '1.4' }}>TS</span>
  }
  if (ext === 'jsx' || ext === 'js') {
    return <span style={{ fontSize: '10px', fontWeight: 700, color: '#d97706', background: '#fffbe6', border: '1px solid #fde68a', padding: '0px 5px', borderRadius: '4px', fontFamily: `Consolas, 'Fira Code', monospace`, lineHeight: '1.4' }}>{ext.toUpperCase()}</span>
  }
  if (ext === 'json') {
    return <span style={{ fontSize: '10px', fontWeight: 700, color: '#059669', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '0px 5px', borderRadius: '4px', fontFamily: `Consolas, 'Fira Code', monospace`, lineHeight: '1.4' }}>JSON</span>
  }
  if (ext === 'css' || ext === 'scss' || ext === 'less') {
    return <span style={{ fontSize: '10px', fontWeight: 700, color: '#c026d3', background: '#fdf4ff', border: '1px solid #f5d0fe', padding: '0px 5px', borderRadius: '4px', fontFamily: `Consolas, 'Fira Code', monospace`, lineHeight: '1.4' }}>{ext.toUpperCase()}</span>
  }
  if (ext === 'md' || ext === 'markdown') {
    return <span style={{ fontSize: '10px', fontWeight: 700, color: '#0284c7', background: '#f0f9ff', border: '1px solid #bae6fd', padding: '0px 5px', borderRadius: '4px', fontFamily: `Consolas, 'Fira Code', monospace`, lineHeight: '1.4' }}>MD</span>
  }
  return null
}

/**
 * 提取文件路径 Basename
 */
function getBasename(filePath: string) {
  if (!filePath) return ''
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}

/**
 * 计算代码改动行数 (+X -Y)
 */
function extractLineDiff(args?: Record<string, unknown>) {
  if (!args) return null
  let added = 0
  let deleted = 0

  if (Array.isArray(args.ReplacementChunks)) {
    for (const chunk of args.ReplacementChunks as Array<{ TargetContent?: string; ReplacementContent?: string }>) {
      if (chunk.TargetContent) {
        deleted += chunk.TargetContent.split('\n').length
      }
      if (chunk.ReplacementContent) {
        added += chunk.ReplacementContent.split('\n').length
      }
    }
  } else if (typeof args.TargetContent === 'string' || typeof args.ReplacementContent === 'string') {
    if (typeof args.TargetContent === 'string') {
      deleted += args.TargetContent.split('\n').length
    }
    if (typeof args.ReplacementContent === 'string') {
      added += args.ReplacementContent.split('\n').length
    }
  } else if (typeof args.CodeContent === 'string') {
    added += args.CodeContent.split('\n').length
  }

  if (added === 0 && deleted === 0) return null
  return { added, deleted }
}

/**
 * 根据工具名称获取简洁操作动词
 */
function getActionVerb(toolName: string) {
  const name = toolName.toLowerCase()
  if (name.includes('command') || name.includes('bash') || name.includes('exec')) return 'Ran'
  if (name.includes('replace') || name.includes('edit')) return 'Edited'
  if (name.includes('write') || name.includes('create')) return 'Created'
  if (name.includes('view') || name.includes('read')) return 'Viewed'
  if (name.includes('grep') || name.includes('search') || name.includes('find')) return 'Searched'
  if (name.includes('dir') || name.includes('list')) return 'Explored'
  if (name.includes('web') || name.includes('url')) return 'Fetched'
  if (name.includes('image')) return 'Generated'
  return 'Executed'
}

/**
 * 根据工具名称获取语义化图标与配色配置
 */
function getToolMeta(toolName: string) {
  const name = toolName.toLowerCase()
  if (name.includes('command') || name.includes('bash') || name.includes('cmd') || name.includes('exec')) {
    return {
      icon: Terminal,
      color: '#2563eb', // Blue
      bg: '#eff6ff',
      border: '#bfdbfe',
      label: '终端命令',
    }
  }
  if (name.includes('write') || name.includes('create')) {
    return {
      icon: FilePlus,
      color: '#059669', // Emerald
      bg: '#ecfdf5',
      border: '#a7f3d0',
      label: '创建文件',
    }
  }
  if (name.includes('replace') || name.includes('edit')) {
    return {
      icon: FileEdit,
      color: '#d97706', // Amber
      bg: '#fffbe6',
      border: '#fde68a',
      label: '编辑文件',
    }
  }
  if (name.includes('view') || name.includes('read')) {
    return {
      icon: Eye,
      color: '#0284c7', // Sky
      bg: '#f0f9ff',
      border: '#bae6fd',
      label: '查看内容',
    }
  }
  if (name.includes('grep') || name.includes('search') || name.includes('find')) {
    return {
      icon: Search,
      color: '#7c3aed', // Violet
      bg: '#f5f3ff',
      border: '#ddd6fe',
      label: '检索代码',
    }
  }
  if (name.includes('dir') || name.includes('list')) {
    return {
      icon: Folder,
      color: '#475569', // Slate
      bg: '#f8fafc',
      border: '#e2e8f0',
      label: '浏览目录',
    }
  }
  if (name.includes('web') || name.includes('url')) {
    return {
      icon: Globe,
      color: '#0891b2', // Cyan
      bg: '#ecfeff',
      border: '#a5f3fc',
      label: '网页获取',
    }
  }
  if (name.includes('image')) {
    return {
      icon: ImageIcon,
      color: '#c026d3', // Fuchsia
      bg: '#fdf4ff',
      border: '#f5d0fe',
      label: '生成图片',
    }
  }
  if (name.includes('task') || name.includes('schedule')) {
    return {
      icon: Clock,
      color: '#4f46e5', // Indigo
      bg: '#eef2ff',
      border: '#c7d2fe',
      label: '任务控制',
    }
  }
  return {
    icon: Wrench,
    color: '#64748b', // Neutral
    bg: '#f8fafc',
    border: '#e2e8f0',
    label: '系统工具',
  }
}

/**
 * 极简 Terminal 质感工具调用与执行结果展示组件 (参照 IDE / Cursor / Antigravity 单行轻量展开风格)
 */
function CollapsibleToolMessage({ message }: { message: Message }) {
  const [collapsed, setCollapsed] = useState(true)
  const [activeTab, setActiveTab] = useState<'arguments' | 'result'>('arguments')
  const [copied, setCopied] = useState(false)

  const eventType = message.metadata?.eventType
  const isResult = message.content.startsWith('工具结果:') || eventType === 'tool_result'

  const payload = message.metadata?.payload as Record<string, unknown> | undefined
  const toolName = String(payload?.toolName ?? 'unknown')
  const subagentName = typeof message.metadata?.subagentName === 'string' ? message.metadata.subagentName : undefined

  const meta = getToolMeta(toolName)
  const ToolIcon = meta.icon
  const actionVerb = getActionVerb(toolName)

  let rawContext = ''
  let argsText = ''
  let resultText = ''
  let diff: { added: number; deleted: number } | null = null

  if (payload) {
    if (payload.arguments) {
      const args = payload.arguments as Record<string, unknown>
      argsText = typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments, null, 2)
      diff = extractLineDiff(args)

      const pathVal = args.TargetFile ?? args.path ?? args.filePath ?? args.file_path ?? args.filename ?? args.DirectoryPath ?? args.SearchPath
      if (typeof pathVal === 'string' && pathVal) {
        rawContext = pathVal
      } else if (typeof args.CommandLine === 'string' && args.CommandLine) {
        rawContext = args.CommandLine
      } else if (typeof args.command === 'string' && args.command) {
        rawContext = args.command
      } else if (typeof args.Query === 'string' && args.Query) {
        rawContext = `"${args.Query}"`
      } else if (typeof args.query === 'string' && args.query) {
        rawContext = `"${args.query}"`
      }
    }

    if (payload.result) {
      const result = payload.result as { text?: unknown }
      resultText = typeof payload.result === 'string'
        ? payload.result
        : typeof result.text === 'string'
          ? result.text
          : JSON.stringify(payload.result, null, 2)
    }
  }

  // 默认 Tab 逻辑：如果为结果事件则优先展示结果
  useEffect(() => {
    if (isResult && resultText) {
      setActiveTab('result')
    } else {
      setActiveTab('arguments')
    }
  }, [isResult, resultText])

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const activeText = activeTab === 'result' && resultText ? resultText : (argsText || message.content)
  const isFilePath = ['edit', 'replace', 'write', 'create', 'view', 'read'].some(k => toolName.toLowerCase().includes(k)) && rawContext
  const displayTargetName = isFilePath ? getBasename(rawContext) : rawContext
  const fileBadge = isFilePath ? getFileBadge(displayTargetName) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', margin: '2px 0' }}>
      {/* 极简流畅 Timeline 行条 */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '4px 8px',
          borderRadius: '6px',
          background: 'transparent',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'background 0.15s ease-in-out',
          width: '100%',
          boxSizing: 'border-box',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#f1f5f9'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        {/* 左侧：动作名称 + 语言 Badge + 目标文件名/命令 + 差异改动 (+X -Y) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: meta.color, flexShrink: 0 }}>
            <ToolIcon size={14} />
          </div>

          <span style={{ fontSize: '13px', fontWeight: 500, color: '#64748b', flexShrink: 0 }}>
            {actionVerb}
          </span>

          {fileBadge}

          <span
            style={{
              fontSize: '13px',
              fontWeight: 600,
              fontFamily: `Consolas, 'Fira Code', monospace`,
              color: '#0f172a',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '360px',
            }}
            title={rawContext}
          >
            {displayTargetName || toolName}
          </span>

          {diff && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '12px', fontFamily: `Consolas, 'Fira Code', monospace`, flexShrink: 0 }}>
              {diff.added > 0 && <span style={{ color: '#16a34a', fontWeight: 600 }}>+{diff.added}</span>}
              {diff.deleted > 0 && <span style={{ color: '#dc2626', fontWeight: 600 }}>-{diff.deleted}</span>}
            </span>
          )}
        </div>

        {/* 右侧：子 Agent 身份 + 展开 Chevron 箭头 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {subagentName && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 500,
                color: '#2563eb',
                background: '#eff6ff',
                padding: '1px 6px',
                borderRadius: '10px',
                border: '1px solid #bfdbfe',
              }}
            >
              {subagentName}
            </span>
          )}

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '16px',
              height: '16px',
              color: '#94a3b8',
              transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
              transition: 'transform 0.18s ease-in-out',
            }}
          >
            <ChevronRight size={14} />
          </div>
        </div>
      </div>

      {/* 展开浮层（暗调控制台明细） */}
      {!collapsed && (
        <div
          style={{
            marginTop: '4px',
            width: '100%',
            borderRadius: '8px',
            background: '#0f172a',
            border: '1px solid #1e293b',
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 12px',
              background: '#1e293b',
              borderBottom: '1px solid #334155',
              fontSize: '11px',
              color: '#94a3b8',
              fontFamily: `Consolas, 'Fira Code', monospace`,
              userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              {argsText && (
                <span
                  onClick={() => setActiveTab('arguments')}
                  style={{
                    cursor: 'pointer',
                    fontWeight: activeTab === 'arguments' ? 600 : 400,
                    color: activeTab === 'arguments' ? '#38bdf8' : '#64748b',
                    borderBottom: activeTab === 'arguments' ? '2px solid #38bdf8' : '2px solid transparent',
                    paddingBottom: '2px',
                  }}
                >
                  输入参数
                </span>
              )}
              {resultText && (
                <span
                  onClick={() => setActiveTab('result')}
                  style={{
                    cursor: 'pointer',
                    fontWeight: activeTab === 'result' ? 600 : 400,
                    color: activeTab === 'result' ? '#4ade80' : '#64748b',
                    borderBottom: activeTab === 'result' ? '2px solid #4ade80' : '2px solid transparent',
                    paddingBottom: '2px',
                  }}
                >
                  执行结果
                </span>
              )}
              {!argsText && !resultText && <span>详细信息</span>}
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation()
                handleCopy(activeText)
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: 'transparent',
                border: 'none',
                color: copied ? '#4ade80' : '#94a3b8',
                cursor: 'pointer',
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '4px',
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>

          <div
            style={{
              padding: '10px 12px',
              fontSize: '12px',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontFamily: `'Fira Code', 'Consolas', 'Courier New', monospace`,
              color: activeTab === 'result' ? '#cbd5e1' : '#38bdf8',
              maxHeight: '320px',
              overflow: 'auto',
              boxSizing: 'border-box',
            }}
          >
            {activeText}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 单条消息渲染组件
 */
const MessageItem = memo(function MessageItem({
  message,
  streamingContent,
  isLastInRun = false,
}: {
  message: Message
  streamingContent?: string
  isLastInRun?: boolean
}) {
  const { artifacts, openArtifactPreview } = useTaskDetail()
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isSystem = message.role === 'system'
  const isTool = message.role === 'tool'
  const isStreamingAssistant = isAssistant && (Boolean(message.metadata?.streaming) || streamingContent !== undefined)
  const displayContent = streamingContent ?? message.content

  const renderedMarkdown = useMemo(() => {
    if (!isAssistant) {
      return null
    }
    return renderMarkdown(displayContent)
  }, [displayContent, isAssistant])

  if (isSystem) {
    const isError = message.metadata?.eventType === 'run_failed'
    if (isError) {
      return (
        <div
          key={message.id}
          style={{
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
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#dc2626', fontWeight: 700, fontSize: '13px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: '#fee2e2',
                fontSize: '12px',
              }}
            >
              ❌
            </span>
            运行失败
          </div>
          <div
            style={{
              fontSize: '12px',
              color: '#991b1b',
              lineHeight: 1.6,
              fontFamily: `Consolas, 'Fira Code', monospace`,
              background: 'rgba(239, 68, 68, 0.03)',
              padding: '10px 12px',
              borderRadius: '6px',
              border: '1px dashed #fca5a5',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {message.content}
          </div>
        </div>
      )
    }
    const isSubagentEvent = ['subagent_started', 'subagent_progress', 'subagent_completed'].includes(String(message.metadata?.eventType ?? ''))
    const isCompleted = message.metadata?.eventType === 'subagent_completed'
    const isProgress = message.metadata?.eventType === 'subagent_progress'

    return (
      <div key={message.id} style={{ display: 'flex', justifyContent: 'center', margin: '8px 0', width: '100%' }}>
        <div
          style={{
            background: isSubagentEvent ? (isCompleted ? '#f0fdf4' : isProgress ? '#f0f9ff' : '#eff6ff') : '#f1f5f9',
            color: isSubagentEvent ? (isCompleted ? '#15803d' : isProgress ? '#0284c7' : '#1d4ed8') : '#64748b',
            padding: '6px 16px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 500,
            border: isSubagentEvent ? (isCompleted ? '1px solid #bbf7d0' : '1px solid #bae6fd') : '1px solid #e2e8f0',
            boxShadow: isSubagentEvent ? '0 2px 6px rgba(0,0,0,0.03)' : 'none',
          }}
        >
          {message.content}
        </div>
      </div>
    )
  }

  if (isTool) {
    return <CollapsibleToolMessage key={message.id} message={message} />
  }

  const subagentName = typeof message.metadata?.subagentName === 'string' ? message.metadata.subagentName : undefined
  const expertName = String(message.metadata?.expertTeamName ?? message.metadata?.expertName ?? 'AnyBuddy')
  const senderTitle = isUser
    ? '用户'
    : isAssistant
      ? subagentName
        ? `[子 Agent: ${subagentName}] ${expertName}`
        : isStreamingAssistant
          ? `${expertName} 正在输出`
          : expertName
      : '工具调用'

  return (
    <div key={message.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', width: '100%' }}>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px', padding: '0 4px' }}>
        {senderTitle}
      </div>
      <div
        style={{
          maxWidth: '85%',
          padding: '12px 16px',
          background: isUser ? '#6F2BDC' : isTool ? '#1e293b' : '#ffffff',
          color: isUser ? '#ffffff' : isTool ? '#38bdf8' : '#334155',
          boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
          border: isUser ? 'none' : isStreamingAssistant ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
          fontSize: '14px',
          lineHeight: '1.6',
          borderRadius: '12px',
          fontFamily: isTool ? 'Consolas, Courier New, monospace' : 'inherit',
        }}
      >
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</div>
        ) : renderedMarkdown !== null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>{renderedMarkdown}</div>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</div>
        )}
      </div>

      {/* 消息气泡外部的无背景按钮：仅在每轮 Agent Run 的最后一条输出展示 */}
      {isAssistant && isLastInRun && artifacts.length > 0 && (
        <div
          onClick={() => openArtifactPreview()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            marginTop: '6px',
            padding: '2px 4px',
            background: 'transparent',
            color: '#475569',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            userSelect: 'none',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#2563eb'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#475569'
          }}
        >
          <span>查看所有成果 ({artifacts.length})</span>
          <ChevronRight size={16} />
        </div>
      )}
    </div>
  )
})

/**
 * 将持久化消息与流式消息按原始时间合并，保持工具事件和反馈的真实顺序。
 */
const UnifiedMessageTimeline = memo(function UnifiedMessageTimeline({
  messages,
  lastAssistantMessageIds,
}: {
  messages: Message[]
  lastAssistantMessageIds: Set<string>
}) {
  const { taskId, activeExpert, activeExpertTeam, scrollContainerRef, shouldAutoScrollRef } = useTaskDetail()

  const streamingDataKey = useAppStore((state) => {
    return getStreamingEntriesForTask(
      state.streamingContentByMessageId,
      state.streamingMessageIdsByRun,
      state.agentRuns,
      taskId,
      state.streamingCreatedAtByMessageId,
    ).map(entry => `${entry.id}:${entry.content.length}`).join(';')
  })

  const streamingEntries = useMemo(() => {
    const state = useAppStore.getState()
    return getStreamingEntriesForTask(
      state.streamingContentByMessageId,
      state.streamingMessageIdsByRun,
      state.agentRuns,
      taskId,
      state.streamingCreatedAtByMessageId,
    )
  }, [streamingDataKey, taskId])

  const timelineMessages = useMemo(() => {
    const streamingMessages: Message[] = streamingEntries.map(entry => ({
      id: entry.id,
      taskId: entry.taskId,
      runId: entry.runId,
      role: 'assistant',
      content: entry.content,
      metadata: {
        streaming: true,
        expertName: activeExpert?.name,
        expertTeamName: activeExpertTeam?.name,
      },
      createdAt: entry.createdAt,
    }))
    return sortTimelineMessages([...messages, ...streamingMessages])
  }, [activeExpert?.name, activeExpertTeam?.name, messages, streamingEntries])

  useEffect(() => {
    if (streamingEntries.length === 0) return
    if (typeof window === 'undefined') return
    const raf = window.requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      if (container && shouldAutoScrollRef.current) {
        container.scrollTop = container.scrollHeight
      }
    })
    return () => window.cancelAnimationFrame(raf)
  }, [streamingDataKey, scrollContainerRef, shouldAutoScrollRef, streamingEntries.length])

  return (
    <>
      {timelineMessages.map((message, index) => (
        <MessageItem
          key={message.id}
          message={message}
          streamingContent={message.metadata?.streaming ? message.content : undefined}
          isLastInRun={lastAssistantMessageIds.has(message.id) || (
            message.metadata?.streaming === true && index === timelineMessages.length - 1
          )}
        />
      ))}
    </>
  )
})

/**
 * 消息流列表容器组件
 */
export default function TaskDetailMessageList() {
  const { messages, isAgentWorking, activeExpert, activeExpertTeam, currentRun, scrollContainerRef, handleMessageScroll } = useTaskDetail()

  // 计算每一轮 Agent Run 的最后一条 Assistant 消息 ID 集合
  const lastAssistantMessageIds = useMemo(() => {
    const ids = new Set<string>()
    const lastByRunId = new Map<string, string>()
    let currentTurnLastAssistantId: string | null = null

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.role === 'user') {
        if (currentTurnLastAssistantId) {
          ids.add(currentTurnLastAssistantId)
          currentTurnLastAssistantId = null
        }
      } else if (msg.role === 'assistant') {
        if (msg.runId) {
          lastByRunId.set(msg.runId, msg.id)
        }
        currentTurnLastAssistantId = msg.id
      }
    }

    if (currentTurnLastAssistantId) {
      ids.add(currentTurnLastAssistantId)
    }

    for (const id of lastByRunId.values()) {
      ids.add(id)
    }

    return ids
  }, [messages])

  return (
    <div
      ref={scrollContainerRef}
      data-streaming-scroll
      onScroll={handleMessageScroll}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px',
        background: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <UnifiedMessageTimeline
        messages={messages}
        lastAssistantMessageIds={lastAssistantMessageIds}
      />

      {isAgentWorking && (
        <div
          style={{
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
            alignSelf: 'flex-start',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="pulsing-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#6F2BDC' }}></span>
            <span
              className="pulsing-dot"
              style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#8b5cf6', animationDelay: '0.2s' }}
            ></span>
            <span
              className="pulsing-dot"
              style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#c084fc', animationDelay: '0.4s' }}
            ></span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {activeExpertTeam?.name ?? activeExpert?.name ?? 'AnyBuddy'} 正在执行中
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {(() => {
                const node = currentRun?.currentNode
                if (node === 'plan' || node === 'planning') return '正在规划方案...'
                if (node === 'execute' || node === 'execution') return '正在执行操作步骤...'
                if (node === 'call_tool' || node === 'tool') return '正在调用工具...'
                return '正在思考并执行任务中，请稍候...'
              })()}
            </span>
          </div>
        </div>
      )}

      {messages.length === 0 && <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#94a3b8' }}>暂无对话记录，发送一条消息开始。</div>}
    </div>
  )
}
