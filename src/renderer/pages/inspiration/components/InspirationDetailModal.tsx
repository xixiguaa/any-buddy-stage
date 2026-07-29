import { useEffect, useState } from 'react'
import { Modal, Tag, Avatar, Divider, message } from 'antd'
import {
  CloseOutlined,
  HeartOutlined,
  EyeOutlined,
  StarOutlined,
  ThunderboltOutlined,
  BookOutlined,
  CalendarOutlined,
  CheckCircleFilled,
} from '@ant-design/icons'
import { Sparkles } from 'lucide-react'
import { inspirationData } from '../data/inspirations.js'
import type { InspirationId } from '../types.js'

interface InspirationDetailModalProps {
  inspirationId: InspirationId | null
  onClose: () => void
  onSelectInspiration: (id: InspirationId) => void
  onCreateSameWithPrompt: (prompt: string) => void
}

/**
 * 灵感详情浮层 Modal 组件
 */
export default function InspirationDetailModal({
  inspirationId,
  onClose,
  onSelectInspiration,
  onCreateSameWithPrompt,
}: InspirationDetailModalProps) {
  const [btnHovered, setBtnHovered] = useState(false)
  const [starHovered, setStarHovered] = useState(false)
  const [hoveredRelId, setHoveredRelId] = useState<string | null>(null)
  const [isSaved, setIsSaved] = useState(false)

  useEffect(() => {
    if (inspirationId) {
      document.body.style.overflow = 'hidden'
      setIsSaved(false)
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [inspirationId])

  if (!inspirationId) return null

  const detail = inspirationData[inspirationId]

  if (!detail) {
    return (
      <Modal open onCancel={onClose} footer={null}>
        <div style={{ padding: '20px', textAlign: 'center' }}>未找到该灵感详情</div>
      </Modal>
    )
  }

  // 计算关联推荐 (最多 3 条)
  const relatedList = (detail.relatedIds || [])
    .map((id) => inspirationData[id])
    .filter(Boolean)
    .slice(0, 3)

  return (
    <Modal
      open={!!inspirationId}
      onCancel={onClose}
      footer={null}
      width={780}
      centered
      destroyOnClose
      closeIcon={
        <div
          style={{
            padding: '8px',
            borderRadius: '50%',
            background: 'rgba(15, 23, 42, 0.05)',
            display: 'flex',
            transition: 'all 0.2s',
          }}
        >
          <CloseOutlined style={{ color: '#64748b', fontSize: '14px' }} />
        </div>
      }
      styles={{
        body: {
          padding: '32px 36px',
          borderRadius: '24px',
          maxHeight: '88vh',
          overflowY: 'auto',
          boxShadow: '0 25px 60px -15px rgba(15, 23, 42, 0.2)',
          border: '1px solid rgba(226, 232, 240, 0.8)',
          scrollbarWidth: 'thin',
        },
        mask: {
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(8px)',
        },
      }}
    >
      {/* 1. 顶部 Header 头部 Banner 区域 */}
      <div
        style={{
          position: 'relative',
          borderRadius: '20px',
          padding: '28px 32px',
          background: `linear-gradient(135deg, ${detail.categoryColor}18 0%, ${detail.categoryColor}05 60%, #ffffff 100%)`,
          border: `1px solid ${detail.categoryColor}30`,
          marginBottom: '26px',
          overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.02)',
        }}
      >
        {/* 背景环状光晕 */}
        <div
          style={{
            position: 'absolute',
            top: '-40px',
            right: '-30px',
            width: '180px',
            height: '180px',
            borderRadius: '50%',
            background: detail.categoryColor,
            opacity: 0.12,
            filter: 'blur(30px)',
            pointerEvents: 'none',
          }}
        />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '26px', lineHeight: 1 }}>{detail.icon}</span>
              <span
                style={{
                  padding: '4px 12px',
                  borderRadius: '9999px',
                  background: detail.categoryColor,
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: 600,
                  boxShadow: `0 4px 12px ${detail.categoryColor}40`,
                }}
              >
                {detail.category}
              </span>
            </div>

            <div style={{ fontSize: '12px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CalendarOutlined />
              <span>{detail.date}</span>
            </div>
          </div>

          <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: '0 0 16px 0', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
            {detail.title}
          </h2>

          {/* 统计指标数据 Pills */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '9999px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                fontSize: '12px',
                color: '#475569',
                fontWeight: 500,
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.02)',
              }}
            >
              <EyeOutlined style={{ color: '#6F2BDC' }} />
              <span>{detail.views} 次浏览</span>
            </div>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '9999px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                fontSize: '12px',
                color: '#475569',
                fontWeight: 500,
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.02)',
              }}
            >
              <HeartOutlined style={{ color: '#ec4899' }} />
              <span>{detail.likes} 点赞</span>
            </div>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '9999px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                fontSize: '12px',
                color: '#475569',
                fontWeight: 500,
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.02)',
              }}
            >
              <StarOutlined style={{ color: '#eab308' }} />
              <span>{detail.saves} 收藏</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. 作者栏目与极润操作按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '26px', padding: '0 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ position: 'relative' }}>
            <Avatar src={detail.authorAvatar} size={48} style={{ border: '2px solid #ffffff', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)' }} />
            <CheckCircleFilled style={{ position: 'absolute', bottom: 0, right: 0, color: '#6F2BDC', fontSize: '14px', background: '#ffffff', borderRadius: '50%' }} />
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{detail.author}</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
              {detail.authorTitle} · <span style={{ color: '#475569', fontWeight: 600 }}>{detail.authorFollowers}</span> 粉丝
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={() => {
              setIsSaved(!isSaved)
              message.success(isSaved ? '已取消收藏' : '已成功收藏灵感')
            }}
            onMouseEnter={() => setStarHovered(true)}
            onMouseLeave={() => setStarHovered(false)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 18px',
              borderRadius: '9999px',
              border: isSaved ? '1px solid #eab308' : '1px solid #cbd5e1',
              background: isSaved ? '#fefce8' : starHovered ? '#f8fafc' : '#ffffff',
              color: isSaved ? '#ca8a04' : starHovered ? '#0f172a' : '#475569',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none',
              boxShadow: starHovered ? '0 4px 12px rgba(15, 23, 42, 0.05)' : 'none',
            }}
          >
            <StarOutlined style={{ color: isSaved ? '#ca8a04' : undefined }} />
            <span>{isSaved ? '已收藏' : '收藏灵感'}</span>
          </button>

          <button
            onClick={() => {
              onClose()
              onCreateSameWithPrompt(detail.summary)
            }}
            onMouseEnter={() => setBtnHovered(true)}
            onMouseLeave={() => setBtnHovered(false)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 22px',
              borderRadius: '9999px',
              border: 'none',
              background: 'linear-gradient(135deg, #7C3AED 0%, #6F2BDC 100%)',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: btnHovered
                ? '0 8px 22px rgba(111, 43, 220, 0.45)'
                : '0 4px 14px rgba(99, 102, 241, 0.28)',
              transform: btnHovered ? 'translateY(-1.5px)' : 'translateY(0)',
              outline: 'none',
            }}
          >
            <ThunderboltOutlined />
            <span>基于此灵感创作</span>
          </button>
        </div>
      </div>

      {/* 3. 标签 Pill 列表 */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '26px' }}>
        {detail.tags.map((tag) => (
          <span
            key={tag}
            style={{
              padding: '4px 14px',
              borderRadius: '9999px',
              background: '#f1f5f9',
              color: '#475569',
              fontSize: '12px',
              fontWeight: 500,
              border: '1px solid #e2e8f0',
            }}
          >
            #{tag}
          </span>
        ))}
      </div>

      {/* 4. 核心亮点网格（Highlights Grid） */}
      {detail.highlights && detail.highlights.length > 0 && (
        <div style={{ marginBottom: '26px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sparkles size={16} style={{ color: '#6F2BDC' }} />
            <span>创作亮点解析</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
            {detail.highlights.map((hl, idx) => (
              <div
                key={idx}
                style={{
                  padding: '14px 18px',
                  borderRadius: '14px',
                  background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '14px' }}>{hl.icon}</span>
                  <span>{hl.label}</span>
                </div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                  {hl.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. 摘要与精美长文章节（Summary & Sections） */}
      <div style={{ marginBottom: '28px' }}>
        {/* 摘要框 */}
        <div
          style={{
            padding: '16px 20px',
            borderRadius: '14px',
            background: '#F5EEFF',
            borderLeft: '4px solid #6F2BDC',
            color: '#4C1D95',
            fontSize: '14px',
            lineHeight: 1.7,
            fontWeight: 500,
            marginBottom: '20px',
          }}
        >
          {detail.summary}
        </div>

        {/* 章节明细 */}
        {detail.sections.map((sec, idx) => (
          <div key={idx} style={{ marginTop: '18px', padding: '0 2px' }}>
            <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '6px', height: '14px', borderRadius: '3px', background: '#6F2BDC' }} />
              {sec.title}
            </h4>
            <p style={{ margin: 0, color: '#475569', fontSize: '14px', lineHeight: 1.75, letterSpacing: '0.01em' }}>
              {sec.content}
            </p>
          </div>
        ))}
      </div>

      {/* 6. 参考资料与文献卡片列表 */}
      {detail.references && detail.references.length > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BookOutlined style={{ color: '#6F2BDC' }} />
            <span>参考资料与文献</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {detail.references.map((ref, idx) => (
              <div
                key={idx}
                style={{
                  padding: '12px 18px',
                  borderRadius: '12px',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '13px',
                  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.02)',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '16px' }}>{ref.icon}</span>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>{ref.title}</span>
                </div>
                <Tag color="indigo" style={{ margin: 0, borderRadius: '6px', fontWeight: 500 }}>
                  {ref.type}
                </Tag>
              </div>
            ))}
          </div>
        </div>
      )}

      <Divider style={{ margin: '24px 0' }} />

      {/* 7. 关联灵感推荐卡片 (3 列卡片) */}
      {relatedList.length > 0 && (
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginBottom: '16px' }}>
            关联灵感推荐
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {relatedList.map((rel) => {
              const isRelHover = hoveredRelId === rel.id
              return (
                <div
                  key={rel.id}
                  onClick={() => onSelectInspiration(rel.id)}
                  onMouseEnter={() => setHoveredRelId(rel.id)}
                  onMouseLeave={() => setHoveredRelId(null)}
                  style={{
                    padding: '16px',
                    borderRadius: '16px',
                    border: isRelHover ? '1px solid #818cf8' : '1px solid #e2e8f0',
                    background: isRelHover ? '#f8fafc' : '#ffffff',
                    cursor: 'pointer',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    transform: isRelHover ? 'translateY(-3px)' : 'none',
                    boxShadow: isRelHover
                      ? '0 12px 24px rgba(99, 102, 241, 0.12)'
                      : '0 2px 8px rgba(0, 0, 0, 0.02)',
                  }}
                >
                  <div style={{ fontSize: '24px', marginBottom: '10px' }}>{rel.icon}</div>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 700,
                      color: isRelHover ? '#4f46e5' : '#0f172a',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      transition: 'color 0.2s',
                    }}
                  >
                    {rel.title}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', fontWeight: 500 }}>
                    {rel.category}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}
