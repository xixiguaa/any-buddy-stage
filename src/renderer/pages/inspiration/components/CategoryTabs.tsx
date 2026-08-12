import { useState } from 'react'
import { cultureCategoryTabs } from '../data/inspirations.js'
import type { CultureTabKey } from '../types.js'

interface CategoryTabsProps {
  activeCategory: CultureTabKey
  onSelectCategory: (key: CultureTabKey) => void
  categoryCounts: Record<CultureTabKey, number>
}

/**
 * 灵感广场文化分类 Tab 栏组件
 */
export default function CategoryTabs({ activeCategory, onSelectCategory, categoryCounts }: CategoryTabsProps) {
  const [hoveredKey, setHoveredKey] = useState<CultureTabKey | null>(null)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        overflowX: 'auto',
        padding: '4px 2px 14px 2px',
        marginBottom: '20px',
        scrollbarWidth: 'none',
      }}
    >
      {cultureCategoryTabs.map((tab) => {
        const isActive = activeCategory === tab.key
        const isHovered = hoveredKey === tab.key
        const count = categoryCounts[tab.key] ?? 0

        return (
          <button
            key={tab.key}
            onClick={() => onSelectCategory(tab.key)}
            onMouseEnter={() => setHoveredKey(tab.key)}
            onMouseLeave={() => setHoveredKey(null)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              borderRadius: '12px',
              border: isActive
                ? '1.5px solid #6F2BDC'
                : isHovered
                ? '1.5px solid #d8b4fe'
                : '1px solid #e2e8f0',
              background: isActive
                ? '#F5EEFF'
                : isHovered
                ? '#FAF5FF'
                : '#ffffff',
              color: isActive ? '#6F2BDC' : isHovered ? '#6F2BDC' : '#334155',
              fontSize: '13px',
              fontWeight: isActive ? 600 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: isActive
                ? '0 4px 14px rgba(111, 43, 220, 0.12)'
                : isHovered
                ? '0 4px 12px rgba(111, 43, 220, 0.06)'
                : '0 1px 3px rgba(0, 0, 0, 0.02)',
              transform: isActive || isHovered ? 'translateY(-1px)' : 'translateY(0)',
              outline: 'none',
            }}
          >
            <span style={{ fontSize: '16px', lineHeight: 1 }}>{tab.icon}</span>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
              <span>{tab.label}</span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#6F2BDC' : '#94a3b8',
                  marginTop: '2px',
                }}
              >
                {count}个
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
