import { useEffect, useState } from 'react'
import { Input, Button } from 'antd'
import { SendOutlined } from '@ant-design/icons'

export default function MessageComposer({
  onSend,
  placeholder = 'Describe the next step or ask the agent to continue.',
  buttonLabel = '发送',
  value,
  onChange,
}: {
  onSend: (content: string) => Promise<void> | void
  placeholder?: string
  buttonLabel?: string
  value?: string
  onChange?: (content: string) => void
}) {
  const [internalContent, setInternalContent] = useState('')
  const [busy, setBusy] = useState(false)

  const controlled = value !== undefined
  const content = controlled ? value : internalContent

  useEffect(() => {
    if (!controlled) {
      return
    }
    setInternalContent(value)
  }, [controlled, value])

  function handleChange(nextValue: string) {
    if (!controlled) {
      setInternalContent(nextValue)
    }
    onChange?.(nextValue)
  }

  async function handleSubmit() {
    const text = content.trim()
    if (!text) return
    setBusy(true)
    try {
      await onSend(text)
      handleChange('')
    } finally {
      setBusy(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <div style={{
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      padding: '12px',
      background: '#ffffff',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }}>
      <Input.TextArea
        value={content}
        onChange={event => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={3}
        style={{
          border: 'none',
          boxShadow: 'none',
          background: 'transparent',
          resize: 'none',
          padding: 0
        }}
        styles={{ textarea: { border: 'none', boxShadow: 'none', background: 'transparent' } }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
          Shift + Enter 换行，Enter 发送
        </span>
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSubmit}
          disabled={busy || !content.trim()}
          style={{ background: '#0f172a', fontWeight: 600 }}
        >
          {buttonLabel}
        </Button>
      </div>
    </div>
  )
}
