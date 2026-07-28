import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * 使用 ReactMarkdown 渲染通用 Markdown 格式（支持流式增量渲染与统一代码块/表格样式）
 */
export function renderMarkdown(content: string) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 style={{ margin: '14px 0 8px 0', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>{children}</h1>,
        h2: ({ children }) => <h2 style={{ margin: '12px 0 6px 0', fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>{children}</h2>,
        h3: ({ children }) => <h3 style={{ margin: '8px 0 4px 0', fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>{children}</h3>,
        p: ({ children }) => <p style={{ margin: '4px 0', lineHeight: 1.6 }}>{children}</p>,
        ul: ({ children }) => <ul style={{ paddingLeft: '20px', margin: '4px 0' }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ paddingLeft: '20px', margin: '4px 0' }}>{children}</ol>,
        li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
        blockquote: ({ children }) => (
          <blockquote style={{ borderLeft: '4px solid #cbd5e1', paddingLeft: '12px', margin: '8px 0', color: '#64748b', fontStyle: 'italic' }}>
            {children}
          </blockquote>
        ),
        code: ({ className, children, ...props }) => {
          const isInline = !className && !String(children).includes('\n')
          if (isInline) {
            return (
              <code
                style={{
                  background: 'rgba(99, 102, 241, 0.08)',
                  color: '#4f46e5',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontFamily: `Consolas, 'Fira Code', monospace`,
                  fontSize: '12px',
                  border: '1px solid #e2e8f0',
                }}
                {...props}
              >
                {children}
              </code>
            )
          }
          return (
            <pre
              style={{
                background: '#0f172a',
                color: '#f8fafc',
                padding: '12px 14px',
                borderRadius: '8px',
                overflowX: 'auto',
                fontSize: '13px',
                fontFamily: `Consolas, 'Fira Code', monospace`,
                margin: '8px 0',
              }}
            >
              <code {...props}>{children}</code>
            </pre>
          )
        },
        table: ({ children }) => (
          <div style={{ overflowX: 'auto', margin: '8px 0' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }}>{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th style={{ border: '1px solid #cbd5e1', background: '#f1f5f9', padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>{children}</th>
        ),
        td: ({ children }) => (
          <td style={{ border: '1px solid #e2e8f0', padding: '6px 10px' }}>{children}</td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
