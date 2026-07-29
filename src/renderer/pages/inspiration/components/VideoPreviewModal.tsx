import { useEffect, useState } from 'react'
import { Modal } from 'antd'
import { CloseOutlined, ThunderboltOutlined, InfoCircleOutlined } from '@ant-design/icons'
import type { InspirationCard } from '../types.js'

interface VideoPreviewModalProps {
  card: InspirationCard | null
  onClose: () => void
  onOpenDetail: (inspirationId: string) => void
  onCreateSame: (card: InspirationCard) => void
}

/**
 * 灵感视频预览浮层 Modal 组件
 */
export default function VideoPreviewModal({ card, onClose, onOpenDetail, onCreateSame }: VideoPreviewModalProps) {
  const [btnHovered, setBtnHovered] = useState(false)
  const [detailBtnHovered, setDetailBtnHovered] = useState(false)

  useEffect(() => {
    if (card) {
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [card])

  if (!card) return null

  return (
    <Modal
      open={!!card}
      onCancel={onClose}
      footer={null}
      width={840}
      centered
      destroyOnClose
      closeIcon={
        <div style={{ padding: '6px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.1)', display: 'flex' }}>
          <CloseOutlined style={{ color: '#ffffff', fontSize: '14px' }} />
        </div>
      }
      styles={{
        body: {
          padding: 0,
          borderRadius: '20px',
          overflow: 'hidden',
          background: '#0f172a',
          color: '#ffffff',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.65)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        },
        mask: {
          backgroundColor: 'rgba(15, 23, 42, 0.82)',
          backdropFilter: 'blur(10px)',
        },
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* 视频播放器区域 */}
        <div style={{ position: 'relative', width: '100%', background: '#000000', display: 'flex', justifyContent: 'center', alignItems: 'center', aspectRatio: '16/9' }}>
          <video
            src={card.videoUrl}
            poster={card.imageUrl}
            controls
            autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>

        {/* 视频底部元信息与操作栏 */}
        <div style={{ padding: '24px 28px', background: '#0f172a' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '16px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '18px' }}>{card.icon}</span>
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: '9999px',
                    background: 'rgba(99, 102, 241, 0.2)',
                    color: '#a5b4fc',
                    fontSize: '12px',
                    fontWeight: 600,
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                  }}
                >
                  {card.category}
                </span>
                <span style={{ fontSize: '13px', color: '#94a3b8' }}>作者：{card.authorName}</span>
              </div>
              <h3 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: '#ffffff' }}>
                {card.title}
              </h3>
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button
                onClick={() => {
                  onClose()
                  onOpenDetail(card.inspirationId)
                }}
                onMouseEnter={() => setDetailBtnHovered(true)}
                onMouseLeave={() => setDetailBtnHovered(false)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  borderRadius: '9999px',
                  border: '1px solid rgba(255, 255, 255, 0.18)',
                  background: detailBtnHovered ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.08)',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  outline: 'none',
                }}
              >
                <InfoCircleOutlined />
                <span>查看灵感详情</span>
              </button>

              <button
                onClick={() => onCreateSame(card)}
                onMouseEnter={() => setBtnHovered(true)}
                onMouseLeave={() => setBtnHovered(false)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 20px',
                  borderRadius: '9999px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #7C3AED 0%, #6F2BDC 100%)',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: btnHovered
                    ? '0 8px 20px rgba(111, 43, 220, 0.5)'
                    : '0 4px 12px rgba(111, 43, 220, 0.3)',
                  transform: btnHovered ? 'translateY(-1.5px)' : 'translateY(0)',
                  outline: 'none',
                }}
              >
                <ThunderboltOutlined />
                <span>创作同款</span>
              </button>
            </div>
          </div>

          {/* 提示词引语展框 */}
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: '13px',
              color: '#cbd5e1',
              lineHeight: 1.6,
            }}
          >
            <span style={{ color: '#6F2BDC', fontWeight: 600, marginRight: '8px' }}>Prompt:</span>
            {card.prompt}
          </div>
        </div>
      </div>
    </Modal>
  )
}
