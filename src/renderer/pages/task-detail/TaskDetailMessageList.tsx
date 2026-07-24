import React, { memo, useEffect, useMemo, useState } from 'react'
import type { Message } from '../../../shared/types.js'
import { useAppStore } from '../../stores/app-store.js'
import { useTaskDetail } from './TaskDetailContext.js'

/**
 * 解析内联 Markdown 格式（粗体与代码块）
 */
function parseInlineMarkdown(text: string): React.ReactNode[] {
  const regex = /(\*\*.*?\*\*|`.*?`)/g
  const splitParts = text.split(regex)

  return splitParts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ fontWeight: 600, color: '#1e293b' }}>{part.slice(2, -2)}</strong>
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
      )
    }
    return part
  })
}

/**
 * 渲染简单 Markdown 格式标题、列表及引用
 */
export function renderMarkdown(content: string) {
  const lines = content.split('\n')
  return lines.map((line, index) => {
    if (line.startsWith('### ')) {
      return <h3 key={index} style={{ margin: '8px 0 4px 0', fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>{parseInlineMarkdown(line.slice(4))}</h3>
    }
    if (line.startsWith('## ')) {
      return <h2 key={index} style={{ margin: '12px 0 6px 0', fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>{parseInlineMarkdown(line.slice(3))}</h2>
    }
    if (line.startsWith('# ')) {
      return <h1 key={index} style={{ margin: '14px 0 8px 0', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>{parseInlineMarkdown(line.slice(2))}</h1>
    }

    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const indent = line.search(/\S/)
      return (
        <div key={index} style={{ display: 'flex', gap: '6px', paddingLeft: `${indent * 8 + 8}px`, margin: '4px 0', alignItems: 'flex-start' }}>
          <span style={{ color: '#6366f1', userSelect: 'none' }}>•</span>
          <span style={{ flex: 1 }}>{parseInlineMarkdown(line.trim().slice(2))}</span>
        </div>
      )
    }

    if (line.trim().startsWith('> ')) {
      return (
        <blockquote key={index} style={{ borderLeft: '4px solid #cbd5e1', paddingLeft: '12px', margin: '8px 0', color: '#64748b', fontStyle: 'italic' }}>
          {parseInlineMarkdown(line.trim().slice(2))}
        </blockquote>
      )
    }

    if (!line.trim()) {
      return <div key={index} style={{ height: '8px' }} />
    }

    return (
      <p key={index} style={{ margin: '4px 0', minHeight: '1.2em' }}>
        {parseInlineMarkdown(line)}
      </p>
    )
  })
}

function isPersistedFinalAssistantMessage(message: Message, runId?: string) {
  return (
    message.role === 'assistant' &&
    message.runId === runId &&
    !message.metadata?.synthetic &&
    message.metadata?.source !== 'runtime_tool_progress'
  )
}

/**
 * 可折叠工具调用与结果展示卡片
 */
function CollapsibleToolMessage({ message }: { message: Message }) {
  const [collapsed, setCollapsed] = useState(true)
  const eventType = message.metadata?.eventType
  const isResult = message.content.startsWith('工具结果:') || eventType === 'tool_result'
  const runtimeScope = message.metadata?.runtimeScope === 'project' ? 'project' : 'internal'
  const isInternal = runtimeScope === 'internal'

  const payload = message.metadata?.payload as Record<string, unknown> | undefined
  const toolName = String(payload?.toolName ?? 'unknown')

  // 内置 deepagent 工具默认折叠 + 灰色背景
  useEffect(() => {
    if (isInternal && eventType === 'tool_called') {
      setCollapsed(true)
    }
  }, [isInternal, eventType])

  // 提取关键参数作为标题上下文
  let argContext = ''
  if (eventType === 'tool_called' && payload?.arguments) {
    const args = payload.arguments as Record<string, unknown>
    const pathVal = args.path ?? args.filePath ?? args.file_path ?? args.filename
    if (typeof pathVal === 'string' && pathVal) {
      argContext = pathVal
    } else if (typeof args.command === 'string' && args.command) {
      argContext = args.command
    } else if (typeof args.query === 'string' && args.query) {
      argContext = `"${args.query}"`
    }
  }

  const scopePrefix = isInternal ? '⚙️ deepagent · ' : ''
  let displayTitle = ''
  if (eventType === 'tool_called') {
    displayTitle = `${scopePrefix}调用工具 · ${toolName}${argContext ? ` (${argContext})` : ''}`
  } else if (eventType === 'tool_result') {
    const summary = String(payload?.summary || '执行成功')
    displayTitle = `${scopePrefix}工具结果 · ${toolName} : ${summary}`
  } else {
    displayTitle = message.content
  }

  let detailText = ''
  if (payload) {
    if (eventType === 'tool_called' && payload.arguments) {
      detailText = typeof payload.arguments === 'string' ? payload.arguments : JSON.stringify(payload.arguments, null, 2)
    } else if (eventType === 'tool_result' && payload.result) {
      const resultObj = payload.result as Record<string, unknown>
      detailText = JSON.stringify(resultObj, null, 2)
    } else {
      detailText = JSON.stringify(payload, null, 2)
    }
  }

  const headerBg = isInternal
    ? isResult
      ? 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)'
      : 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)'
    : isResult
      ? 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)'
      : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)'
  const headerBorder = isInternal
    ? isResult
      ? '1px solid #cbd5e1'
      : '1px solid #cbd5e1'
    : isResult
      ? '1px solid #bbf7d0'
      : '1px solid #e2e8f0'
  const headerText = isInternal ? '#475569' : isResult ? '#166534' : '#334155'
  const badgeBg = isInternal ? '#e2e8f0' : isResult ? '#dcfce7' : '#e2e8f0'
  const badgeText = isResult ? '✅' : '🔧'
  const trailingText = isInternal ? '#64748b' : isResult ? '#15803d' : '#64748b'

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
          background: headerBg,
          border: headerBorder,
          cursor: 'pointer',
          fontSize: '12px',
          color: headerText,
          userSelect: 'none',
          transition: 'all 0.2s',
          boxShadow: '0 2px 6px rgba(0,0,0,0.01)',
          width: '100%',
          boxSizing: 'border-box',
          justifyContent: 'space-between',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = isResult && !isInternal ? '#86efac' : '#cbd5e1'
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.03)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = headerBorder
          e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.01)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '20px',
              height: '20px',
              borderRadius: '6px',
              background: badgeBg,
              fontSize: '11px',
            }}
          >
            {badgeText}
          </span>
          <span style={{ fontWeight: 600, fontFamily: `Consolas, 'Fira Code', monospace` }}>{displayTitle}</span>
        </div>
        <span style={{ fontSize: '11px', color: trailingText, whiteSpace: 'nowrap' }}>
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
  )
}

