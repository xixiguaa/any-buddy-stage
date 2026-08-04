import { Empty, Button } from 'antd'
import InspirationCard from './InspirationCard.js'
import type { InspirationCard as CardType } from '../types.js'

interface InspirationGridProps {
  cards: CardType[]
  onPreviewVideo: (card: CardType) => void
  onOpenDetail: (inspirationId: string) => void
  onCreateSame: (card: CardType) => void
  onResetFilter?: () => void
}

/**
 * 灵感卡片响应式网格布局组件
 */
export default function InspirationGrid({
  cards,
  onPreviewVideo,
  onOpenDetail,
  onCreateSame,
  onResetFilter,
}: InspirationGridProps) {
  if (cards.length === 0) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', background: '#ffffff', borderRadius: '14px', border: '1px dashed #cbd5e1' }}>
        <Empty
          description={<span style={{ color: '#64748b' }}>未找到符合条件的文化灵感</span>}
        >
          {onResetFilter && (
            <Button type="primary" onClick={onResetFilter} style={{ borderRadius: '8px', background: '#6F2BDC' }}>
              清空搜索与筛选条件
            </Button>
          )}
        </Empty>
      </div>
    )
  }

  return (
    <div className="inspiration-grid">
      {cards.map((card) => (
        <InspirationCard
          key={card.id}
          card={card}
          onPreviewVideo={onPreviewVideo}
          onOpenDetail={onOpenDetail}
          onCreateSame={onCreateSame}
        />
      ))}
    </div>
  )
}
