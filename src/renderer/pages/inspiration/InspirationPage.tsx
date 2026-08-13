import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { inspirationCards } from './data/inspirations.js'
import type { CultureTabKey, InspirationCard, InspirationId } from './types.js'
import InspirationHero from './components/InspirationHero.js'
import CategoryTabs from './components/CategoryTabs.js'
import InspirationGrid from './components/InspirationGrid.js'
import VideoPreviewModal from './components/VideoPreviewModal.js'
import InspirationDetailModal from './components/InspirationDetailModal.js'

// 创作同款存储 Key 常量
const INSPIRATION_CREATE_SAME_STORAGE_KEY = 'anybuddy-inspiration-create-same-prompt'

export default function InspirationPage() {
  const navigate = useNavigate()

  // 核心状态管理
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<CultureTabKey>('all')
  const [selectedVideo, setSelectedVideo] = useState<InspirationCard | null>(null)
  const [selectedInspirationId, setSelectedInspirationId] = useState<InspirationId | null>(null)

  // 搜索匹配辅助函数
  const matchesQuery = useCallback((card: InspirationCard, raw: string) => {
    const q = raw.trim().toLowerCase()
    if (!q) return true
    return [card.title, card.category, card.prompt, ...card.tags].some((value) =>
      value.toLowerCase().includes(q)
    )
  }, [])

  // 派生卡片过滤列表
  const filteredCards = useMemo(() => {
    return inspirationCards.filter((card) => {
      const matchCat = activeCategory === 'all' || card.tabKey === activeCategory
      const matchQ = matchesQuery(card, query)
      return matchCat && matchQ
    })
  }, [activeCategory, query, matchesQuery])

  // 派生分类 Counts 统计
  const categoryCounts = useMemo(() => {
    const counts: Record<CultureTabKey, number> = {
      all: 0,
      ancient: 0,
      opera: 0,
      panda: 0,
      teahouse: 0,
      craft: 0,
      scenery: 0,
    }

    for (const card of inspirationCards) {
      if (!matchesQuery(card, query)) continue
      counts.all += 1
      if (card.tabKey in counts) {
        counts[card.tabKey] += 1
      }
    }
    return counts
  }, [query, matchesQuery])

  // 处理创作同款
  const handleCreateSame = useCallback((card: InspirationCard) => {
    sessionStorage.setItem(
      INSPIRATION_CREATE_SAME_STORAGE_KEY,
      JSON.stringify({ prompt: card.prompt, title: card.title })
    )
    navigate('/tasks/new?fromInspirationSame=1')
  }, [navigate])

  // 处理依据提示词直接创作
  const handleCreateSameWithPrompt = useCallback((prompt: string) => {
    sessionStorage.setItem(
      INSPIRATION_CREATE_SAME_STORAGE_KEY,
      JSON.stringify({ prompt })
    )
    navigate('/tasks/new?fromInspirationSame=1')
  }, [navigate])

  return (
    <div
      style={{
        padding: '24px 32px',
        width: '100%',
        maxWidth: '1680px',
        margin: '0 auto',
        minHeight: '100vh',
        boxSizing: 'border-box',
      }}
    >
      {/* 顶部 Hero Banner */}
      <InspirationHero query={query} onQueryChange={setQuery} />

      {/* 分类 Tab 栏 */}
      <CategoryTabs
        activeCategory={activeCategory}
        onSelectCategory={setActiveCategory}
        categoryCounts={categoryCounts}
      />

      {/* 卡片网格 */}
      <InspirationGrid
        cards={filteredCards}
        onPreviewVideo={setSelectedVideo}
        onOpenDetail={setSelectedInspirationId}
        onCreateSame={handleCreateSame}
        onResetFilter={() => {
          setQuery('')
          setActiveCategory('all')
        }}
      />

      {/* 视频预览弹窗 */}
      <VideoPreviewModal
        card={selectedVideo}
        onClose={() => setSelectedVideo(null)}
        onOpenDetail={setSelectedInspirationId}
        onCreateSame={handleCreateSame}
      />

      {/* 灵感详情弹窗 */}
      <InspirationDetailModal
        inspirationId={selectedInspirationId}
        onClose={() => setSelectedInspirationId(null)}
        onSelectInspiration={setSelectedInspirationId}
        onCreateSameWithPrompt={handleCreateSameWithPrompt}
      />
    </div>
  )
}