/**
 * 单条消息渲染组件
 */
const MessageItem = memo(function MessageItem({
  message,
  streamingContent,
}: {
  message: Message
  streamingContent?: string
}) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isSystem = message.role === 'system'
  const isTool = message.role === 'tool'
  const isStreamingAssistant = isAssistant && (Boolean(message.metadata?.streaming) || streamingContent !== undefined)
  const displayContent = streamingContent ?? message.content

  const renderedMarkdown = useMemo(() => {
    if (isStreamingAssistant || !isAssistant) {
      return null
    }
    return renderMarkdown(displayContent)
  }, [displayContent, isStreamingAssistant, isAssistant])

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
    return (
      <div key={message.id} style={{ display: 'flex', justifyContent: 'center', margin: '8px 0', width: '100%' }}>
        <div
          style={{
            background: '#f1f5f9',
            color: '#64748b',
            padding: '6px 16px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 500,
            border: '1px solid #e2e8f0',
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

  return (
    <div key={message.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', width: '100%' }}>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px', padding: '0 4px' }}>
        {isUser
          ? '用户'
          : isAssistant
            ? isStreamingAssistant
              ? `${String(message.metadata?.expertName ?? 'AnyBuddy')} 正在输出`
              : String(message.metadata?.expertName ?? 'AnyBuddy')
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
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</div>
        ) : renderedMarkdown !== null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>{renderedMarkdown}</div>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</div>
        )}
      </div>
    </div>
  )
})

/**
 * 流式消息独立渲染通道组件
 */
const StreamingMessageList = memo(function StreamingMessageList() {
  const { scrollContainerRef, shouldAutoScrollRef } = useTaskDetail()

  const streamingDataKey = useAppStore((state) => {
    const ids = Object.values(state.streamingMessageIdsByRun).flat()
    let key = String(ids.length)
    for (const id of ids) {
      const c = state.streamingContentByMessageId[id]
      if (c !== undefined) key += `${id}:${c.length};`
    }
    return key
  })

  const streamingEntries = useMemo(() => {
    const state = useAppStore.getState()
    const completedRuns = new Set(
      state.messages
        .filter((message) => isPersistedFinalAssistantMessage(message, message.runId))
        .map((message) => message.runId)
        .filter((runId): runId is string => Boolean(runId))
    )
    const result: Array<{ id: string; runId: string; content: string }> = []
    for (const runId of Object.keys(state.streamingMessageIdsByRun)) {
      if (completedRuns.has(runId)) {
        continue
      }
      for (const id of state.streamingMessageIdsByRun[runId] ?? []) {
        const content = state.streamingContentByMessageId[id]
        if (content !== undefined) {
          result.push({ id, runId, content })
        }
      }
    }
    return result
  }, [streamingDataKey])

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

  if (streamingEntries.length === 0) return null

  return (
    <>
      {streamingEntries.map((entry) => (
        <MessageItem
          key={entry.id}
          message={{
            id: entry.id,
            taskId: '',
            runId: entry.runId,
            role: 'assistant',
            content: entry.content,
            metadata: { streaming: true },
            createdAt: new Date().toISOString(),
          }}
          streamingContent={entry.content}
        />
      ))}
    </>
  )
})

/**
 * 消息流列表容器组件
 */
export default function TaskDetailMessageList() {
  const { messages, isAgentWorking, activeExpert, currentRun, scrollContainerRef, handleMessageScroll } = useTaskDetail()

  const renderedMessages = useMemo(() => {
    return messages.map((message) => <MessageItem key={message.id} message={message} />)
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
        background: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      {renderedMessages}
      <StreamingMessageList />

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
            <span className="pulsing-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#6366f1' }}></span>
            <span
              className="pulsing-dot"
              style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#3b82f6', animationDelay: '0.2s' }}
            ></span>
            <span
              className="pulsing-dot"
              style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', animationDelay: '0.4s' }}
            ></span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {activeExpert?.name ?? 'AnyBuddy'} 正在执行中
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
