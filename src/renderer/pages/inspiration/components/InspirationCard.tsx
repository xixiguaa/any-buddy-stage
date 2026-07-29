import { useState } from 'react'
import { Card, Button, Tooltip } from 'antd'
import { PlayCircleOutlined, ThunderboltOutlined, HeartOutlined, InfoCircleOutlined } from '@ant-design/icons'
import type { InspirationCard as CardType } from '../types.js'

interface InspirationCardProps {
  card: CardType
  onPreviewVideo: (card: CardType) => void
  onOpenDetail: (inspirationId: string) => void
  onCreateSame: (card: CardType) => void
}

/**
 * 灵感卡片组件
 */
export default function InspirationCard({ card, onPreviewVideo, onOpenDetail, onCreateSame }: InspirationCardProps) {
  const [hovered, setHovered] = useState(false)
  const [btnHovered, setBtnHovered] = useState(false)

  return (
    <Card
      hoverable
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      styles={{
        body: { padding: '18px' },
      }}
      style={{
        borderRadius: '16px',
        overflow: 'hidden',
        border: hovered ? '1px solid #cbd5e1' : '1px solid #f1f5f9',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: hovered
          ? '0 16px 32px -8px rgba(15, 23, 42, 0.12)'
          : '0 2px 8px rgba(0, 0, 0, 0.02)',
        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
        background: '#ffffff',
      }}
    >
      {/* 媒体封面区域 */}
      <div
        onClick={() => onPreviewVideo(card)}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16/9',
          borderRadius: '12px',
          overflow: 'hidden',
          backgroundColor: '#0f172a',
          backgroundImage: `url(${card.imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          cursor: 'pointer',
          marginBottom: '14px',
        }}
      >
        {/* 分类徽章 */}
        <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 2 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              borderRadius: '9999px',
              background: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(8px)',
              color: '#ffffff',
              fontSize: '11px',
              fontWeight: 600,
              border: '1px solid rgba(255, 255, 255, 0.15)',
            }}
          >
            <span>{card.icon}</span>
            <span>{card.category}</span>
          </span>
        </div>

        {/* Hover 时的蒙层与播放按钮 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle, rgba(15, 23, 42, 0.4) 0%, rgba(15, 23, 42, 0.75) 100%)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hovered ? 1 : 0,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#ffffff' }}>
            <PlayCircleOutlined
              style={{
                fontSize: '46px',
                filter: 'drop-shadow(0 6px 14px rgba(0, 0, 0, 0.4))',
                transform: hovered ? 'scale(1.08)' : 'scale(1)',
                transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
            <span style={{ fontSize: '12px', fontWeight: 600, marginTop: '8px', letterSpacing: '0.02em', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
              点击预览视频
            </span>
          </div>
        </div>
      </div>

      {/* 卡片描述 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h3
          onClick={() => onOpenDetail(card.inspirationId)}
          style={{
            fontSize: '15px',
            fontWeight: 700,
            color: hovered ? '#6F2BDC' : '#0f172a',
            margin: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            transition: 'color 0.2s',
          }}
        >
          {card.title}
        </h3>

        {/* 标签列表 */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {card.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              style={{
                padding: '2px 8px',
                borderRadius: '6px',
                fontSize: '11px',
                background: '#f8fafc',
                border: '1px solid #f1f5f9',
                color: '#64748b',
                fontWeight: 500,
              }}
            >
              #{tag}
            </span>
          ))}
        </div>

        {/* 底部信息与按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px', paddingTop: '12px', borderTop: '1px solid #f8fafc' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500 }}>
            <span>{card.authorName}</span>
            <span>·</span>
            <span><HeartOutlined style={{ marginRight: '3px' }} />{card.likes}</span>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Tooltip title="查看灵感详情">
              <Button
                type="text"
                size="small"
                icon={<InfoCircleOutlined style={{ color: '#64748b', fontSize: '15px' }} />}
                onClick={() => onOpenDetail(card.inspirationId)}
                style={{
                  borderRadius: '8px',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              />
            </Tooltip>

            {/* 高质感平滑渐变创作同款按钮 */}
            <button
              onClick={() => onCreateSame(card)}
              onMouseEnter={() => setBtnHovered(true)}
              onMouseLeave={() => setBtnHovered(false)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '9999px',
                border: 'none',
                background: 'linear-gradient(135deg, #7C3AED 0%, #6F2BDC 100%)',
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: btnHovered
                  ? '0 6px 16px rgba(111, 43, 220, 0.45)'
                  : '0 2px 8px rgba(111, 43, 220, 0.25)',
                transform: btnHovered ? 'translateY(-1.5px)' : 'translateY(0)',
                outline: 'none',
              }}
            >
              <ThunderboltOutlined style={{ fontSize: '13px' }} />
              <span>创作同款</span>
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
}
