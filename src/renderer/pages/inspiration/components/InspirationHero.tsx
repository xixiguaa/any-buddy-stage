import { useState } from 'react'
import { Input, Button } from 'antd'
import { SearchOutlined, PlusOutlined } from '@ant-design/icons'
import { Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface InspirationHeroProps {
  query: string
  onQueryChange: (query: string) => void
}

const HOT_KEYWORDS = ['三星堆青铜', '川剧变脸', '国宝大熊猫', '蜀绣非遗', '峨眉云海', '盖碗茶']

/**
 * 灵感广场 Hero 顶部 Banner 区域组件
 */
export default function InspirationHero({ query, onQueryChange }: InspirationHeroProps) {
  const navigate = useNavigate()
  const [hoveredKw, setHoveredKw] = useState<string | null>(null)

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: '20px',
        padding: '36px 40px',
        marginBottom: '28px',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 45%, #312e81 100%)',
        color: '#ffffff',
        overflow: 'hidden',
        boxShadow: '0 20px 40px -15px rgba(15, 23, 42, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      {/* 背景动态高光与晕染饰面 */}
      <div
        style={{
          position: 'absolute',
          top: '-60px',
          right: '-40px',
          width: '320px',
          height: '320px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.25) 0%, rgba(255, 255, 255, 0) 70%)',
          pointerEvents: 'none',
          filter: 'blur(20px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-80px',
          left: '25%',
          width: '360px',
          height: '200px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(236, 72, 153, 0.18) 0%, rgba(255, 255, 255, 0) 70%)',
          pointerEvents: 'none',
          filter: 'blur(25px)',
        }}
      />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: '820px' }}>
        {/* 顶部胶囊 Badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(12px)',
            padding: '5px 14px',
            borderRadius: '9999px',
            fontSize: '12px',
            fontWeight: 500,
            marginBottom: '18px',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
          }}
        >
          <Sparkles size={14} style={{ color: '#a5b4fc' }} />
          <span style={{ color: '#e2e8f0', letterSpacing: '0.02em' }}>天府文化 · AI 创作灵感库</span>
        </div>

        {/* 主标题 */}
        <h1
          style={{
            fontSize: '30px',
            fontWeight: 700,
            margin: '0 0 12px 0',
            lineHeight: 1.25,
            letterSpacing: '-0.02em',
            background: 'linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          探索巴蜀奇观，一键开启创作同款
        </h1>
        <p style={{ fontSize: '14px', color: '#94a3b8', margin: '0 0 26px 0', lineHeight: 1.6 }}>
          汇聚三星堆神秘古蜀、川剧变脸绝艺、蜀绣工坊与四川名山大川。点击任何灵感即可预览视频、查看结构化 Prompt 并秒级生成同款 AI 任务。
        </p>

        {/* 搜索框与新建按键 Row */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '18px' }}>
          <div style={{ flex: '1 1 360px', position: 'relative' }}>
            <Input
              placeholder="搜索古蜀文化、川剧绝技、熊猫、提示词关键词..."
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              prefix={<SearchOutlined style={{ color: '#6F2BDC', fontSize: '18px', marginRight: '4px' }} />}
              allowClear
              size="large"
              style={{
                borderRadius: '14px',
                padding: '10px 18px',
                background: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
                fontSize: '14px',
              }}
            />
          </div>

          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => navigate('/tasks/new')}
            style={{
              borderRadius: '14px',
              padding: '0 24px',
              height: '46px',
              background: 'linear-gradient(135deg, #7C3AED 0%, #6F2BDC 100%)',
              border: 'none',
              fontWeight: 600,
              boxShadow: '0 8px 20px rgba(111, 43, 220, 0.35)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            开始创作
          </Button>
        </div>

        {/* 热门关键词热搜 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>热门灵感推荐:</span>
          {HOT_KEYWORDS.map((kw) => {
            const isHover = hoveredKw === kw
            return (
              <span
                key={kw}
                onClick={() => onQueryChange(kw)}
                onMouseEnter={() => setHoveredKw(kw)}
                onMouseLeave={() => setHoveredKw(null)}
                style={{
                  fontSize: '12px',
                  padding: '3px 10px',
                  borderRadius: '9999px',
                  background: isHover ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                  color: isHover ? '#ffffff' : '#cbd5e1',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                }}
              >
                {kw}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
